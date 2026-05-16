/**
 * scripts/warpos/lib/update-events.js — TR-1..TR-6 emitter for /warp:update.
 *
 * Emits structured events to `paths.eventsFile` (resolved from
 * `.claude/paths.json` under CLAUDE_PROJECT_DIR or the supplied targetRoot,
 * with sensible fallback). Each event is a JSON envelope on a single line:
 *
 *   { id, ts, cat, actor: "system", session, data: {...} }
 *
 * Categories (per trace.md TR-1..TR-6):
 *
 *   warpos.update.preflight              (per-gate + aggregate summary)
 *   warpos.update.transaction.start
 *   warpos.update.transaction.commit
 *   warpos.update.transaction.rollback
 *   warpos.update.postflight             (aggregate)
 *   warpos.update.evidence               (lightweight pointer)
 *
 * Fail-open: any I/O error is swallowed — logging cannot crash the update.
 *
 * Linked: SP-20260513-005 / S-11 / T-061 / AC-S-11.{1,2} / IN-1 / R-22.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function resolveEventsFile(targetRoot) {
  const candidates = [];
  // 1. Explicit env var trumps everything.
  if (process.env.WARPOS_EVENTS_FILE) {
    candidates.push(process.env.WARPOS_EVENTS_FILE);
  }
  // 2. targetRoot/.claude/paths.json → events file
  const roots = [];
  if (targetRoot) roots.push(path.resolve(targetRoot));
  if (process.env.CLAUDE_PROJECT_DIR)
    roots.push(path.resolve(process.env.CLAUDE_PROJECT_DIR));
  roots.push(process.cwd());
  for (const root of roots) {
    try {
      const pathsJson = path.join(root, ".claude", "paths.json");
      if (fs.existsSync(pathsJson)) {
        const raw = JSON.parse(fs.readFileSync(pathsJson, "utf8"));
        if (raw.eventsFile) candidates.push(path.join(root, raw.eventsFile));
      }
    } catch {
      /* fall through */
    }
    // 3. Conventional fallback under the same root.
    candidates.push(
      path.join(root, ".claude", "project", "events", "events.jsonl"),
    );
  }
  // Return the first candidate whose parent dir we can create / write to.
  for (const cand of candidates) {
    try {
      fs.mkdirSync(path.dirname(cand), { recursive: true });
      return cand;
    } catch {
      /* try next */
    }
  }
  return null;
}

function makeId() {
  return crypto.randomBytes(8).toString("hex");
}

function sessionId() {
  return process.env.CLAUDE_SESSION_ID || "warp-update";
}

function writeEnvelope(targetRoot, cat, data) {
  const file = resolveEventsFile(targetRoot);
  if (!file) return; // fail-open
  const envelope = {
    id: makeId(),
    ts: new Date().toISOString(),
    cat,
    actor: "system",
    session: sessionId(),
    data: data || {},
  };
  try {
    fs.appendFileSync(file, JSON.stringify(envelope) + "\n");
  } catch {
    /* fail-open */
  }
}

// ── TR-1: per-gate + aggregate preflight events ─────────────────

function emitPreflightGate(
  targetRoot,
  {
    txId,
    gate,
    status,
    reason,
    remediation,
    durationMs,
    evidence,
    overrideUsed,
  },
) {
  writeEnvelope(targetRoot, "warpos.update.preflight", {
    txId: txId || null,
    phase: "preflight-gate",
    gate,
    status,
    reason,
    remediation: remediation || null,
    durationMs: durationMs || 0,
    evidence: evidence || {},
    overrideUsed: !!overrideUsed,
  });
}

function emitPreflightSummary(
  targetRoot,
  { txId, ok, gateCount, redCount, yellowCount, greenCount, totalDurationMs },
) {
  writeEnvelope(targetRoot, "warpos.update.preflight", {
    txId: txId || null,
    phase: "preflight-summary",
    ok,
    gateCount,
    redCount,
    yellowCount,
    greenCount,
    totalDurationMs: totalDurationMs || 0,
  });
}

// ── TR-2: transaction.start ─────────────────────────────────────

function emitTransactionStart(
  targetRoot,
  {
    txId,
    fromVersion,
    toVersion,
    filesToWrite,
    filesToDelete,
    filesToAdd,
    backupPlanCount,
  },
) {
  writeEnvelope(targetRoot, "warpos.update.transaction.start", {
    txId,
    fromVersion,
    toVersion,
    filesToWrite,
    filesToDelete,
    filesToAdd,
    backupPlanCount,
  });
}

// ── TR-3: transaction.rollback ──────────────────────────────────

