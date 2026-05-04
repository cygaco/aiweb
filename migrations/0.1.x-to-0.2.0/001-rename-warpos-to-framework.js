#!/usr/bin/env node
/* WarpOS 0.1.x -> 0.2.0 migration 001 — rename top-level warpos/ to framework/.
 *
 * Idempotent: no-op if framework/ already exists or warpos/ is missing.
 *
 * Invoked by update.js via migrations-loader (apply()) AND runnable as a CLI
 * (main()).
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function resolveRoot(ctx) {
  return (
    (ctx && ctx.targetRoot) || process.env.CLAUDE_PROJECT_DIR || process.cwd()
  );
}

function rename(root) {
  const OLD = path.join(root, "warpos");
  const NEW = path.join(root, "framework");
  if (fs.existsSync(NEW) && !fs.existsSync(OLD)) {
    return { ok: true, status: "noop", reason: "framework/ already present" };
  }
  if (!fs.existsSync(OLD)) {
    return { ok: true, status: "noop", reason: "warpos/ not found" };
  }
  if (fs.existsSync(NEW)) {
    return {
      ok: false,
      status: "conflict",
      reason: "BOTH warpos/ and framework/ exist — manual review required",
    };
  }
  const isGit = fs.existsSync(path.join(root, ".git"));
  if (isGit) {
    const r = spawnSync("git", ["mv", "warpos", "framework"], {
      cwd: root,
      encoding: "utf8",
    });
    if (r.status !== 0) {
      return { ok: false, status: "git-mv-failed", reason: r.stderr };
    }
  } else {
    fs.renameSync(OLD, NEW);
  }
  return { ok: true, status: "renamed", from: "warpos", to: "framework" };
}

async function apply(ctx) {
  return rename(resolveRoot(ctx));
}

function main() {
  const r = rename(resolveRoot(null));
  console.log(`[001] ${r.status}: ${r.reason || r.to || ""}`);
  return r.ok ? 0 : 1;
}

if (require.main === module) process.exit(main());

module.exports = {
  id: "001-rename-warpos-to-framework",
  from: "0.1.x",
  to: "0.2.0",
  description: "Rename top-level warpos/ to framework/",
  apply,
  main,
};
