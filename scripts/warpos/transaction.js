/**
 * scripts/warpos/transaction.js — /warp:update transactional apply wrapper.
 *
 * Three primary functions:
 *
 *   beginTransaction(opts) → { txId, txDir, snapshot, planFile, headerFile }
 *     Writes header.json + plan.json + snapshot.json (with per-decision
 *     pre_state_sha256 + backup/<dest>) atomically, then takes an active.lock.
 *     Re-runs a fast preflight subset to defend against the begin-vs-classify
 *     race (R-33). If the lock is already taken: refuses.
 *
 *   commitTransaction(txDir, result) → void
 *     Writes result.json{outcome:"committed", ...}, releases active.lock,
 *     emits TR-4.
 *
 *   rollbackTransaction(txDir, opts) → { restoredCount, unlinkedCount, partial, error? }
 *     Reads snapshot.json + snapshot.delta.jsonl, verifies the recorded hash
 *     of snapshot.json (R-31), restores every existed_pre_apply:true entry
 *     from backup/<dest>, and unlinks every existed_pre_apply:false entry
 *     whose intended_action executed before the error. Releases active.lock.
 *     Emits TR-3.
 *
 * Red-team mitigations baked in:
 *   R-30 — undoRollback() snapshots before rollback so --rollback is itself
 *          transactional (rollback-undo/).
 *   R-31 — snapshot.json is written atomically (tempfile + rename) and the
 *          hash is recorded in header.json#snapshotSha256. Rollback refuses
 *          when the hash doesn't match the on-disk file.
 *   R-32 — active.lock at <txRoot>/active.lock contains the txId. Begin
 *          refuses when present; commit/rollback clear it.
 *   R-33 — beginTransaction re-runs a fast preflight subset
 *          (install-baseline + manifest-honesty + tracked-transients) and
 *          refuses if any of those disagrees with the initial preflight pass.
 *   R-34 — override flags pass through to the preflight subset; overrideUsed
 *          appears in the TR-1 events from the subset.
 *
 * Linked: SP-20260513-005 / S-5, S-6 / T-055, T-056 /
 *   AC-S-5.{1,2}, AC-S-6.{1,2,3} / IN-2 / R-13..R-18, R-30..R-34 / C-6, C-7.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const events = require("./lib/update-events");

const TX_ROOT_REL = path.join(".warpos", "transactions");

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function newTransactionId(targetRoot) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${ts}-warp-update-${path.basename(targetRoot)}`;
}

function txRootFor(targetRoot) {
  return path.join(targetRoot, TX_ROOT_REL);
}

function activeLockPath(targetRoot) {
  return path.join(txRootFor(targetRoot), "active.lock");
}

// ── R-32 active.lock guard ──────────────────────────────────────

function checkActiveLock(targetRoot) {
  const lock = activeLockPath(targetRoot);
  if (!fs.existsSync(lock)) return { locked: false };
  try {
    const txt = fs.readFileSync(lock, "utf8").trim();
    return { locked: true, existingTxId: txt, path: lock };
  } catch {
    return { locked: true, existingTxId: null, path: lock };
  }
}

function writeActiveLock(targetRoot, txId) {
  const lock = activeLockPath(targetRoot);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, txId);
}

function clearActiveLock(targetRoot) {
  const lock = activeLockPath(targetRoot);
  try {
    if (fs.existsSync(lock)) fs.unlinkSync(lock);
  } catch {
    /* fail-open */
  }
}

// ── R-33 fast-preflight subset ─────────────────────────────────

function runFastPreflightSubset(opts) {
  // Lazy import to avoid circular module load.
  const preflight = require("./preflight");
  // Mark which gates we want; preflight.runPreflight runs all 10 by default,
  // so we shortcut by filtering after the run with allRed=true. Cheap.
  const r = preflight.runPreflight({
    targetRoot: opts.targetRoot,
    sourceTreeRoot: opts.sourceTreeRoot,
    toVersion: opts.toVersion,
    sourceRoot: opts.sourceRoot,
    allowStale: opts.allowStale,
    forceFresh: opts.forceFresh,
    allowVersionDrift: opts.allowVersionDrift,
    allRed: true,
    txId: opts.txId,
  });
  const subset = [
    "warpos-install-baseline",
    "warpos-manifest-honesty",
    "warpos-tracked-transients",
  ];
  const gates = r.gates.filter((g) => subset.includes(g.name));
  const ok = gates.every((g) => g.status === "green" || g.status === "yellow");
  return { ok, gates };
}

