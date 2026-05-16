#!/usr/bin/env node

/**
 * scripts/sprint/migrate-v0.2.js — Sprint Workflow v0.1 → v0.2 migration.
 *
 * Moves a sprint that still lives in the v0.1 singleton layout
 * (`current-sprint.yaml` + `sprint-progress.yaml` directly under
 * paths.sprintRoot) into the v0.2 per-sprint layout under
 * `sprints/<SP-id>/current.yaml` + `progress.yaml`, and flips the
 * matching entry in paths.sprintActiveRegistry from
 * `layout: legacy_root` to `layout: per_sprint_subdir`.
 *
 * Subcommands:
 *   --dry-run     Print COPY C-8 move plan. No disk mutation.
 *   --apply       Backup → copy → semantic-verify → operator confirm (C-7)
 *                 → flip registry → delete legacy → record approval +
 *                 emit TR-6.
 *   --rollback    Restore most recent backup. Removes the new
 *                 sprints/<id>/* directory, restores legacy files,
 *                 reverts the registry to legacy_root.
 *
 * Common flags:
 *   --sprint <SP-id>           Target a specific sprint id. Defaults to
 *                              the primary entry in active-sprints.yaml.
 *   --approval <AP-id>         The pending approval to mark `approved`
 *                              when the operator confirms. Defaults to
 *                              the linked_ticket's approval if one
 *                              exists in paths.sprintApprovals/.
 *   --i-confirm-deletion       Non-interactive ack of COPY C-7. Required
 *                              when stdin is not a TTY (CI, scripts).
 *
 * Idempotent. Safe to run twice — second --apply detects "already
 * migrated" and exits 0 without changes. Crash-safe — a partial
 * migration (new files written, registry flipped, but legacy not
 * deleted) is recoverable by re-running --apply.
 *
 * Exit codes:
 *   0   success (migration done OR already migrated OR dry-run printed)
 *   1   declined (operator answered `n` to C-7)
 *   2   bad usage
 *   3   verify failed
 *   4   nothing to migrate (sprint already per_sprint_subdir, or
 *       --rollback found no backup)
 *
 * Linked: T-20260512-004; AC-4.1 dry-run no-op, AC-4.2 apply moves
 * files + writes registry, AC-4.3 byte-equivalence verify, AC-4.4
 * operator confirm. Emits TR-6 (sprint.migration.applied).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const SPRINT = require("./paths");
const {
  ensureDir,
  readText,
  readYamlMaybe,
  writeYaml,
  nowIso,
} = require("./fs");
const { logEvent } = require("../hooks/lib/logger");

const BACKUP_ROOT_REL = ".claude/runtime/migrate-v0.2-backup";

// ─────────────────────────── CLI parse ───────────────────────────

function parseArgs(argv) {
  const out = {
    dryRun: false,
    apply: false,
    rollback: false,
    sprint: null,
    approval: null,
    iConfirm: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--apply") out.apply = true;
    else if (a === "--rollback") out.rollback = true;
    else if (a === "--i-confirm-deletion") out.iConfirm = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--sprint") out.sprint = argv[++i] || null;
    else if (a === "--approval") out.approval = argv[++i] || null;
    // Silent on unknown to keep argv simple for sprint helpers.
  }
  return out;
}

function usage(stream = process.stdout) {
  stream.write(
    [
      "usage: node scripts/sprint/migrate-v0.2.js [--dry-run|--apply|--rollback]",
      "                                            [--sprint <SP-id>]",
      "                                            [--approval <AP-id>]",
      "                                            [--i-confirm-deletion]",
      "",
      "  --dry-run     print move plan (default if no action flag given)",
      "  --apply       perform migration (prompts for legacy delete)",
      "  --rollback    restore most recent backup for the sprint",
      "",
    ].join("\n"),
  );
}

// ─────────────────────────── helpers ─────────────────────────────

function readRegistry() {
  if (!fs.existsSync(SPRINT.activeRegistry)) return null;
  return readYamlMaybe(SPRINT.activeRegistry);
}

function findEntry(reg, sid) {
  if (!reg || !Array.isArray(reg.sprints)) return null;
  return reg.sprints.find((s) => s.id === sid) || null;
}

function resolveSprintId(args, reg) {
  if (args.sprint) return args.sprint;
  if (reg && reg.primary) return reg.primary;
  return null;
}

function newSubdir(sid) {
  return path.join(SPRINT.sprints, sid);
}

function newCurrentPath(sid) {
  return path.join(newSubdir(sid), "current.yaml");
}

function newProgressPath(sid) {
  return path.join(newSubdir(sid), "progress.yaml");
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

function countFields(v) {
  // Counts every scalar leaf in the parsed structure. Used as the
  // verified_field_count emitted in TR-6 evidence.
  if (v === null || v === undefined) return 1;
  if (typeof v !== "object") return 1;
  if (Array.isArray(v)) {
    let n = 0;
    for (const x of v) n += countFields(x);
    return n || 1;
  }
  let n = 0;
  for (const k of Object.keys(v)) n += countFields(v[k]);
  return n || 1;
}

function ts() {
  return nowIso().replace(/[:.]/g, "-");
}

function backupDirFor(sid) {
  return path.join(SPRINT.PROJECT, BACKUP_ROOT_REL, `${sid}-${ts()}`);
}

function findLatestBackup(sid) {
  const root = path.join(SPRINT.PROJECT, BACKUP_ROOT_REL);
  if (!fs.existsSync(root)) return null;
  const candidates = fs
    .readdirSync(root)
    .filter((d) => d.startsWith(`${sid}-`))
    .map((d) => path.join(root, d))
    .filter((p) => fs.statSync(p).isDirectory());
  if (candidates.length === 0) return null;
  candidates.sort();
  return candidates[candidates.length - 1];
}

function writeBackup(backupDir, meta, legacyCurrentText, legacyProgressText) {
  ensureDir(backupDir);
  if (legacyCurrentText !== null) {
    fs.writeFileSync(
      path.join(backupDir, "legacy-current.yaml"),
      legacyCurrentText,
      "utf8",
    );
  }
  if (legacyProgressText !== null) {
    fs.writeFileSync(
      path.join(backupDir, "legacy-progress.yaml"),
      legacyProgressText,
      "utf8",
    );
  }
  // Also stash a copy of the registry pre-migration so --rollback can
  // restore the exact pre-state without guessing the prior pointer.
  const regText = readText(SPRINT.activeRegistry);
  if (regText !== null) {
    fs.writeFileSync(
      path.join(backupDir, "active-sprints.pre.yaml"),
      regText,
      "utf8",
    );
  }
  fs.writeFileSync(
    path.join(backupDir, "meta.json"),
    JSON.stringify(meta, null, 2) + "\n",
    "utf8",
  );
}

function flipRegistry(reg, sid) {
  const next = JSON.parse(JSON.stringify(reg));
  const e = (next.sprints || []).find((s) => s.id === sid);
  if (!e) return null;
  e.layout = "per_sprint_subdir";
  e.pointer = path
    .relative(SPRINT.PROJECT, newSubdir(sid))
    .split(path.sep)
    .join("/");
  e.updated_at = nowIso();
  next.updated_at = nowIso();
  return next;
}

function revertRegistry(reg, sid, priorEntry) {
  const next = JSON.parse(JSON.stringify(reg));
  const e = (next.sprints || []).find((s) => s.id === sid);
  if (!e) return null;
  if (priorEntry) {
    e.layout = priorEntry.layout || "legacy_root";
    e.pointer = priorEntry.pointer || ".claude/project/sprint";
  } else {
    e.layout = "legacy_root";
    e.pointer = ".claude/project/sprint";
  }
  e.updated_at = nowIso();
  next.updated_at = nowIso();
  return next;
}

function defaultApprovalForSprint(sid) {
  // Find a paths.sprintApprovals/AP-*.yaml whose linked_ticket is the
  // migration ticket for `sid`. Used when --approval isn't supplied.
  // Best-effort: returns the first match or null.
  try {
    const dir = SPRINT.approvals;
    if (!fs.existsSync(dir)) return null;
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith("AP-") || !f.endsWith(".yaml")) continue;
      const ap = readYamlMaybe(path.join(dir, f));
      if (!ap) continue;
      if (
        ap.sprint === sid &&
        (ap.required_for === "destructive_migration" ||
          /migration/i.test(String(ap.required_for || "")))
      ) {
        return { id: ap.id || path.basename(f, ".yaml"), file: f };
      }
    }
  } catch {
    /* best-effort */
  }
  return null;
}

