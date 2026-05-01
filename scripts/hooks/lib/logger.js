/**
 * logger.js — Centralized event logger for all hooks.
 *
 * Single append-only JSONL log at paths.events/events.jsonl.
 * Replaces scattered logging across system-events.jsonl, events.jsonl,
 * modifications.jsonl, inbox.jsonl, .session-tracking.jsonl, and
 * .session-prompts.log.
 *
 * Multi-instance safe: atomic single-line appendFileSync, session-scoped IDs.
 *
 * Categories:
 *   prompt       — raw user messages (full, untruncated)
 *   audit        — hook actions, guards, lifecycle (was system-events.jsonl)
 *   spec         — spec file changes + STALE tracking (was events.jsonl)
 *   modification — self-modification log (was modifications.jsonl)
 *   inbox        — cross-session messages (was inbox.jsonl)
 *   tool         — tool call tracking (was .session-tracking.jsonl)
 *   decision     — gate checks, approvals, denials
 *   block        — blocked actions (elevated from audit)
 *   lifecycle    — session start/stop/checkpoint
 *   attestation  — learning→enforcement link provenance. Schema:
 *                  data: { learning_id, target, status: "current"|"stale",
 *                           verified_at, reason? }.
 *                  Emitted when /learn:integrate marks a learning implemented,
 *                  and re-emitted by validators when the target disappears.
 *   learning     — tracer event for a learning appended to learnings.jsonl.
 *                  Emitted by logLearning(); the learning entry itself is
 *                  written to paths.learningsFile, not this log.
 *
 * Usage:
 *   const { log, query, logEvent, logLearning } = require("./lib/logger");
 *   log("prompt", { raw, stripped, length, is_slash }, { actor: "user" });
 *   log("tool", { tool: "Bash", success: true, file: "...", keywords: [...] });
 *   logEvent("block", "system", "merge-guard-blocked", "agent/auth", "reason");
 *   logLearning({ intent: "bug_fix", tip: "...", source: "learn:conversation" });
 *   const recent = query({ cat: "inbox", since: Date.now() - 86400000, limit: 5 });
 */

const fs = require("fs");
const path = require("path");
const { PROJECT, PATHS } = require("./paths");

// ── Paths ───────────────────────────────────────────────

const EVENTS_DIR =
  PATHS.events || path.join(PROJECT, ".claude", "project", "events");
const MEMORY_DIR =
  PATHS.memory || path.join(PROJECT, ".claude", "project", "memory");
const RUNTIME_DIR = PATHS.runtime || path.join(PROJECT, ".claude", "runtime");
const LOG_FILE = path.join(EVENTS_DIR, "events.jsonl");
const LEARNINGS_FILE =
  PATHS.learningsFile || path.join(MEMORY_DIR, "learnings.jsonl");
const LOCK_FILE = path.join(PROJECT, ".claude", ".store-lock");
const SESSION_ID_FILE = path.join(RUNTIME_DIR, ".session-id");

// Backward compat: some hooks import EVENTS_FILE
const EVENTS_FILE = LOG_FILE;

// ── Agent system paths (reads team name from manifest) ──
// Graceful: if no manifest or .system dir exists, agent fan-out is skipped
let WORKSPACE = "";
let WORKSPACE_EVENTS = "";
try {
  const { getAgentName } = require("./project-config");
  const agentName = getAgentName();
  // Try new structure first (00-alex/.system), fall back to old (.workspace)
  const agentDir = path.join(PROJECT, ".claude", "agents", `00-${agentName}`);
  const sysDir = path.join(agentDir, ".system");
  const wsDir = path.join(
    PROJECT,
    ".claude",
    "agents",
    agentName,
    ".workspace",
  );
  const dir = fs.existsSync(sysDir)
    ? sysDir
    : fs.existsSync(wsDir)
      ? wsDir
      : "";
  if (dir) {
    WORKSPACE = dir;
    WORKSPACE_EVENTS = path.join(dir, "events.jsonl");
  }
} catch {
  /* no manifest available — global mode */
}

// ── Category fan-out: parallel event files for fast lookup ──
const CATEGORY_FILES = {
  tool: [path.join(EVENTS_DIR, "tools.jsonl")],
  spec: [path.join(EVENTS_DIR, "requirements.jsonl")],
  code: [path.join(EVENTS_DIR, "code.jsonl")],
  plan: [path.join(EVENTS_DIR, "plans.jsonl")],
  requirement_staged: [path.join(EVENTS_DIR, "requirements-staged.jsonl")],
};