function emitTransactionRollback(
  targetRoot,
  {
    txId,
    trigger,
    failedAt,
    errorMessage,
    restoredCount,
    unlinkedCount,
    rollbackDurationMs,
    partial,
  },
) {
  writeEnvelope(targetRoot, "warpos.update.transaction.rollback", {
    txId,
    trigger,
    failedAt: failedAt || null,
    errorMessage: errorMessage || null,
    restoredCount: restoredCount || 0,
    unlinkedCount: unlinkedCount || 0,
    rollbackDurationMs: rollbackDurationMs || 0,
    partial: !!partial,
  });
}

// ── TR-4: transaction.commit ────────────────────────────────────

function emitTransactionCommit(
  targetRoot,
  {
    txId,
    fromVersion,
    toVersion,
    applyDurationMs,
    migrationsRan,
    filesWritten,
    backupsTaken,
  },
) {
  writeEnvelope(targetRoot, "warpos.update.transaction.commit", {
    txId,
    fromVersion,
    toVersion,
    applyDurationMs: applyDurationMs || 0,
    migrationsRan: migrationsRan || 0,
    filesWritten: filesWritten || 0,
    backupsTaken: backupsTaken || 0,
  });
}

// ── TR-5: postflight (aggregate) ────────────────────────────────

function emitPostflight(
  targetRoot,
  {
    txId,
    ok,
    checkCount,
    greenCount,
    yellowCount,
    redCount,
    degradedCount,
    operatorAction,
    evidencePath,
    durationMs,
  },
) {
  writeEnvelope(targetRoot, "warpos.update.postflight", {
    txId,
    ok,
    checkCount,
    greenCount: greenCount || 0,
    yellowCount: yellowCount || 0,
    redCount: redCount || 0,
    degradedCount: degradedCount || 0,
    operatorAction,
    evidencePath: evidencePath || null,
    durationMs: durationMs || 0,
  });
}

// Also emit per-check postflight events (mirrors per-gate preflight pattern).
function emitPostflightCheck(
  targetRoot,
  { txId, check, status, reason, durationMs, evidence },
) {
  writeEnvelope(targetRoot, "warpos.update.postflight", {
    txId,
    phase: "postflight-check",
    check,
    status,
    reason: reason || null,
    durationMs: durationMs || 0,
    evidence: evidence || {},
  });
}

// ── TR-6: evidence pointer ──────────────────────────────────────

function emitEvidence(
  targetRoot,
  { txId, evidencePath, transactionDir, outcome, postflightOk },
) {
  writeEnvelope(targetRoot, "warpos.update.evidence", {
    txId,
    evidencePath,
    transactionDir,
    outcome,
    postflightOk: !!postflightOk,
  });
}

// ── SP-20260514-001 R-5 / T-20260514-076 — three new event kinds ─

// content-hash-mismatch — emitted when contentHash matches but rawHash
// differs (kind=lf_only) or when both differ (kind=real_drift). Informational
// when lf_only — the classifier does NOT escalate to MERGE_CONFLICT.
function emitContentHashMismatch(
  targetRoot,
  { txId, file, contentHashLocal, rawHashLocal, expectedHash, kind },
) {
  writeEnvelope(targetRoot, "warpos.update.content-hash-mismatch", {
    txId: txId || null,
    file,
    contentHashLocal,
    rawHashLocal,
    expectedHash,
    kind: kind === "real_drift" ? "real_drift" : "lf_only",
  });
}

// operator-override-used — emitted by preflight when --operator-override is
// applied to a red gate. `reason` is the operator-supplied --override-reason
// (already validated non-empty + control-char-escaped by the caller; JSONL
// safety is provided by JSON.stringify in writeEnvelope).
function emitOperatorOverrideUsed(
  targetRoot,
  { txId, gate, reason, operator, gateStatusBefore },
) {
  writeEnvelope(targetRoot, "warpos.update.operator-override-used", {
    txId: txId || null,
    gate,
    reason,
    operator: operator || process.env.USER || process.env.USERNAME || "unknown",
    gateStatusBefore: gateStatusBefore || null,
  });
}

// ownership-transitioned — emitted when the classifier promotes a
// framework_template path to project_owned because of a consumer non-
// whitespace edit. Decision recorded in decision-ledger 2026-05-14 (auto
// on non-whitespace edit).
function emitOwnershipTransitioned(
  targetRoot,
  { txId, file, from, to, reason },
) {
  writeEnvelope(targetRoot, "warpos.update.ownership-transitioned", {
    txId: txId || null,
    file,
    from: from || "framework_template",
    to: to || "project_owned",
    reason: reason || "consumer_edit_detected",
  });
}

module.exports = {
  resolveEventsFile,
  emitPreflightGate,
  emitPreflightSummary,
  emitTransactionStart,
  emitTransactionCommit,
  emitTransactionRollback,
  emitPostflight,
  emitPostflightCheck,
  emitEvidence,
  emitContentHashMismatch,
  emitOperatorOverrideUsed,
  emitOwnershipTransitioned,
};
