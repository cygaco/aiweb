#!/usr/bin/env node
// PreToolUse hook (Agent matcher): infrastructure health check before builder dispatch.
//
// Runs BEFORE gate-check.js, gauntlet-gate.js, cycle-enforcer.js.
// Those hooks validate protocol ordering. This hook validates infra:
//
// 1. Cleans orphan worktrees/branches from previous sessions
// 2. Blocks first builder dispatch if no smoke test has run this session
// 3. Warns if run_in_background is not set for builder dispatches
//
// Exit 0 = allow, Exit 2 = block

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

const MARKER_DIR = path.resolve(__dirname, "..", "..", ".claude", "runtime");
const SMOKE_MARKER = path.join(MARKER_DIR, ".worktree-smoke-passed");

function git(args, cwd) {
  try {
    return execSync("git " + args, { cwd, stdio: ["pipe", "pipe", "pipe"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

function isBuilderDispatch(prompt) {
  if (!/^feature:\s*\S+/m.test(prompt)) return false;
  if (
    /evaluator|security|compliance|fix agent|lead/i.test(
      prompt.substring(0, 500),
    )
  )
    return false;
  return true;
}

function cleanOrphanWorktrees(repoRoot) {
  const cleaned = [];

  // Prune stale worktree references
  git("worktree prune", repoRoot);

  // Find and remove orphan agent branches not attached to a worktree
  const worktreeList = git("worktree list --porcelain", repoRoot);
  const activeBranches = new Set();
  for (const line of worktreeList.split("\n")) {
    const m = line.match(/^branch refs\/heads\/(agent\/.+)/);
    if (m) activeBranches.add(m[1]);
  }

  const allBranches = git("branch -l", repoRoot)
    .split("\n")
    .map((b) => b.replace(/^\*?\s+/, "").trim())
    .filter((b) => b.startsWith("agent/"));

  for (const branch of allBranches) {
    if (!activeBranches.has(branch)) {
      git(`branch -D "${branch}"`, repoRoot);
      cleaned.push(branch);
    }
  }

  // Clean stale worktree directories
  const worktreeParent = path.join(path.dirname(repoRoot), ".worktrees");
  if (fs.existsSync(worktreeParent)) {
    const dirs = fs.readdirSync(worktreeParent);
    for (const dir of dirs) {
      const wtPath = path.join(worktreeParent, dir);
      // If this dir isn't in the active worktree list, remove it
      if (!worktreeList.includes(wtPath.replace(/\\/g, "/"))) {
        try {
          git(`worktree remove "${wtPath}" --force`, repoRoot);
        } catch {
          // If git can't remove it, just delete the directory
          try {
            fs.rmSync(wtPath, { recursive: true, force: true });
          } catch {
            // ignore
          }
        }
        cleaned.push(dir);
      }
    }
  }

  return cleaned;
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const prompt = event.tool_input?.prompt || "";

    // Only check builder agent dispatches
    if (!isBuilderDispatch(prompt)) process.exit(0);

    const repoRoot = path.resolve(__dirname, "..", "..");

    // Step 1: Clean orphan worktrees (always, silently)
    const cleaned = cleanOrphanWorktrees(repoRoot);
    if (cleaned.length > 0) {
      process.stderr.write(
        `${YELLOW}[worktree-preflight] Cleaned ${cleaned.length} orphan(s): ${cleaned.join(", ")}${RESET}\n`,
      );
    }

    // Step 1b (GAP-1005): Verify cleanup succeeded — check no stale agent branches remain
    try {
      const remainingBranches = git("branch --list agent/*", repoRoot);
      if (remainingBranches) {
        const stale = remainingBranches
          .split("\n")
          .map((b) => b.trim())
          .filter(Boolean);
        if (stale.length > 0) {
          process.stderr.write(
            `${YELLOW}[worktree-preflight] WARNING: ${stale.length} stale agent branch(es) remain after cleanup: ${stale.join(", ")}${RESET}\n`,
          );
        }
      }
    } catch {
      /* git command failed — non-blocking */
    }

    // Step 2: Check smoke test marker
    if (!fs.existsSync(SMOKE_MARKER)) {
      process.stderr.write(
        `${RED}[worktree-preflight] BLOCKED: No worktree smoke test this session.${RESET}\n` +
          `${YELLOW}Dispatch a no-op agent with isolation: "worktree" first to verify the system works.${RESET}\n` +
          `${YELLOW}After the test passes, create the marker: touch .claude/runtime/.worktree-smoke-passed${RESET}\n`,
      );
      process.exit(2);
    }

    // Step 3: Warn (not block) if run_in_background is missing
    const runInBg = event.tool_input?.run_in_background;
    if (!runInBg) {
      process.stderr.write(
        `${YELLOW}[worktree-preflight] WARNING: Builder dispatched without run_in_background: true. ` +
          `This blocks the Boss until the builder finishes.${RESET}\n`,
      );
      // Don't block — just warn
    }

    process.stderr.write(
      `${GREEN}[worktree-preflight] OK: infra checks passed for builder dispatch.${RESET}\n`,
    );
    process.exit(0);
  } catch {
    process.exit(0);
  }
});
