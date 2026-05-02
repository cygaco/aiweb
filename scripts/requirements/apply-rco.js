/**
 * apply-rco.js — Resolve an open RCO (mark applied / dismissed / expired) and
 * propagate verification-status changes to the graph.
 *
 * Phase 3K artifact. Phase-3 review fix-forward (gemini-3.1-pro-preview
 * 2026-04-30) added:
 *   - Coarse advisory file lock to serialize rewrites against concurrent
 *     edit-watcher appends. Fail-open on lock-acquire failure with
 *     append-only re-read to merge any new entries that arrived.
 *   - clearStale() call on resolve so requirements.status.json doesn't get
 *     stuck holding stale_pending_review after the originating RCO closes.
 */

const fs = require("fs");
const path = require("path");
const { STAGED_FILE } = require("./config");
const { readAllRCOs } = require("./stage-rco");

const LOCK_FILE = STAGED_FILE + ".lock";
const LOCK_TIMEOUT_MS = 5000;
const LOCK_POLL_MS = 50;

function tryAcquireLock() {
  const start = Date.now();
  while (Date.now() - start < LOCK_TIMEOUT_MS) {
    try {
      const fd = fs.openSync(LOCK_FILE, "wx");
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return true;
    } catch (e) {
      if (e.code === "EEXIST") {
        // If the lockfile is older than 30s assume the holder crashed.
        try {
          const stat = fs.statSync(LOCK_FILE);
          if (Date.now() - stat.mtimeMs > 30000) {
            fs.unlinkSync(LOCK_FILE);
            continue;
          }
        } catch {
          /* race — try again */
        }
        const wait = Date.now() + LOCK_POLL_MS;
        while (Date.now() < wait) {
          /* busy wait — small */
        }
        continue;
      }
      return false; // unexpected error — fail-open
    }
  }
  return false;
}

function releaseLock() {
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch {
    /* already gone */
  }
}

/**
 * Atomic rewrite: write to a temp file then rename. On Windows, rename across
 * the same directory is atomic. Holding the advisory lock prevents concurrent
 * append+rewrite interleaving. If the lock isn't acquired, RE-READ entries
 * just before write so any appends that landed during our processing are
 * preserved (best-effort defense against the gemini-flagged race).
 */
function safeRewriteAll(mutator) {
  const haveLock = tryAcquireLock();
  try {
    let entries = readAllRCOs();
    mutator(entries);
    if (!haveLock) {
      // Re-read once just before write; if the file grew, merge new tail entries
      // that we didn't see in our snapshot. This isn't perfect but bounds the
      // worst case to "lose mutations on entries that arrived after the second
      // read" rather than "wipe the entire file."
      const fresh = readAllRCOs();
      const seenIds = new Set(entries.map((e) => e.id));
      for (const e of fresh) {
        if (!seenIds.has(e.id)) entries.push(e);
      }
    }
    const tmp = STAGED_FILE + ".tmp";
    fs.writeFileSync(
      tmp,
      entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );
    fs.renameSync(tmp, STAGED_FILE);
  } finally {
    if (haveLock) releaseLock();
  }
}

function resolve(id, status, notes) {
  const valid = ["applied", "dismissed", "expired"];
  if (!valid.includes(status)) {
    throw new Error(`Invalid status: ${status}; must be ${valid.join("|")}`);
  }
  let found = null;
  let impactedRequirements = [];
  safeRewriteAll((entries) => {
    for (const e of entries) {
      if (e.id === id) {
        e.status = status;
        e.resolution = {
          at: new Date().toISOString(),
          by: process.env.USER || process.env.USERNAME || "system",
          notes: notes || "",
        };
        found = e;
        impactedRequirements = e.impactedRequirements || [];
        break;
      }
    }
    if (!found) throw new Error(`RCO ${id} not found`);
  });
  // Clear stale flag on linked requirements when the originating RCO resolves.
  // Lazy-required so this module stays standalone if status.js is missing.
  try {
    const { clearStale } = require("./status");
    if (impactedRequirements.length > 0) {
      clearStale(impactedRequirements, id);
    }
  } catch {
    /* status module optional */
  }
  return found;
}

/**
 * Auto-expire open RCOs older than `days` (3L policy: 30-day default).
 * Class C is exempt per validation-backlog-policy §3.
 * Returns count expired.
 */
function autoExpire(days) {
  const days_ = days || 30;
  const cutoff = Date.now() - days_ * 24 * 60 * 60 * 1000;
  let count = 0;
  const expiredIds = [];
  safeRewriteAll((entries) => {
    for (const e of entries) {
      const isOpen = e.status === "open" || e.status === undefined;
      if (!isOpen) continue;
      if (e.riskClass === "C") continue;
      // Legacy entries written before schema v2 use top-level `ts` (event
      // timestamp). Fall back to it so the 30-day rule actually ages out
      // backlog entries that were folded in via stage-rco.js --backfill.
      const at = e.stagedAt
        ? Date.parse(e.stagedAt)
        : e.ts
          ? Date.parse(e.ts)
          : NaN;
      if (Number.isNaN(at)) continue;
      if (at < cutoff) {
        e.status = "expired";
        e.resolution = {
          at: new Date().toISOString(),
          by: "auto-expire",
          notes: `Auto-expired after ${days_}-day window per validation-backlog-policy.`,
        };
        count += 1;
        expiredIds.push({ id: e.id, impacted: e.impactedRequirements || [] });
      }
    }
  });
  // Clear stale flag for every requirement linked to an expired RCO.
  try {
    const { clearStale } = require("./status");
    for (const r of expiredIds) clearStale(r.impacted, r.id);
  } catch {
    /* status module optional */
  }
  return count;
}

function listOpen() {
  return readAllRCOs().filter(
    (e) => e.status === "open" || e.status === undefined,
  );
}

function listByClass(cls) {
  return listOpen().filter((e) => e.riskClass === cls);
}

module.exports = {
  resolve,
  autoExpire,
  listOpen,
  listByClass,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (cmd === "--auto-expire") {
    const days = parseInt(args[1] || "30", 10);
    const n = autoExpire(days);
    console.log(`Auto-expired ${n} RCOs older than ${days} days.`);
  } else if (cmd === "--resolve") {
    const id = args[1];
    const status = args[2];
    const notes = args[3] || "";
    const out = resolve(id, status, notes);
    console.log(JSON.stringify(out, null, 2));
  } else if (cmd === "--list-open") {
    console.log(JSON.stringify(listOpen(), null, 2));
  } else {
    console.error(
      "Usage:\n" +
        "  node scripts/requirements/apply-rco.js --auto-expire [days]\n" +
        "  node scripts/requirements/apply-rco.js --resolve <id> <applied|dismissed|expired> [notes]\n" +
        "  node scripts/requirements/apply-rco.js --list-open",
    );
    process.exit(2);
  }
}