function recordApprovalAccepted(apId, sid) {
  if (!apId) return { wrote: false, reason: "no_approval_id" };
  const apFile = path.join(SPRINT.approvals, `${apId}.yaml`);
  const ap = readYamlMaybe(apFile);
  if (!ap) return { wrote: false, reason: "approval_missing" };
  if (ap.state === "approved")
    return { wrote: false, reason: "already_approved" };
  ap.state = "approved";
  ap.decided_by = "alpha";
  ap.decided_at = nowIso();
  ap.updated_at = nowIso();
  if (!Array.isArray(ap.evidence)) ap.evidence = [];
  ap.evidence.push({
    kind: "migration_confirmed",
    sprint: sid,
    at: ap.decided_at,
  });
  writeYaml(apFile, ap);
  return { wrote: true, file: apFile };
}

// ─────────────────────────── prompt ──────────────────────────────

function promptConfirm(legacyCurrent, legacyProgress) {
  // Synchronous-feeling read-y/N. readline.question is async; we wrap
  // it in a Promise so main() can `await` it cleanly.
  const text = [
    "",
    "Migration verified — every field of the legacy tracker is present in the new layout.",
    "Delete legacy files at:",
    `  - ${rel(legacyCurrent)}`,
    `  - ${rel(legacyProgress)}`,
    "Confirm? [y/N]: ",
  ].join("\n");
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    rl.question(text, (answer) => {
      rl.close();
      const a = String(answer || "")
        .trim()
        .toLowerCase();
      resolve(a === "y" || a === "yes");
    });
  });
}