// Only add agent fan-out if workspace exists
if (WORKSPACE) {
  CATEGORY_FILES.alpha = [
    path.join(WORKSPACE, "alpha", "events.jsonl"),
    WORKSPACE_EVENTS,
  ];
  CATEGORY_FILES.beta = [
    path.join(WORKSPACE, "beta", "events.jsonl"),
    WORKSPACE_EVENTS,
  ];
  CATEGORY_FILES.gamma = [
    path.join(WORKSPACE, "gamma", "events.jsonl"),
    WORKSPACE_EVENTS,
  ];
}

// ── Session resolution (cached) ─────────────────────────

let _sessionId = null;
function getSessionId() {
  if (_sessionId) return _sessionId;
  try {
    if (fs.existsSync(SESSION_ID_FILE)) {
      _sessionId = fs.readFileSync(SESSION_ID_FILE, "utf8").trim();
    }
  } catch {
    /* ignore */
  }
  return _sessionId || "unknown";
}

// ── ID generation (session-scoped, collision-free) ──────

let _counter = 0;
function nextId() {
  const session = getSessionId();
  const ts = Date.now().toString(36);
  _counter++;
  return `EVT-${session}-${ts}-${_counter}`;
}

// ── Ensure directory exists ─────────────────────────────

let _dirChecked = false;
function ensureDir() {
  if (_dirChecked) return;
  try {
    if (!fs.existsSync(EVENTS_DIR)) {
      fs.mkdirSync(EVENTS_DIR, { recursive: true });
    }
    if (!fs.existsSync(RUNTIME_DIR)) {
      fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    }
    if (!fs.existsSync(MEMORY_DIR)) {
      fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }
    _dirChecked = true;
  } catch {
    /* ignore */
  }
}

// ── Core: log() ─────────────────────────────────────────

/**
 * Append a structured event to the centralized events log.
 *
 * @param {string} cat - Category: "prompt"|"audit"|"spec"|"modification"|"inbox"|"tool"|"decision"|"block"|"lifecycle"
 * @param {object} data - Category-specific payload
 * @param {object} [opts] - Overrides: { actor?, session?, id? }
 */
function log(cat, data, opts) {
  try {
    ensureDir();
    const event = {
      id: (opts && opts.id) || nextId(),
      ts: new Date().toISOString(),
      cat: cat || "audit",
      actor: (opts && opts.actor) || "system",
      session: (opts && opts.session) || getSessionId(),
      data: data || {},
    };
    fs.appendFileSync(LOG_FILE, JSON.stringify(event) + "\n", "utf8");

    // Fan-out: write to category-specific file if mapped
    const catFiles = CATEGORY_FILES[cat];
    if (catFiles) {
      const line = JSON.stringify(event) + "\n";
      for (const f of catFiles) {
        try {
          fs.appendFileSync(f, line, "utf8");
        } catch {
          /* best-effort */
        }
      }
    }
  } catch {
    // Never crash the calling hook — logging is best-effort
  }
}

// ── Backward-compatible: logEvent() ─────────────────────

/**
 * Legacy API — maps to log("audit", ...).
 * All existing hooks that import system-events.js get this automatically.
 *
 * @param {string} type - "prompt"|"tool"|"dispatch"|"store"|"merge"|"block"|"warn"|"decision"|"lifecycle"
 * @param {string} actor - "user"|"alex"|"boss"|"builder"|etc.
 * @param {string} action - Specific action name
 * @param {string} target - File path or feature name
 * @param {string} detail - Human-readable summary (truncated to 200 chars)
 * @param {object} [meta] - Optional structured data
 */
function logEvent(type, actor, action, target, detail, meta) {
  const data = {
    type: type || "unknown",
    action: action || "unknown",
    target: target || "",
    detail: String(detail || "").slice(0, 200),
  };
  if (meta && typeof meta === "object" && Object.keys(meta).length > 0) {
    data.meta = meta;
  }
  log("audit", data, { actor: actor || "unknown" });
}

