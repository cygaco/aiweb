#!/usr/bin/env node
/**
 * delta-pre-clean-worktrees.js — pre-flight cleanup for stale agent/<feature>
 * worktrees from prior sessions.
 *
 * HYGIENE Rule 70 — origin: run-12 BUG-080 (cross-session worktree leakage).
 *
 * Enumerates all worktrees holding agent/<feature> branches NOT in this run's
 * canonical .worktrees/wt-<feature> location, and force-removes them. The
 * canonical location for run-N is `.worktrees/wt-<feature>`. Anything else
 * is a stale leftover from a prior session (typically auto-generated
 * session-prefixed names like `.worktrees/wt-06c402-1adb`).
 *
 * Usage:
 *   node scripts/delta-pre-clean-worktrees.js          # interactive: list + prompt
 *   node scripts/delta-pre-clean-worktrees.js --force  # auto-remove without prompt
 *   node scripts/delta-pre-clean-worktrees.js --dry-run
 *
 * Exit codes:
 *   0 — clean (or removals applied successfully)
 *   1 — would remove (dry-run mode)
 *   2 — error
 */
const { execSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const flags = process.argv.slice(2);
const isForce = flags.includes("--force");
const isDryRun = flags.includes("--dry-run");

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      ...opts,
    });
  } catch (e) {
    return { error: e.message, stdout: e.stdout?.toString() || "" };
  }
}

// `git worktree list --porcelain` returns blocks like:
//   worktree <path>
//   HEAD <sha>
//   branch refs/heads/<branchname>
//   <blank line>
function parseWorktrees(output) {
  const blocks = output.split(/\n\n/).filter(Boolean);
  const result = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const wt = {};
    for (const line of lines) {
      const [key, ...rest] = line.split(" ");
      const val = rest.join(" ");
      if (key === "worktree") wt.path = val;
      else if (key === "branch") wt.branch = val.replace(/^refs\/heads\//, "");
      else if (key === "HEAD") wt.head = val;
    }
    if (wt.path) result.push(wt);
  }
  return result;
}

const list = run("git worktree list --porcelain");
if (typeof list !== "string") {
  console.error("[pre-clean] failed to list worktrees:", list.error);
  process.exit(2);
}

const worktrees = parseWorktrees(list);
const stale = [];
const main =
  worktrees.find((w) => w.path === ROOT.replace(/\\/g, "/")) || worktrees[0];

for (const wt of worktrees) {
  if (wt === main) continue;
  if (!wt.branch || !wt.branch.startsWith("agent/")) continue;
  // Canonical location for THIS run is `.worktrees/wt-<feature>` relative to ROOT
  const featureName = wt.branch.replace(/^agent\//, "");
  const canonical = path
    .join(ROOT, ".worktrees", `wt-${featureName}`)
    .replace(/\\/g, "/");
  const wtPath = wt.path.replace(/\\/g, "/");
  if (wtPath !== canonical) {
    stale.push({ path: wt.path, branch: wt.branch, canonical });
  }
}

if (stale.length === 0) {
  console.log("[pre-clean] no stale agent/<feature> worktrees");
  process.exit(0);
}

console.log(`[pre-clean] found ${stale.length} stale worktree(s):`);
for (const s of stale) {
  console.log(`  ${s.branch}  at  ${s.path}  (expected ${s.canonical})`);
}

if (isDryRun) {
  console.log("[pre-clean] --dry-run: not removing");
  process.exit(1);
}

if (!isForce) {
  console.log(
    "[pre-clean] add --force to remove these worktrees, or --dry-run to skip",
  );
  process.exit(1);
}

let failures = 0;
for (const s of stale) {
  const r = run(`git worktree remove --force "${s.path}"`);
  if (typeof r !== "string") {
    console.error(`[pre-clean] FAIL: ${s.path} — ${r.error}`);
    failures++;
  } else {
    console.log(`[pre-clean] removed: ${s.path}`);
  }
}

run("git worktree prune");
process.exit(failures > 0 ? 2 : 0);