// ─────────────────────────── actions ─────────────────────────────

function rel(p) {
  return path.relative(SPRINT.PROJECT, p).split(path.sep).join("/");
}

function dryRun(sid, paths) {
  const out = [
    "DRY RUN — no files changed.",
    `Would create: ${rel(newSubdir(sid))}/`,
    "Would move:",
    `  - ${rel(paths.legacyCurrent)} -> sprints/${sid}/current.yaml`,
    `  - ${rel(paths.legacyProgress)} -> sprints/${sid}/progress.yaml`,
    `Would write: ${rel(SPRINT.activeRegistry)} (primary: ${sid}, layout: per_sprint_subdir).`,
    "Re-run with --apply to perform the migration.",
    "",
  ].join("\n");
  process.stdout.write(out);
  return 0;
}

async function apply(args, sid, paths, entry, reg) {
  const newCurrentExists = fs.existsSync(paths.newCurrent);
  const newProgressExists = fs.existsSync(paths.newProgress);
  const legacyCurrentExists = fs.existsSync(paths.legacyCurrent);
  const legacyProgressExists = fs.existsSync(paths.legacyProgress);

  // Idempotency: already per_sprint_subdir AND new files exist AND no
  // legacy files → nothing to do.
  if (
    entry &&
    entry.layout === "per_sprint_subdir" &&
    newCurrentExists &&
    newProgressExists &&
    !legacyCurrentExists &&
    !legacyProgressExists
  ) {
    process.stdout.write(
      `migrate-v0.2: ${sid} is already migrated (layout=per_sprint_subdir, no legacy files). No action.\n`,
    );
    return 0;
  }

  if (!legacyCurrentExists && !legacyProgressExists && !newCurrentExists) {
    process.stderr.write(
      `migrate-v0.2: nothing to migrate for ${sid} — no legacy or new files found.\n`,
    );
    return 4;
  }

  // 0. Pre-flight: if we will need an interactive prompt later (legacy
  // files still exist AND --i-confirm-deletion was not supplied), make
  // sure stdin is a TTY BEFORE any disk mutation. Otherwise we'd leave
  // a partial sprints/<id>/ subdir behind on a non-interactive refusal.
  const willNeedPrompt =
    (legacyCurrentExists || legacyProgressExists) && !args.iConfirm;
  if (willNeedPrompt && !process.stdin.isTTY) {
    process.stderr.write(
      "migrate-v0.2: interactive confirmation required. Re-run from a TTY, or pass --i-confirm-deletion to ack non-interactively.\n",
    );
    return 2;
  }

  // 1. Backup
  const legacyCurrentText = readText(paths.legacyCurrent);
  const legacyProgressText = readText(paths.legacyProgress);
  const backupDir = backupDirFor(sid);
  const meta = {
    sprint_id: sid,
    ts: nowIso(),
    legacy_current_path: paths.legacyCurrent,
    legacy_progress_path: paths.legacyProgress,
    new_current_path: paths.newCurrent,
    new_progress_path: paths.newProgress,
    registry_path: SPRINT.activeRegistry,
    prior_entry: entry,
  };
  writeBackup(backupDir, meta, legacyCurrentText, legacyProgressText);
  process.stdout.write(
    `migrate-v0.2: backed up to ${path.relative(SPRINT.PROJECT, backupDir)}\n`,
  );

  // 2. Copy legacy → new (only when legacy still exists; partial-state
  // recovery handles the new-files-already-present case below).
  ensureDir(newSubdir(sid));
  if (legacyCurrentText !== null && !newCurrentExists) {
    fs.writeFileSync(paths.newCurrent, legacyCurrentText, "utf8");
  }
  if (legacyProgressText !== null && !newProgressExists) {
    fs.writeFileSync(paths.newProgress, legacyProgressText, "utf8");
  }

  // 3. Verify semantic equivalence (yaml round-trip allowed; semantic
  // equivalence required per AC-4.3).
  let fieldCount = 0;
  if (legacyCurrentText !== null) {
    const lc = readYamlMaybe(paths.legacyCurrent);
    const nc = readYamlMaybe(paths.newCurrent);
    if (!deepEqual(lc, nc)) {
      process.stderr.write(
        "migrate-v0.2: verify FAILED — current.yaml differs after copy.\n",
      );
      return 3;
    }
    fieldCount += countFields(lc);
  }
  if (legacyProgressText !== null) {
    const lp = readYamlMaybe(paths.legacyProgress);
    const np = readYamlMaybe(paths.newProgress);
    if (!deepEqual(lp, np)) {
      process.stderr.write(
        "migrate-v0.2: verify FAILED — progress.yaml differs after copy.\n",
      );
      return 3;
    }
    fieldCount += countFields(lp);
  }

  // 4. Prompt operator (COPY C-7). Skip when --i-confirm-deletion or
  // when there's nothing left to delete (legacy files already gone).
  let confirmed;
  if (!legacyCurrentExists && !legacyProgressExists) {
    // Crash-recovery branch: legacy already deleted last run; we just
    // need to finish the flip and approval. No prompt.
    confirmed = true;
  } else if (args.iConfirm) {
    confirmed = true;
  } else if (!process.stdin.isTTY) {
    process.stderr.write(
      "migrate-v0.2: interactive confirmation required. Re-run from a TTY, or pass --i-confirm-deletion to ack non-interactively.\n",
    );
    return 2;
  } else {
    confirmed = await promptConfirm(paths.legacyCurrent, paths.legacyProgress);
  }

  if (!confirmed) {
    // Decline: cleanup the new dir we just created so the workspace
    // returns to pre-migration state. Backup is preserved.
    try {
      if (fs.existsSync(paths.newCurrent) && !newCurrentExists)
        fs.unlinkSync(paths.newCurrent);
      if (fs.existsSync(paths.newProgress) && !newProgressExists)
        fs.unlinkSync(paths.newProgress);
      // Remove dir only if it is empty (don't trample existing ralph/etc).
      const dir = newSubdir(sid);
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
      }
    } catch {
      /* best-effort */
    }
    process.stderr.write(
      "migrate-v0.2: declined. Legacy files preserved; new copies removed. Registry unchanged.\n",
    );
    return 1;
  }

  // 5. Flip registry BEFORE deleting legacy. After this point,
  // SPRINT.current / SPRINT.progress resolve to the new location.
  const flipped = flipRegistry(reg, sid);
  if (flipped) writeYaml(SPRINT.activeRegistry, flipped);

  // 6. Delete legacy files.
  let legacyDeleted = false;
  try {
    if (legacyCurrentExists) fs.unlinkSync(paths.legacyCurrent);
    if (legacyProgressExists) fs.unlinkSync(paths.legacyProgress);
    legacyDeleted = true;
  } catch (e) {
    process.stderr.write(
      `migrate-v0.2: warning — could not delete legacy files: ${String(e).slice(0, 200)}\n`,
    );
  }

  // 7. Record approval.
  const apId =
    args.approval || (defaultApprovalForSprint(sid) || {}).id || null;
  const apRes = recordApprovalAccepted(apId, sid);
  if (apRes.wrote) {
    process.stdout.write(
      `migrate-v0.2: approval ${apId} marked approved (${path.relative(SPRINT.PROJECT, apRes.file)}).\n`,
    );
  } else if (apId) {
    process.stdout.write(
      `migrate-v0.2: approval ${apId} not updated (${apRes.reason}).\n`,
    );
  }

  // 8. Emit TR-6.
  logEvent(
    "migration",
    "alpha",
    "sprint.migration.applied",
    sid,
    `legacy_paths_deleted=${legacyDeleted} verified_field_count=${fieldCount}`,
    {
      sprint_id: sid,
      legacy_paths_deleted: legacyDeleted,
      verified_field_count: fieldCount,
      backup_dir: path.relative(SPRINT.PROJECT, backupDir),
      approval_id: apId,
    },
  );

  process.stdout.write(
    `migrate-v0.2: ${sid} migrated to per_sprint_subdir. backup=${path.relative(SPRINT.PROJECT, backupDir)} fields=${fieldCount}\n`,
  );
  return 0;
}

