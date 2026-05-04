#!/usr/bin/env node
/* WarpOS 0.1.x -> 0.2.0 migration 003 — merge docs/ framework dirs into
 * _requirements/ (DOCS WINS — docs was the more-complete copy in 0.1.x), then
 * rename the remainder docs/ -> _docs/ keeping carve-outs only.
 *
 * Conflict policy (per Beta DECIDE 2026-05-04): when both
 * _requirements/<dir>/ (from migration 002) and docs/<dir>/ exist, BACK UP
 * the requirements version into <ctx.backupDir>/conflicts/<dir>/ then
 * overwrite with docs/<dir>/. Same pattern as DELETE_SAFE in update.js.
 *
 * Carve-outs that stay in _docs/ (project-specific, not framework spec):
 *   user-communication, research, karpathy-auto-research.
 *
 * Idempotent.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// path-literal-allowed: migration data (old → new path tuples), not navigation
const DOCS_TO_REQUIREMENTS = [
  ["docs/00-canonical", "_requirements/00-canonical"], // path-literal-allowed: migration data
  ["docs/01-design-system", "_requirements/01-design-system"], // path-literal-allowed: migration data
  ["docs/02-copy-system", "_requirements/02-copy-system"], // path-literal-allowed: migration data
  ["docs/04-architecture", "_requirements/03-architecture"], // path-literal-allowed: migration data
  ["docs/06-integrations", "_requirements/09-integrations"], // path-literal-allowed: migration data
  ["docs/audit-reports", "_requirements/_audits"], // path-literal-allowed: migration data
];

// path-literal-allowed: migration data (old → new path tuples), not navigation
const CARVE_OUTS = [
  ["docs/99-resources/00-user-communication", "docs/user-communication"], // path-literal-allowed: migration data
  ["docs/99-resources/01-research", "docs/research"], // path-literal-allowed: migration data
  ["docs/99-resources/02-karpathy-autoresearch", "docs/karpathy-auto-research"], // path-literal-allowed: migration data
];

function resolveRoot(ctx) {
  return (
    (ctx && ctx.targetRoot) || process.env.CLAUDE_PROJECT_DIR || process.cwd()
  );
}

function resolveBackupDir(ctx, root) {
  if (ctx && ctx.backupDir) return ctx.backupDir;
  // Fallback (CLI mode): use a timestamped dir under .warpos/migrations/
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(root, ".warpos", "migrations", `003-${stamp}`);
}

function isGit(root) {
  return fs.existsSync(path.join(root, ".git"));
}

function gitMv(root, from, to) {
  const fromAbs = path.join(root, from);
  const toAbs = path.join(root, to);
  if (!fs.existsSync(fromAbs) || fs.existsSync(toAbs)) return true;
  fs.mkdirSync(path.dirname(toAbs), { recursive: true });
  if (isGit(root)) {
    const r = spawnSync("git", ["mv", from, to], {
      cwd: root,
      encoding: "utf8",
    });
    if (r.status === 0) return true;
    // Fall back to fs rename if git mv refused (e.g. dest dir untracked).
  }
  fs.renameSync(fromAbs, toAbs);
  return true;
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

function rmDirSync(root, target) {
  const abs = path.join(root, target);
  if (!fs.existsSync(abs)) return;
  if (isGit(root)) {
    const r = spawnSync("git", ["rm", "-rf", target], {
      cwd: root,
      encoding: "utf8",
    });
    if (r.status === 0) return;
  }
  fs.rmSync(abs, { recursive: true, force: true });
}

function migrate(root, backupDir) {
  const OLD = path.join(root, "docs");
  const NEW = path.join(root, "_docs");
  const log = [];
  const conflicts = [];

  if (fs.existsSync(NEW) && !fs.existsSync(OLD)) {
    return {
      ok: true,
      status: "noop",
      reason: "_docs/ already present",
      log,
      conflicts,
    };
  }
  if (!fs.existsSync(OLD)) {
    return {
      ok: true,
      status: "noop",
      reason: "docs/ not found",
      log,
      conflicts,
    };
  }

  // Step 1: lift carve-outs out of 99-resources to docs/<short-name>.
  for (const [from, to] of CARVE_OUTS) {
    if (fs.existsSync(path.join(root, from))) {
      gitMv(root, from, to);
      log.push(`lifted ${from} -> ${to}`);
    }
  }
  try {
    fs.rmdirSync(path.join(root, "docs", "99-resources"));
  } catch {
    /* not empty / not present */
  }

  // Step 2: merge framework dirs into _requirements/ — DOCS WINS.
  for (const [from, to] of DOCS_TO_REQUIREMENTS) {
    const fromAbs = path.join(root, from);
    const toAbs = path.join(root, to);
    if (!fs.existsSync(fromAbs)) continue;
    if (fs.existsSync(toAbs)) {
      // Conflict: back up the loser (requirements/ side, now in _requirements/)
      // before overwriting with docs/ side.
      const backupTarget = path.join(backupDir, "conflicts", to);
      fs.mkdirSync(path.dirname(backupTarget), { recursive: true });
      copyDirSync(toAbs, backupTarget);
      rmDirSync(root, to);
      conflicts.push({
        overwritten: to,
        backupAt: path.relative(root, backupTarget).replace(/\\/g, "/"),
      });
      log.push(
        `backup+overwrite ${to} (loser snapshotted to ${path.relative(root, backupTarget).replace(/\\/g, "/")})`,
      );
    }
    gitMv(root, from, to);
    log.push(`merged ${from} -> ${to}`);
  }

  // Step 3: top-level rename docs/ -> _docs/.
  if (fs.existsSync(OLD) && !fs.existsSync(NEW)) {
    if (isGit(root)) {
      spawnSync("git", ["mv", "docs", "_docs"], {
        cwd: root,
        encoding: "utf8",
      });
    } else {
      fs.renameSync(OLD, NEW);
    }
    log.push("renamed docs/ -> _docs/");
  }

  return { ok: true, status: "migrated", log, conflicts };
}

async function apply(ctx) {
  const root = resolveRoot(ctx);
  return migrate(root, resolveBackupDir(ctx, root));
}

function main() {
  const root = resolveRoot(null);
  const r = migrate(root, resolveBackupDir(null, root));
  for (const line of r.log) console.log(`[003] ${line}`);
  if (r.conflicts.length) {
    console.log(
      `[003] ${r.conflicts.length} conflict(s) backed up before overwrite.`,
    );
  }
  if (r.reason) console.log(`[003] ${r.status}: ${r.reason}`);
  return r.ok ? 0 : 1;
}

if (require.main === module) process.exit(main());

module.exports = {
  id: "003-rename-docs-to-_docs",
  from: "0.1.x",
  to: "0.2.0",
  description:
    "Merge docs/ framework dirs into _requirements/ (docs wins, with backup); rename remainder docs/ -> _docs/",
  apply,
  main,
};
