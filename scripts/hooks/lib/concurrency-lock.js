/**
 * concurrency-lock.js — cross-process slot allocator for provider-bound
 * dispatch.
 *
 * The problem: orchestrators (gamma, delta) issue parallel Agent tool calls
 * that each spawn `node scripts/dispatch-agent.js <role>`. Some providers —
 * notably Gemini at the time of writing — reliably handle 1-by-1 dispatch
 * but throw failures (rate-limit, server-side concurrency reject, timeout
 * cascade) when 15+ launch simultaneously. The fix is a dispatch-layer
 * concurrency cap, applied per-provider.
 *
 * Design:
 *   - Each "slot" is a lock file under .claude/runtime/dispatch-locks/<provider>/.
 *     Filename: `<pid>-<ts>-<rand>.lock`. Atomically created via fs.writeFileSync
 *     with the 'wx' flag (no overwrite).
 *   - acquireSlot polls: count non-stale lock files for the provider; if
 *     count < max, write our lock file and return its handle.
 *   - releaseSlot deletes our lock file.
 *   - Stale slots: locks older than STALE_AFTER_MS are ignored in the count
 *     and lazily pruned. Protects against killed processes that didn't release.
 *   - On poll timeout, returns null — caller treats this as "fall back to
 *     alternate provider" (the dispatch-agent.js path returns
 *     `{ fallback: true }` so gamma/delta re-routes to claude).
 *
 * No external deps. Works on Windows + POSIX.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PROJECT_ROOT = process.cwd();
const LOCK_ROOT = path.join(
  PROJECT_ROOT,
  ".claude",
  "runtime",
  "dispatch-locks",
);

// Default per-provider concurrency caps. Override via env vars.
const DEFAULT_CAPS = {
  gemini: parseInt(process.env.GEMINI_MAX_CONCURRENCY || "3", 10),
  openai: parseInt(process.env.OPENAI_MAX_CONCURRENCY || "10", 10),
  // claude has no rate-limit issue at our usage volumes; keep cap high
  claude: parseInt(process.env.CLAUDE_MAX_CONCURRENCY || "32", 10),
};

const STALE_AFTER_MS = 20 * 60 * 1000; // 20 minutes — longer than runProvider's 15-min timeout
const POLL_INTERVAL_MS = 500;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function lockDir(provider) {
  return path.join(LOCK_ROOT, provider);
}

function readLockMtimes(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of entries) {
    if (!name.endsWith(".lock")) continue;
    const full = path.join(dir, name);
    try {
      const st = fs.statSync(full);
      out.push({ name, full, mtimeMs: st.mtimeMs });
    } catch {
      /* gone */
    }
  }
  return out;
}

function pruneStale(dir, now) {
  for (const e of readLockMtimes(dir)) {
    if (now - e.mtimeMs > STALE_AFTER_MS) {
      try {
        fs.unlinkSync(e.full);
      } catch {
        /* race with another pruner — ignore */
      }
    }
  }
}

function activeCount(dir, now) {
  return readLockMtimes(dir).filter((e) => now - e.mtimeMs <= STALE_AFTER_MS)
    .length;
}

function getCap(provider, opts) {
  if (opts && typeof opts.max === "number") return opts.max;
  if (provider in DEFAULT_CAPS) return DEFAULT_CAPS[provider];
  return 8; // generic default
}

function makeLockPath(dir) {
  const ts = Date.now();
  const rnd = crypto.randomBytes(4).toString("hex");
  return path.join(dir, `${process.pid}-${ts}-${rnd}.lock`);
}

function tryAcquireOnce(dir, max, meta) {
  const now = Date.now();
  pruneStale(dir, now);
  if (activeCount(dir, now) >= max) return null;
  // Try to create our lock file atomically (wx fails if exists, though our
  // filename is already pid+ts+random so collisions are vanishing).
  const filePath = makeLockPath(dir);
  try {
    const fd = fs.openSync(filePath, "wx");
    // Phase 0 (workstream C): lock body is now JSON metadata. Readers tolerate
    // the legacy "<pid> <ts>" form for backward compatibility — only this
    // writer produces the new shape. Failure to serialize falls back to the
    // legacy text so the lock still functions.
    let payload;
    try {
      const enriched = Object.assign(
        {
          pid: process.pid,
          start_time: new Date(now).toISOString(),
          start_ms: now,
          cwd: process.cwd(),
        },
        meta || {},
      );
      payload = JSON.stringify(enriched) + "\n";
    } catch {
      payload = `${process.pid} ${now}\n`;
    }
    fs.writeSync(fd, payload);
    fs.closeSync(fd);
  } catch {
    return null;
  }
  // Re-check after write: if another process raced and pushed us over the
  // cap, release our slot and report no-go. This double-check is what makes
  // the lock cap-correct under contention.
  const after = activeCount(dir, Date.now());
  if (after > max) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }
    return null;
  }
  return filePath;
}

/**
 * Acquire a concurrency slot for the given provider. Polls until a slot is
 * available or the timeout elapses.
 *
 * @param {string} provider — "gemini" | "openai" | "claude" | other
 * @param {{ max?: number, timeoutMs?: number }} opts
 * @returns {Promise<string|null>} the lock file path on success, null on timeout
 */