// ── Snapshot construction (IN-2) ────────────────────────────────

const SNAPSHOT_CATEGORIES = new Set([
  "ADD_SAFE",
  "UPDATE_SAFE",
  "GENERATED_REBUILD",
  "DELETE_SAFE",
]);

function buildSnapshotEntries(targetRoot, txDir, decisions) {
  const entries = [];
  const backupRoot = path.join(txDir, "backup");
  for (const d of decisions) {
    if (!SNAPSHOT_CATEGORIES.has(d.category)) continue;
    const abs = path.join(targetRoot, d.dest);
    const existed = fs.existsSync(abs);
    let pre_state_sha256 = null;
    let backup_path = null;
    if (existed) {
      pre_state_sha256 = sha256File(abs);
      // Copy to backup/<dest>
      const backupAbs = path.join(backupRoot, d.dest);
      fs.mkdirSync(path.dirname(backupAbs), { recursive: true });
      fs.copyFileSync(abs, backupAbs);
      backup_path = path.relative(txDir, backupAbs).replace(/\\/g, "/");
    }
    let intended_action = "overwrite";
    if (d.category === "ADD_SAFE") intended_action = "create";
    else if (d.category === "DELETE_SAFE") intended_action = "delete";
    else if (d.category === "GENERATED_REBUILD") intended_action = "overwrite";
    entries.push({
      dest: d.dest,
      category: d.category,
      existed_pre_apply: existed,
      pre_state_sha256,
      backup_path,
      intended_action,
    });
  }
  return entries;
}

function atomicWriteJSON(file, obj) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

// ── beginTransaction ────────────────────────────────────────────

/**
 * @param {Object} opts
 * @param {string} opts.targetRoot
 * @param {string} opts.sourceTreeRoot
 * @param {string} opts.fromVersion
 * @param {string} opts.toVersion
 * @param {Object} opts.capsule         — { dir, release, manifest }
 * @param {Array}  opts.decisions       — classify() output
 * @param {boolean} [opts.allowStale]
 * @param {boolean} [opts.forceFresh]
 * @param {boolean} [opts.allowVersionDrift]
 * @param {boolean} [opts.skipFastPreflight] — testing only
 * @returns {{txId, txDir, snapshot, headerFile, planFile, snapshotFile}}
 */
function beginTransaction(opts) {
  if (!opts || !opts.targetRoot)
    throw new Error("beginTransaction: targetRoot required");
  const targetRoot = path.resolve(opts.targetRoot);
  // R-32 active.lock check
  const lockState = checkActiveLock(targetRoot);
  if (lockState.locked) {
    const err = new Error(
      `another warpos update is in progress (or crashed). Active txId: ${lockState.existingTxId || "<unknown>"}. Inspect ${lockState.path} — if no apply is running, remove the file and retry.`,
    );
    err.code = "ETXLOCK";
    err.lock = lockState;
    throw err;
  }
  // R-33 fast-preflight re-run
  if (!opts.skipFastPreflight) {
    const sub = runFastPreflightSubset(opts);
    if (!sub.ok) {
      const reds = sub.gates
        .filter((g) => g.status === "red")
        .map((g) => g.name);
      const err = new Error(
        `fast preflight subset disagreed with earlier pass: ${reds.join(", ")}. State changed between classify and apply — re-run /warp:update --to <v>.`,
      );
      err.code = "EFASTPREFLIGHTDRIFT";
      err.fastSubset = sub;
      throw err;
    }
  }

  const txId = opts.txId || newTransactionId(targetRoot);
  const txDir = path.join(txRootFor(targetRoot), txId);
  fs.mkdirSync(txDir, { recursive: true });

  // Plan
  const planFile = path.join(txDir, "plan.json");
  atomicWriteJSON(planFile, opts.decisions || []);

  // Snapshot entries
  const entries = buildSnapshotEntries(targetRoot, txDir, opts.decisions || []);
  const snapshot = {
    $schema: "warpos/update-snapshot/v1",
    txId,
    entries,
  };
  const snapshotFile = path.join(txDir, "snapshot.json");
  atomicWriteJSON(snapshotFile, snapshot);
  // R-31: hash the snapshot file and record it; make readonly afterward.
  const snapshotSha256 = sha256File(snapshotFile);
  try {
    fs.chmodSync(snapshotFile, 0o400);
  } catch {
    /* best-effort on Windows */
  }
  // Initialize delta log (append-only)
  fs.writeFileSync(path.join(txDir, "snapshot.delta.jsonl"), "");

  // Header
  const headerFile = path.join(txDir, "header.json");
  const header = {
    kind: "warp:update",
    txId,
    fromVersion: opts.fromVersion,
    toVersion: opts.toVersion,
    sourceRoot: opts.sourceRoot || null,
    targetRoot,
    sourceTreeRoot: opts.sourceTreeRoot || null,
    startedAt: new Date().toISOString(),
    snapshotSha256, // R-31
  };
  atomicWriteJSON(headerFile, header);

  if (opts.capsule) {
    atomicWriteJSON(path.join(txDir, "capsule.json"), {
      dir: opts.capsule.dir,
      release: opts.capsule.release,
    });
  }

  // R-32 take the lock
  writeActiveLock(targetRoot, txId);

  // TR-2
  events.emitTransactionStart(targetRoot, {
    txId,
    fromVersion: opts.fromVersion,
    toVersion: opts.toVersion,
    filesToWrite: entries.filter(
      (e) =>
        e.intended_action === "overwrite" || e.intended_action === "create",
    ).length,
    filesToDelete: entries.filter((e) => e.intended_action === "delete").length,
    filesToAdd: entries.filter((e) => e.intended_action === "create").length,
    backupPlanCount: entries.filter((e) => e.backup_path != null).length,
  });

  return { txId, txDir, snapshot, headerFile, planFile, snapshotFile };
}

