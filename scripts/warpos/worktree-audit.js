#!/usr/bin/env node

/**
 * worktree-audit.js — categorize all worktrees for Phase 1 prereq A drain.
 *
 * For every worktree, classify as:
 *   - clean-mergeable        : working tree clean AND branch reachable from master
 *   - clean-orphan           : working tree clean BUT branch not in master
 *   - dirty-runtime-only     : only .claude/ runtime/state files modified (safe to drop)
 *   - dirty-product          : product files modified or untracked product work present (FREEZE, do not remove)
 *   - missing-dir            : registered but directory gone
 *   - main                   : the primary worktree (skip)
 *
 * Writes a report to .claude/runtime/notes/worktree-audit-2026-04-30.md
 *
 * Run mode: --plan (default, only report) | --apply (delete safe ones)
 *
 * Apply rules:
 *   - missing-dir          → git worktree prune
 *   - clean-mergeable      → remove worktree (branch is in master, no archive needed)
 *   - clean-orphan         → tag branch at archive/worktree/<name>-<sha>, remove worktree
 *   - dirty-runtime-only   → tag branch at archive/worktree/<name>-<sha>, --force remove (throws away runtime churn)
 *   - dirty-product        → tag branch at archive/worktree/<name>-<sha>, KEEP worktree (frozen)
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const MODE = process.argv.includes("--apply") ? "apply" : "plan";
const ROOT = path.resolve(__dirname, "..", "..");

function sh(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      ...opts,
    }).trim();
  } catch (e) {
    return { error: e.stderr ? e.stderr.toString() : e.message };
  }
}

function parsePorcelain(out) {
  // git worktree list --porcelain emits blocks separated by blank lines.
  // Each block: worktree <path>\nHEAD <sha>\n[branch <ref>|detached]\n[bare|locked|prunable]
  const blocks = out
    .split(/\n\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return blocks.map((blk) => {
    const lines = blk.split("\n");
    const wt = {};
    for (const line of lines) {
      const m = line.match(/^(\S+)\s*(.*)$/);
      if (!m) continue;
      const [, key, val] = m;
      wt[key] = val || true;
    }
    return wt;
  });
}

const porcelainOut = sh("git worktree list --porcelain");
const worktrees = parsePorcelain(porcelainOut);

// Get master commit for "reachable from master" test
const masterSha = sh("git rev-parse master");

const report = {
  generated: new Date().toISOString(),
  total: worktrees.length,
  mode: MODE,
  buckets: {
    main: [],
    "missing-dir": [],
    "dirty-product": [],
    "dirty-runtime-only": [],
    "clean-mergeable": [],
    "clean-orphan": [],
  },
};

// Lines that mean "runtime / state churn" — not product work.
// If EVERY status line matches one of these patterns, the worktree is safe to drop.
const RUNTIME_STATE_PATTERNS = [
  /^\s*[MDA?!]+\s+\.claude\//, // any .claude/* edit (runtime, events, memory, dispatch, store)
];

function classifyDirty(statusOut) {
  // Returns "runtime-only" or "product"
  const lines = statusOut.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    const matchedRuntime = RUNTIME_STATE_PATTERNS.some((re) => re.test(line));
    if (!matchedRuntime) {
      return "product";
    }
  }
  return "runtime-only";
}

for (const wt of worktrees) {
  const wtPath = wt.worktree;
  const branch = wt.branch ? wt.branch.replace(/^refs\/heads\//, "") : null;
  const head = wt.HEAD;

  // Detect "main" worktree — heuristic: same as ROOT
  if (path.resolve(wtPath) === path.resolve(ROOT)) {
    report.buckets.main.push({ path: wtPath, branch, head });
    continue;
  }

  // Missing dir
  if (!fs.existsSync(wtPath)) {
    report.buckets["missing-dir"].push({ path: wtPath, branch, head });
    continue;
  }

  // Status (uncommitted?)
  const statusOut = sh(`git -C "${wtPath}" status --porcelain`);
  const isDirty = typeof statusOut === "string" && statusOut.length > 0;

  if (isDirty) {
    const dirtyLines = statusOut.split("\n").filter((l) => l.trim()).length;
    const dirtyClass = classifyDirty(statusOut);
    const bucket =
      dirtyClass === "runtime-only" ? "dirty-runtime-only" : "dirty-product";
    report.buckets[bucket].push({
      path: wtPath,
      branch,
      head,
      dirtyLines,
      sample: statusOut.split("\n").slice(0, 5),
    });
    continue;
  }

  // Clean — is the head reachable from master?
  const mergeBase = sh(`git merge-base ${head} ${masterSha}`);
  const reachable = mergeBase === head;

  if (reachable) {
    report.buckets["clean-mergeable"].push({ path: wtPath, branch, head });
  } else {
    report.buckets["clean-orphan"].push({ path: wtPath, branch, head });
  }
}

// Format report
const lines = [];
lines.push(`# Worktree audit — ${report.generated}`);
lines.push("");
lines.push(`Total worktrees: ${report.total}`);
lines.push(`Mode: ${report.mode}`);
lines.push("");
for (const [bucket, items] of Object.entries(report.buckets)) {
  lines.push(`## ${bucket} (${items.length})`);
  lines.push("");
  if (items.length === 0) {
    lines.push("_(none)_");
  } else {
    for (const it of items) {
      lines.push(
        `- \`${it.path}\` — branch: \`${it.branch || "(detached)"}\`, head: \`${it.head?.slice(0, 8) || "?"}\`${it.dirtyLines ? `, dirtyLines: ${it.dirtyLines}` : ""}`,
      );
    }
  }
  lines.push("");
}

const notesDir = path.join(ROOT, ".claude", "runtime", "notes");
fs.mkdirSync(notesDir, { recursive: true });
const reportFile = path.join(notesDir, "worktree-audit-2026-04-30.md");
fs.writeFileSync(reportFile, lines.join("\n"));

// Console summary
console.log(`\nWorktree audit (mode: ${report.mode})`);
console.log(`  Total: ${report.total}`);
for (const [bucket, items] of Object.entries(report.buckets)) {
  console.log(`  ${bucket}: ${items.length}`);
}
console.log(`\nReport: ${path.relative(ROOT, reportFile)}`);

function tagAndMaybeRemove(wt, { remove }) {
  let tagged = false;
  let removed = false;
  let error = null;
  if (wt.branch) {
    const tagName = `archive/worktree/${wt.branch.replace(/[^a-zA-Z0-9_-]/g, "-")}-${wt.head.slice(0, 8)}`;
    const tagResult = sh(`git tag -f "${tagName}" ${wt.head}`);
    if (typeof tagResult !== "object") tagged = true;
  }
  if (remove) {
    const r = sh(`git worktree remove --force "${wt.path}"`);
    if (typeof r === "object" && r.error) {
      error = r.error;
    } else {
      removed = true;
    }
  }
  return { tagged, removed, error };
}

if (MODE === "apply") {
  let removed = 0;
  let tagged = 0;
  let frozen = 0;
  let failed = 0;

  if (report.buckets["missing-dir"].length > 0) {
    sh("git worktree prune");
    console.log(`\nPruned missing-dir worktrees`);
  }

  console.log(
    `\nRemoving ${report.buckets["clean-mergeable"].length} clean-mergeable worktrees...`,
  );
  for (const wt of report.buckets["clean-mergeable"]) {
    const r = tagAndMaybeRemove(wt, { remove: true });
    if (r.error) {
      failed++;
      console.log(`  FAIL: ${wt.path} — ${r.error.slice(0, 80)}`);
    } else if (r.removed) {
      removed++;
    }
  }

  console.log(
    `\nTagging + removing ${report.buckets["clean-orphan"].length} clean-orphan worktrees...`,
  );
  for (const wt of report.buckets["clean-orphan"]) {
    const r = tagAndMaybeRemove(wt, { remove: true });
    if (r.tagged) tagged++;
    if (r.error) {
      failed++;
      console.log(`  FAIL: ${wt.path} — ${r.error.slice(0, 80)}`);
    } else if (r.removed) {
      removed++;
    }
  }

  console.log(
    `\nTagging + force-removing ${report.buckets["dirty-runtime-only"].length} dirty-runtime-only worktrees (runtime churn dropped)...`,
  );
  for (const wt of report.buckets["dirty-runtime-only"]) {
    const r = tagAndMaybeRemove(wt, { remove: true });
    if (r.tagged) tagged++;
    if (r.error) {
      failed++;
      console.log(`  FAIL: ${wt.path} — ${r.error.slice(0, 80)}`);
    } else if (r.removed) {
      removed++;
    }
  }

  console.log(
    `\nFreezing ${report.buckets["dirty-product"].length} dirty-product worktrees (tag only, NOT removed)...`,
  );
  for (const wt of report.buckets["dirty-product"]) {
    const r = tagAndMaybeRemove(wt, { remove: false });
    if (r.tagged) tagged++;
    frozen++;
  }

  console.log(`\nApply complete:`);
  console.log(`  Removed: ${removed}`);
  console.log(`  Tagged:  ${tagged}`);
  console.log(`  Frozen:  ${frozen} (dirty-product, kept on disk)`);
  console.log(`  Failed:  ${failed}`);
  console.log(`Review: ${path.relative(ROOT, reportFile)}`);
}
