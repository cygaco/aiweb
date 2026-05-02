#!/usr/bin/env node
/**
 * delta-cleanup-stale-fix-worktrees.js — find + remove stale agent/<feature>-fix-N
 * worktrees from prior runs so the current run can recreate them fresh.
 *
 * Lists worktrees, identifies any whose branch matches agent/<feature>-fix-<N>,
 * and runs `git worktree remove --force` on them. Idempotent.
 *
 * Usage: node scripts/delta-cleanup-stale-fix-worktrees.js
 */
const { execSync } = require("child_process");

let listing = "";
try {
  listing = execSync("git worktree list --porcelain", {
    encoding: "utf8",
  });
} catch (e) {
  console.error("git worktree list failed:", e.message);
  process.exit(1);
}

const blocks = listing.split(/\n\n+/);
const stale = [];
for (const b of blocks) {
  const branchMatch = b.match(/branch refs\/heads\/(agent\/[\w-]+-fix-\d+)$/m);
  const wtMatch = b.match(/^worktree (.+)$/m);
  if (branchMatch && wtMatch) {
    stale.push({ branch: branchMatch[1], path: wtMatch[1].trim() });
  }
}

if (stale.length === 0) {
  console.log("no stale fix worktrees");
  process.exit(0);
}

console.log(`found ${stale.length} stale fix worktrees:`);
for (const { branch, path } of stale) {
  console.log(`  - ${branch} @ ${path}`);
}

let removed = 0;
let errors = 0;
for (const { path } of stale) {
  try {
    execSync(`git worktree remove --force "${path}"`, { stdio: "pipe" });
    removed++;
  } catch (e) {
    console.error(`failed to remove ${path}: ${e.message.slice(0, 100)}`);
    errors++;
  }
}
try {
  execSync("git worktree prune", { stdio: "pipe" });
} catch {
  /* ok */
}
console.log(`removed=${removed} errors=${errors}`);
