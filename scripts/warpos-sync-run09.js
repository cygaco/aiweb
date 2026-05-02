#!/usr/bin/env node
/**
 * warpos-sync-run09.js — One-off propagation of run-09 infra fixes to WarpOS.
 *
 * Mirrors commits 842a632 + 1ae6aaf from jobhunter into the WarpOS canonical
 * repo. Per Alex β cross-repo parity decision (2026-04-18).
 *
 * Tier A (copy verbatim): 25 agent spec files, skills, hooks, and utility scripts.
 * Tier B (genericize): 1 file flagged in the propagation note — skipped here.
 * Deletions: task-manifest.md + file-ownership.md + their framework-manifest entries.
 *
 * This script does NOT commit. Run it, review `git status` in WarpOS, then
 * commit + push manually.
 */
const fs = require("fs");
const path = require("path");

const JOBHUNTER = path.resolve(__dirname, "..");
const WARPOS = path.resolve(JOBHUNTER, "..", "WarpOS");

if (!fs.existsSync(WARPOS)) {
  console.error(`WarpOS not found at ${WARPOS}`);
  process.exit(1);
}

// --- Tier A: copy verbatim -------------------------------------------------
const TIER_A = [
  // Agent specs
  ".claude/agents/00-alex/delta.md",
  ".claude/agents/00-alex/gamma.md",
  ".claude/agents/01-adhoc/.system/protocol.md",
  ".claude/agents/02-oneshot/.system/protocol.md",
  ".claude/agents/02-oneshot/builder/builder.md",
  ".claude/agents/02-oneshot/compliance/compliance.md",
  ".claude/agents/02-oneshot/reviewer/reviewer.md",
  ".claude/agents/02-oneshot/learner/learner.md",
  ".claude/agents/02-oneshot/qa/analyze.md",
  ".claude/agents/02-oneshot/qa/orchestrator.md",
  ".claude/agents/02-oneshot/qa/scan.md",
  ".claude/agents/02-oneshot/stub-scaffold/stub-scaffold.md",
  // Skills
  ".claude/commands/mode/solo.md",
  ".claude/commands/mode/adhoc.md",
  ".claude/commands/mode/oneshot.md",
  ".claude/commands/preflight/run.md",
  ".claude/commands/preflight/setup.md",
  ".claude/commands/session/takenotes.md",
  // Hooks
  "scripts/hooks/prompt-validator.js",
  "scripts/hooks/smart-context.js",
  "scripts/hooks/merge-guard.js",
  // Utility scripts
  "scripts/oneshot-store-reset.js",
  "scripts/oneshot-heartbeat.js",
  "scripts/oneshot-phase-complete.js",
  "scripts/oneshot-halt.js",
];

let copied = 0;
let skipped = 0;
let created = 0;
for (const rel of TIER_A) {
  const src = path.join(JOBHUNTER, rel);
  const dest = path.join(WARPOS, rel);
  if (!fs.existsSync(src)) {
    console.log(`[skip] source missing: ${rel}`);
    skipped++;
    continue;
  }
  const destDir = path.dirname(dest);
  fs.mkdirSync(destDir, { recursive: true });
  const existed = fs.existsSync(dest);
  fs.copyFileSync(src, dest);
  if (existed) {
    console.log(`[copy] ${rel}`);
    copied++;
  } else {
    console.log(`[new ] ${rel}`);
    created++;
  }
}

// --- Deletions -------------------------------------------------------------
const DELETIONS = [
  ".claude/agents/02-oneshot/.system/task-manifest.md",
  ".claude/agents/02-oneshot/.system/file-ownership.md",
];

let deleted = 0;
for (const rel of DELETIONS) {
  const target = path.join(WARPOS, rel);
  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
    console.log(`[del ] ${rel}`);
    deleted++;
  }
}

// --- framework-manifest entry removal --------------------------------------
// Remove the two entries for the deleted templates. Preserves hand-formatting
// by doing a line-surgical removal, not a full JSON reserialize.
const frameworkManifestPath = path.join(
  WARPOS,
  ".claude",
  "framework-manifest.json",
);
let manifestTouched = false;
if (fs.existsSync(frameworkManifestPath)) {
  let text = fs.readFileSync(frameworkManifestPath, "utf8");
  const entries = [
    {
      name: "file-ownership.md",
      match:
        /\s*\{\s*"src":\s*"\.claude\/agents\/02-oneshot\/\.system\/file-ownership\.md",\s*"dest":\s*"\.claude\/agents\/02-oneshot\/\.system\/file-ownership\.md",\s*"kind":\s*"agent"\s*\},?/,
    },
    {
      name: "task-manifest.md",
      match:
        /\s*\{\s*"src":\s*"\.claude\/agents\/02-oneshot\/\.system\/task-manifest\.md",\s*"dest":\s*"\.claude\/agents\/02-oneshot\/\.system\/task-manifest\.md",\s*"kind":\s*"agent"\s*\},?/,
    },
  ];
  for (const e of entries) {
    if (e.match.test(text)) {
      text = text.replace(e.match, "");
      console.log(`[manifest] removed entry: ${e.name}`);
      manifestTouched = true;
    }
  }
  if (manifestTouched) {
    // Collapse any trailing-comma artifact before a closing bracket.
    text = text.replace(/,(\s*[\]\}])/g, "$1");
    fs.writeFileSync(frameworkManifestPath, text);
  } else {
    console.log("[manifest] no entries found to remove");
  }
}

console.log(
  `\nDone. copied=${copied} new=${created} deleted=${deleted} skipped=${skipped} manifestTouched=${manifestTouched}`,
);
console.log("Next: cd to WarpOS, review `git status`, commit + push manually.");