function rollback(sid, paths, reg) {
  const backupDir = findLatestBackup(sid);
  if (!backupDir) {
    process.stderr.write(
      `migrate-v0.2: --rollback found no backup for ${sid} under ${BACKUP_ROOT_REL}/\n`,
    );
    return 4;
  }
  const metaPath = path.join(backupDir, "meta.json");
  let meta = null;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch {
    /* meta missing/corrupt — fall back to convention paths */
  }
  const bCurrent = path.join(backupDir, "legacy-current.yaml");
  const bProgress = path.join(backupDir, "legacy-progress.yaml");
  const bRegistry = path.join(backupDir, "active-sprints.pre.yaml");

  // 1. Restore legacy files.
  if (fs.existsSync(bCurrent)) {
    ensureDir(path.dirname(paths.legacyCurrent));
    fs.copyFileSync(bCurrent, paths.legacyCurrent);
  }
  if (fs.existsSync(bProgress)) {
    ensureDir(path.dirname(paths.legacyProgress));
    fs.copyFileSync(bProgress, paths.legacyProgress);
  }

  // 2. Remove new files (only the ones the migration would have
  // created — don't blow away the whole subdir if other state is in it).
  try {
    if (fs.existsSync(paths.newCurrent)) fs.unlinkSync(paths.newCurrent);
    if (fs.existsSync(paths.newProgress)) fs.unlinkSync(paths.newProgress);
    const dir = newSubdir(sid);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  } catch {
    /* best-effort */
  }

  // 3. Revert registry. Prefer the byte-exact pre-migration registry if
  // we captured one; otherwise reconstruct from `prior_entry` in meta.
  if (fs.existsSync(bRegistry)) {
    fs.copyFileSync(bRegistry, SPRINT.activeRegistry);
  } else {
    const reverted = revertRegistry(
      reg,
      sid,
      meta && meta.prior_entry ? meta.prior_entry : null,
    );
    if (reverted) writeYaml(SPRINT.activeRegistry, reverted);
  }

  // 4. Emit TR-6 (rollback variant).
  logEvent(
    "migration",
    "alpha",
    "sprint.migration.rolled_back",
    sid,
    `backup=${path.relative(SPRINT.PROJECT, backupDir)}`,
    { sprint_id: sid, backup_dir: path.relative(SPRINT.PROJECT, backupDir) },
  );

  process.stdout.write(
    `migrate-v0.2: rolled back ${sid} from backup ${path.relative(SPRINT.PROJECT, backupDir)}.\n`,
  );
  return 0;
}

