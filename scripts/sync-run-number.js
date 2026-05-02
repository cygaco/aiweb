#!/usr/bin/env node
/**
 * sync-run-number.js — canonical run-number resolver
 *
 * Reads the current git branch. If it matches skeleton-test<N>, writes:
 *   .claude/runtime/run.json  { runNumber, skeletonBranch, setAt, setBy }
 *   .claude/settings.json     env.CLAUDE_RUN_NUMBER (string)
 *
 * Prints "CLAUDE_RUN_NUMBER=<N>" on stdout for shell eval.
 *
 * Invoked:
 *   - SessionStart hook (auto-sync on every Claude Code launch)
 *   - /oneshot:preflight Step 2.3.5 (after new skeleton branch is created)
 *   - Manually via `node scripts/sync-run-number.js --manual` if needed
 *
 * Non-skeleton branches (master, feature/*, etc.) preserve the last known
 * runNumber in run.json — we only bump on skeleton-test<N> match.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const RUN_FILE = path.join(PROJECT_ROOT, ".claude", "runtime", "run.json");
const SETTINGS_FILE = path.join(PROJECT_ROOT, ".claude", "settings.json");

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

function currentBranch() {
  try {
    return execSync("git branch --show-current", {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

function main() {
  const branch = currentBranch();
  const existing = readJson(RUN_FILE, {
    runNumber: null,
    skeletonBranch: null,
  });

  let next = { ...existing };

  const match = branch && branch.match(/^skeleton-test(\d+)$/);
  if (match) {
    const n = parseInt(match[1], 10);
    if (existing.runNumber !== n || existing.skeletonBranch !== branch) {
      next = {
        runNumber: n,
        skeletonBranch: branch,
        setAt: new Date().toISOString(),
        setBy: process.argv.includes("--manual")
          ? "skill:run-sync"
          : "hook:session-start",
      };
      writeJson(RUN_FILE, next);
    }
  } else if (!existing.runNumber) {
    // Non-skeleton branch AND no prior run.json — initialize as null
    next = {
      runNumber: null,
      skeletonBranch: null,
      setAt: new Date().toISOString(),
      setBy: "hook:session-start",
      note: "Not on a skeleton-test<N> branch; run number not set.",
    };
    writeJson(RUN_FILE, next);
  }

  // Mirror to settings.json env.CLAUDE_RUN_NUMBER
  if (next.runNumber != null) {
    const settings = readJson(SETTINGS_FILE, {});
    settings.env = settings.env || {};
    const current = settings.env.CLAUDE_RUN_NUMBER;
    const desired = String(next.runNumber);
    if (current !== desired) {
      settings.env.CLAUDE_RUN_NUMBER = desired;
      writeJson(SETTINGS_FILE, settings);
    }
    process.stdout.write(`CLAUDE_RUN_NUMBER=${desired}\n`);
  } else {
    process.stdout.write(`CLAUDE_RUN_NUMBER=\n`);
  }
}

main();