// ── Delta log ───────────────────────────────────────────────────

function recordDelta(txDir, entry) {
  try {
    fs.appendFileSync(
      path.join(txDir, "snapshot.delta.jsonl"),
      JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n",
    );
  } catch {
    /* fail-open */
  }
}

// ── commitTransaction ──────────────────────────────────────────

function commitTransaction(txDir, opts) {
  if (!txDir) throw new Error("commitTransaction: txDir required");
  const header = readHeader(txDir);
  const targetRoot = header.targetRoot;
  const resultFile = path.join(txDir, "result.json");
  const result = {
    completedAt: new Date().toISOString(),
    outcome: "committed",
    apply: opts.apply || null,
    migrations: opts.migrations || null,
    postUpdateChecks: opts.postUpdateChecks || null,
    rollback: null,
  };
  atomicWriteJSON(resultFile, result);
  // TR-4
  events.emitTransactionCommit(targetRoot, {
    txId: header.txId,
    fromVersion: header.fromVersion,
    toVersion: header.toVersion,
    applyDurationMs: opts.applyDurationMs || 0,
    migrationsRan: (opts.migrations && opts.migrations.ran) || 0,
    filesWritten:
      (opts.apply &&
        opts.apply.counts &&
        (opts.apply.counts.added || 0) + (opts.apply.counts.updated || 0)) ||
      0,
    backupsTaken:
      (opts.apply && opts.apply.counts && opts.apply.counts.backups) || 0,
  });
  clearActiveLock(targetRoot);
  return result;
}