// ── logLearning() — canonical write path for learnings.jsonl ────
//
// Fixes the "silent write" bug where callers invoked
// `log('conversation_learning', {...})` expecting the entry to land
// in learnings.jsonl — but log() only routes to events.jsonl + its
// category fan-out, never to memory stores.
//
// This helper:
//   1. Appends the learning entry (as-is) to paths.learningsFile
//   2. Emits a tracer event to events.jsonl with cat="learning"
//      so there is a paper trail of when/where it was written.
//
// Usage:
//   const { logLearning } = require("./lib/logger");
//   logLearning({
//     ts: "2026-04-21",
//     intent: "bug_fix",
//     tip: "...",
//     conditions: { ... },
//     status: "logged",
//     score: 0,
//     source: "learn:conversation",
//   });
//
// Validates minimal shape (tip + source required). Silently drops
// malformed entries after emitting a warn event — never crashes the
// caller.
function logLearning(entry, opts) {
  try {
    ensureDir();
    if (!entry || typeof entry !== "object") {
      log("audit", {
        type: "warn",
        action: "learning-drop",
        detail: "logLearning called with non-object entry",
      });
      return false;
    }
    if (!entry.tip || !entry.source) {
      log("audit", {
        type: "warn",
        action: "learning-drop",
        detail: `logLearning missing required field: ${!entry.tip ? "tip" : "source"}`,
      });
      return false;
    }

    // Default fields (non-destructive: only fill missing keys)
    const normalized = {
      ts: entry.ts || new Date().toISOString().slice(0, 10),
      ...entry,
    };
    if (normalized.status === undefined) normalized.status = "logged";
    if (normalized.score === undefined) normalized.score = 0;

    // 1. Append to learnings.jsonl (the primary write)
    fs.appendFileSync(
      LEARNINGS_FILE,
      JSON.stringify(normalized) + "\n",
      "utf8",
    );

    // 2. Tracer event — so events.jsonl shows the paper trail.
    //    Keep data small: enough to find the entry later, not the whole tip.
    log(
      "learning",
      {
        action: "appended",
        source: normalized.source,
        intent: normalized.intent || null,
        tip_preview: String(normalized.tip).slice(0, 120),
      },
      opts,
    );

    return true;
  } catch (e) {
    // Best-effort — never crash caller
    try {
      log("audit", {
        type: "error",
        action: "logLearning-failed",
        detail: String(e).slice(0, 200),
      });
    } catch {
      /* swallow */
    }
    return false;
  }
}

// ── Query: read with filters ────────────────────────────

/**
 * Read events from the log with optional filters.
 * Optimized: substring-matches category before JSON.parse.
 *
 * @param {object} [filters]
 * @param {string} [filters.cat] - Filter by category
 * @param {number} [filters.since] - Only entries after this timestamp (ms)
 * @param {string} [filters.session] - Filter by session ID
 * @param {number} [filters.limit] - Max entries to return (from most recent)
 * @param {string} [filters.search] - Substring match on raw line
 * @returns {object[]} Parsed entries matching filters (most recent last)
 */
function queryFile(file, filters) {
  try {
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, "utf8").trim();
    if (!raw) return [];

    const lines = raw.split("\n");
    const catFilter = filters && filters.cat ? `"cat":"${filters.cat}"` : null;
    const sessionFilter =
      filters && filters.session ? `"session":"${filters.session}"` : null;
    const since = filters && filters.since ? filters.since : null;
    const search =
      filters && filters.search ? filters.search.toLowerCase() : null;
    const limit = filters && filters.limit ? filters.limit : null;

    // Scan from end for limit optimization
    const results = [];
    const startIdx = 0; // always scan full file — sparse categories need full range

    for (let i = lines.length - 1; i >= startIdx; i--) {
      const line = lines[i];
      if (!line) continue;

      // Fast substring filters before JSON.parse
      if (catFilter && !line.includes(catFilter)) continue;
      if (sessionFilter && !line.includes(sessionFilter)) continue;
      if (search && !line.toLowerCase().includes(search)) continue;

      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      // Timestamp filter (requires parsed entry)
      if (since && new Date(entry.ts).getTime() < since) continue;

      results.push(entry);
      if (limit && results.length >= limit) break;
    }

    // Return in chronological order (oldest first)
    results.reverse();
    return results;
  } catch {
    return [];
  }
}

function query(filters) {
  return queryFile(LOG_FILE, filters);
}

/**
 * Query a category-specific file for faster reads.
 * Falls back to full events.jsonl if no category file exists.
 */
function queryCategory(cat, filters) {
  const catFiles = CATEGORY_FILES[cat];
  if (catFiles && catFiles[0] && fs.existsSync(catFiles[0])) {
    return queryFile(catFiles[0], { ...filters, cat });
  }
  return query({ ...filters, cat });
}

// ── Store lock (unchanged from system-events.js) ────────

/**
 * Acquire a simple file-based lock for store.json access.
 * Returns true if lock acquired, false if already held.
 * Lock auto-expires after 10 seconds (stale lock detection).
 */
function acquireStoreLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const stat = fs.statSync(LOCK_FILE);
      const age = Date.now() - stat.mtimeMs;
      if (age < 10000) return false;
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid), "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Release the store.json lock.
 */
function releaseStoreLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
  } catch {
    /* best-effort */
  }
}

// ── Exports ─────────────────────────────────────────────

module.exports = {
  log,
  query,
  queryCategory,
  logEvent,
  logLearning,
  getSessionId,
  acquireStoreLock,
  releaseStoreLock,
  EVENTS_FILE,
  LOG_FILE,
  EVENTS_DIR,
  RUNTIME_DIR,
  MEMORY_DIR,
  LEARNINGS_FILE,
  CATEGORY_FILES,
};
