#!/usr/bin/env node
/* WarpOS 0.1.x -> 0.2.0 migration 002 — rename requirements/ to _requirements/.
 *
 * Bundles the chapter renumber (04-architecture -> 03-architecture etc.) and
 * removes the duplicate 03-requirement-standards/ if _standards/ is present.
 * Idempotent.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const RENUMBER = [
  ["04-architecture", "03-architecture"],
  ["05-features", "04-features"],
  ["06-operations", "05-operations"],
  ["07-security", "06-security"],
  ["08-testing", "07-testing"],
  ["09-automation", "08-automation"],
  ["99-audits", "_audits"],
];

function resolveRoot(ctx) {
  return (
    (ctx && ctx.targetRoot) || process.env.CLAUDE_PROJECT_DIR || process.cwd()
  );
}

function isGit(root) {
  return fs.existsSync(path.join(root, ".git"));
}

function gitMv(root, from, to) {
  if (isGit(root)) {
    const r = spawnSync("git", ["mv", from, to], {
      cwd: root,
      encoding: "utf8",
    });
    return r.status === 0;
  }
  fs.renameSync(path.join(root, from), path.join(root, to));
  return true;
}

function gitRm(root, target) {
  const abs = path.join(root, target);
  if (!fs.existsSync(abs)) return true;
  if (isGit(root)) {
    const r = spawnSync("git", ["rm", "-rf", target], {
      cwd: root,
      encoding: "utf8",
    });
    return r.status === 0;
  }
  fs.rmSync(abs, { recursive: true, force: true });
  return true;
}

function rename(root) {
  const OLD = path.join(root, "requirements");
  const NEW = path.join(root, "_requirements");
  const log = [];
  if (fs.existsSync(NEW) && !fs.existsSync(OLD)) {
    return {
      ok: true,
      status: "noop",
      reason: "_requirements/ already present",
      log,
    };
  }
  if (!fs.existsSync(OLD)) {
    return { ok: true, status: "noop", reason: "requirements/ not found", log };
  }
  if (fs.existsSync(NEW)) {
    return {
      ok: false,
      status: "conflict",
      reason: "BOTH requirements/ and _requirements/ exist — manual review",
      log,
    };
  }
  // Step 1: remove duplicate 03-requirement-standards if _standards/ present.
  const dupe = path.join(OLD, "03-requirement-standards");
  if (fs.existsSync(dupe) && fs.existsSync(path.join(OLD, "_standards"))) {
    const dupePath = "requirements/03-requirement-standards"; // path-literal-allowed: migration data
    gitRm(root, dupePath);
    log.push(`removed ${dupePath}/ (dup of _standards/)`);
  }
  // Step 2: chapter renumber (under old top-level name for cleaner git history).
  for (const [from, to] of RENUMBER) {
    const fromAbs = path.join(OLD, from);
    const toAbs = path.join(OLD, to);
    if (fs.existsSync(fromAbs) && !fs.existsSync(toAbs)) {
      gitMv(root, `requirements/${from}`, `requirements/${to}`);
      log.push(`renumbered ${from} -> ${to}`);
    }
  }
  // Step 3: top-level rename.
  if (!gitMv(root, "requirements", "_requirements")) {
    return { ok: false, status: "rename-failed", reason: "git mv failed", log };
  }
  log.push("renamed requirements/ -> _requirements/");
  return { ok: true, status: "renamed", log };
}

async function apply(ctx) {
  return rename(resolveRoot(ctx));
}

function main() {
  const r = rename(resolveRoot(null));
  for (const line of r.log) console.log(`[002] ${line}`);
  if (r.reason) console.log(`[002] ${r.status}: ${r.reason}`);
  return r.ok ? 0 : 1;
}

if (require.main === module) process.exit(main());

module.exports = {
  id: "002-rename-requirements-to-_requirements",
  from: "0.1.x",
  to: "0.2.0",
  description:
    "Rename requirements/ -> _requirements/, renumber chapters, drop dup 03-requirement-standards",
  apply,
  main,
};