// ─────────────────────────── main ────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    return 0;
  }

  // Default = dry-run when no action flag is given.
  if (!args.dryRun && !args.apply && !args.rollback) args.dryRun = true;

  const reg = readRegistry();
  if (!reg) {
    process.stderr.write(
      `migrate-v0.2: ${SPRINT.activeRegistry} not found. Run scripts/sprint/init.js first.\n`,
    );
    return 2;
  }

  const sid = resolveSprintId(args, reg);
  if (!sid) {
    process.stderr.write(
      "migrate-v0.2: no sprint id (registry has no `primary` and --sprint not given).\n",
    );
    return 2;
  }
  const entry = findEntry(reg, sid);
  if (!entry) {
    process.stderr.write(
      `migrate-v0.2: ${sid} not in registry. See ${SPRINT.activeRegistry}.\n`,
    );
    return 2;
  }

  const paths = {
    legacyCurrent: SPRINT.LEGACY_CURRENT,
    legacyProgress: SPRINT.LEGACY_PROGRESS,
    newCurrent: newCurrentPath(sid),
    newProgress: newProgressPath(sid),
  };

  if (args.rollback) return rollback(sid, paths, reg);

  if (entry.layout === "per_sprint_subdir") {
    const legacyStillThere =
      fs.existsSync(paths.legacyCurrent) || fs.existsSync(paths.legacyProgress);
    if (!legacyStillThere) {
      process.stdout.write(
        `migrate-v0.2: ${sid} already migrated (layout=per_sprint_subdir, no legacy files).\n`,
      );
      return 0;
    }
    // Registry already flipped but legacy lingers — finish the cleanup.
  }

  if (args.dryRun && !args.apply) return dryRun(sid, paths);
  return await apply(args, sid, paths, entry, reg);
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(
        `migrate-v0.2: fatal: ${err && err.stack ? err.stack : err}\n`,
      );
      process.exit(1);
    });
}

module.exports = { main, parseArgs };