async function acquireSlot(provider, opts = {}) {
  const dir = lockDir(provider);
  ensureDir(dir);
  const max = getCap(provider, opts);
  const timeoutMs = opts.timeoutMs || DEFAULT_ACQUIRE_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  let attempt = 0;
  while (true) {
    const lock = tryAcquireOnce(dir, max, opts.meta);
    if (lock) return lock;
    if (Date.now() >= deadline) return null;
    // Bounded jittered backoff: 500ms ± 0-200ms. Avoids thundering-herd when
    // many waiters wake at the same release.
    attempt++;
    const jitter = Math.floor(Math.random() * 200);
    await sleep(POLL_INTERVAL_MS + jitter);
    if (attempt > 1000) {
      // Safety stop: 1000 polls = ~8 minutes at 500ms. Should never hit this
      // before timeoutMs in practice, but bound the loop regardless.
      return null;
    }
  }
}

/**
 * Synchronous variant — same semantics, blocks the event loop. Use this only
 * when you can't await (e.g. top-level CLI scripts that already block on
 * execSync).
 */
function acquireSlotSync(provider, opts = {}) {
  const dir = lockDir(provider);
  ensureDir(dir);
  const max = getCap(provider, opts);
  const timeoutMs = opts.timeoutMs || DEFAULT_ACQUIRE_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (true) {
    const lock = tryAcquireOnce(dir, max, opts.meta);
    if (lock) return lock;
    if (Date.now() >= deadline) return null;
    attempt++;
    const jitter = Math.floor(Math.random() * 200);
    sleepSync(POLL_INTERVAL_MS + jitter);
    if (attempt > 1000) return null;
  }
}

function releaseSlot(lockPath) {
  if (!lockPath) return;
  try {
    fs.unlinkSync(lockPath);
  } catch {
    /* already gone — ignore */
  }
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// Synchronous sleep using Atomics. Works on all Node versions on Win/Linux/Mac.
function sleepSync(ms) {
  const end = Date.now() + ms;
  // Atomics.wait on a small SharedArrayBuffer is the canonical sync sleep.
  // Falls back to a busy-wait if SharedArrayBuffer isn't available (it always
  // is in modern Node).
  try {
    const sab = new SharedArrayBuffer(4);
    const arr = new Int32Array(sab);
    Atomics.wait(arr, 0, 0, ms);
  } catch {
    while (Date.now() < end) {
      /* busy wait */
    }
  }
}

// ── Inspection / pruning ─────────────────────────────────────
//
// Phase 0 workstream C. These helpers power scripts/dispatch/prune-dead-locks.js
// and any health check that needs to enumerate or surgically remove locks
// without re-implementing the directory layout.

function readLockMeta(lockPath) {
  try {
    const raw = fs.readFileSync(lockPath, "utf8").trim();
    if (!raw) return null;
    if (raw.startsWith("{")) {
      try {
        return JSON.parse(raw);
      } catch {
        // Fall through to legacy parser.
      }
    }
    // Legacy form: "<pid> <ms>\n"
    const [pidStr, msStr] = raw.split(/\s+/);
    const pid = parseInt(pidStr, 10);
    const start_ms = parseInt(msStr, 10);
    if (!Number.isFinite(pid)) return null;
    return {
      pid,
      start_ms: Number.isFinite(start_ms) ? start_ms : null,
      legacy: true,
    };
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // ESRCH = no such process; EPERM = process exists but we lack signal rights
    // (treat as alive — better to leave the lock than wrongly delete it).
    if (e && e.code === "EPERM") return true;
    return false;
  }
}

function listLocks(provider) {
  const dir = lockDir(provider);
  return readLockMtimes(dir).map((e) => ({
    ...e,
    meta: readLockMeta(e.full),
  }));
}

function listAllLockDirs() {
  try {
    return fs
      .readdirSync(LOCK_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * Eager prune: remove any lock whose owning PID is dead. Also calls the lazy
 * mtime-based pruneStale() so the result is "all currently-live work only".
 * Returns a summary { scanned, dead, stale }.
 *
 * Safe to call from session-start, /warp:health, /warp:setup, and any other
 * non-hot path. Idempotent.
 */
function pruneDeadLocks(opts = {}) {
  const now = Date.now();
  const minAgeMs = typeof opts.minAgeMs === "number" ? opts.minAgeMs : 5_000;
  const summary = { scanned: 0, dead: 0, stale: 0, byProvider: {} };
  for (const provider of listAllLockDirs()) {
    const dir = lockDir(provider);
    pruneStale(dir, now); // mtime-based legacy prune
    const before = readLockMtimes(dir).length;
    for (const entry of readLockMtimes(dir)) {
      summary.scanned++;
      // Don't yank locks that are still warm — under heavy contention a lock
      // can be written just before its meta is read by another process.
      if (now - entry.mtimeMs < minAgeMs) continue;
      const meta = readLockMeta(entry.full);
      if (!meta) continue;
      if (!pidAlive(meta.pid)) {
        try {
          fs.unlinkSync(entry.full);
          summary.dead++;
        } catch {
          /* race with another pruner */
        }
      }
    }
    const after = readLockMtimes(dir).length;
    const removed = Math.max(0, before - after);
    summary.byProvider[provider] = {
      before,
      after,
      removed,
    };
  }
  return summary;
}

module.exports = {
  acquireSlot,
  acquireSlotSync,
  releaseSlot,
  readLockMeta,
  listLocks,
  listAllLockDirs,
  pruneDeadLocks,
  pidAlive,
  DEFAULT_CAPS,
  STALE_AFTER_MS,
  LOCK_ROOT,
};