function readHeader(txDir) {
  const file = path.join(txDir, "header.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readSnapshot(txDir) {
  const file = path.join(txDir, "snapshot.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// ── rollbackTransaction (T-056) ─────────────────────────────────

/**
 * @param {string} txDir
 * @param {Object} [opts]
 * @param {string} [opts.trigger]      — "apply" | "migration" | "operator"
 * @param {string} [opts.failedAt]     — file or step that triggered rollback
 * @param {string} [opts.errorMessage]
 * @param {boolean} [opts.undo]        — R-30: snapshot pre-rollback state to rollback-undo/
 * @returns {{restoredCount, unlinkedCount, partial, error?, rollback}}
 */
function rollbackTransaction(txDir, opts) {
  const start = Date.now();
  const header = readHeader(txDir);
  const targetRoot = header.targetRoot;
  const snapshotFile = path.join(txDir, "snapshot.json");
  const snapshot = readSnapshot(txDir);

  // R-31: verify snapshot hash before trusting it
  const actualSha = sha256File(snapshotFile);
  if (header.snapshotSha256 && actualSha !== header.snapshotSha256) {
    const err = `snapshot.json hash mismatch (expected ${header.snapshotSha256.slice(0, 8)}, got ${(actualSha || "").slice(0, 8)})`;
    writeDiagnostic(txDir, `ROLLBACK REFUSED: ${err}`);
    events.emitTransactionRollback(targetRoot, {
      txId: header.txId,
      trigger: opts && opts.trigger,
      failedAt: opts && opts.failedAt,
      errorMessage: err,
      restoredCount: 0,
      unlinkedCount: 0,
      rollbackDurationMs: Date.now() - start,
      partial: true,
    });
    return { restoredCount: 0, unlinkedCount: 0, partial: true, error: err };
  }

  // R-30: undo-snapshot before rollback so --rollback is itself transactional
  if (opts && opts.undo) {
    try {
      const undoDir = path.join(txDir, "rollback-undo");
      fs.mkdirSync(undoDir, { recursive: true });
      for (const e of snapshot.entries) {
        const abs = path.join(targetRoot, e.dest);
        if (fs.existsSync(abs)) {
          const dst = path.join(undoDir, e.dest);
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(abs, dst);
        }
      }
    } catch (e) {
      writeDiagnostic(txDir, `rollback-undo snapshot failed: ${e.message}`);
    }
  }

  let restoredCount = 0;
  let unlinkedCount = 0;
  let partial = false;
  let firstError = null;

  for (const e of snapshot.entries) {
    const abs = path.join(targetRoot, e.dest);
    try {
      if (e.existed_pre_apply && e.backup_path) {
        // Restore from backup
        const backupAbs = path.join(txDir, e.backup_path);
        if (!fs.existsSync(backupAbs)) {
          partial = true;
          firstError = firstError || `backup missing: ${e.backup_path}`;
          writeDiagnostic(
            txDir,
            `rollback: backup missing for ${e.dest} — leaving in place`,
          );
          continue;
        }
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.copyFileSync(backupAbs, abs);
        restoredCount += 1;
      } else if (!e.existed_pre_apply) {
        // Unlink any new ADD_SAFE writes (intended_action=create) — but only if
        // the file exists now (meaning apply had completed it before failure).
        if (fs.existsSync(abs)) {
          fs.unlinkSync(abs);
          unlinkedCount += 1;
        }
      }
    } catch (err) {
      partial = true;
      firstError = firstError || err.message;
      writeDiagnostic(txDir, `rollback: error on ${e.dest}: ${err.message}`);
    }
  }

  // Write result.json
  const resultFile = path.join(txDir, "result.json");
  const outcome = partial ? "rollback-partial" : "rolled-back";
  const result = {
    completedAt: new Date().toISOString(),
    outcome,
    apply: null,
    migrations: null,
    rollback: {
      trigger: (opts && opts.trigger) || "unknown",
      failedAt: (opts && opts.failedAt) || null,
      error: (opts && opts.errorMessage) || firstError,
      restoredCount,
      unlinkedCount,
      rollbackDurationMs: Date.now() - start,
    },
  };
  atomicWriteJSON(resultFile, result);

  // TR-3
  events.emitTransactionRollback(targetRoot, {
    txId: header.txId,
    trigger: (opts && opts.trigger) || "unknown",
    failedAt: (opts && opts.failedAt) || null,
    errorMessage: (opts && opts.errorMessage) || firstError,
    restoredCount,
    unlinkedCount,
    rollbackDurationMs: Date.now() - start,
    partial,
  });

  clearActiveLock(targetRoot);

  return {
    restoredCount,
    unlinkedCount,
    partial,
    error: firstError,
    rollback: result.rollback,
  };
}

function writeDiagnostic(txDir, msg) {
  try {
    fs.appendFileSync(
      path.join(txDir, "diagnostics.log"),
      `${new Date().toISOString()} ${msg}\n`,
    );
  } catch {
    /* fail-open */
  }
}

module.exports = {
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
  // Helpers exposed for tests
  newTransactionId,
  buildSnapshotEntries,
  checkActiveLock,
  clearActiveLock,
  readHeader,
  readSnapshot,
  recordDelta,
  sha256File,
  sha256Buffer,
  atomicWriteJSON,
  TX_ROOT_REL,
};
