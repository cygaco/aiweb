#!/usr/bin/env node
/**
 * delta-dispatch-builder.js — compose + launch a builder subprocess.
 *
 * Usage:
 *   node scripts/delta-dispatch-builder.js <feature-id>
 *
 * Reads:
 *   - .claude/agents/02-oneshot/.system/store.json  (feature.files, feature.status)
 *   - .claude/manifest.json                         (featureIdToDir for spec folder)
 *   - HYGIENE: highest-numbered retro folder
 *
 * The builder prompt is constructed inline below (template literal). The
 * builder agent's identity + system prompt come from
 * .claude/agents/02-oneshot/builder/builder.md when claude is invoked with
 * --agent builder; this script writes only the user-message portion.
 *
 * Writes:
 *   - .claude/runtime/dispatch/<feature>-prompt.txt      (the composed prompt)
 *   - .claude/runtime/dispatch/<feature>-launch.sh       (the command to run)
 *
 * Does NOT execute the launch script — the orchestrator invokes it via Bash
 * with run_in_background:true. This script just prepares artifacts.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STORE = path.join(
  ROOT,
  ".claude",
  "agents",
  "02-oneshot",
  ".system",
  "store.json",
);
const MANIFEST = path.join(ROOT, ".claude", "manifest.json");
const RETROS_DIR = path.join(
  ROOT,
  ".claude",
  "agents",
  "02-oneshot",
  ".system",
  "retros",
);
const DISPATCH_DIR = path.join(ROOT, ".claude", "runtime", "dispatch");

const feature = process.argv[2];
if (!feature) {
  console.error("usage: delta-dispatch-builder.js <feature-id>");
  process.exit(1);
}

fs.mkdirSync(DISPATCH_DIR, { recursive: true });

const store = JSON.parse(fs.readFileSync(STORE, "utf8"));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));

const featureEntry = store.features[feature];
if (!featureEntry) {
  console.error(`feature '${feature}' not in store.features`);
  process.exit(1);
}

const files = featureEntry.files || [];
if (files.length === 0) {
  console.error(`feature '${feature}' has no files in store.features[].files`);
  process.exit(1);
}

const featureDir = manifest.build.featureIdToDir?.[feature] || feature;

// Latest HYGIENE: highest-numbered retro; include "N-halted" variants
// (they carry forward rules added in an aborted run). Sort by numeric
// prefix, then prefer the "-halted" variant within a tied number since
// it supersedes (came later in time).
const retroDirs = fs
  .readdirSync(RETROS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^\d+(-halted)?$/.test(d.name))
  .map((d) => {
    const m = d.name.match(/^(\d+)(-halted)?$/);
    return { name: d.name, num: parseInt(m[1], 10), halted: !!m[2] };
  })
  .sort((a, b) => b.num - a.num || Number(b.halted) - Number(a.halted));

const latestRetro = retroDirs[0]?.name;
const hygienePath = path.join(RETROS_DIR, latestRetro, "HYGIENE.md");

const foundationFiles = (manifest.fileOwnership?.foundation || []).slice(0, 30);

// Top-5 BUG patterns from store.bugDataset — auto-inject to satisfy GAP-1101
// prompt-validator. Prefer feature-tagged bugs; fall back to most-recurrent.
const bugDataset = Array.isArray(store.bugDataset) ? store.bugDataset : [];
const featureBugs = bugDataset
  .filter((b) => b && (b.feature === feature || !b.feature))
  .slice(0, 5);
const fallbackBugs = bugDataset.slice(0, 5);
const top5Bugs = (featureBugs.length >= 3 ? featureBugs : fallbackBugs)
  .slice(0, 5)
  .map(
    (b) =>
      `- **${b.id}** — ${b.pattern}${b.feature ? ` (feature: ${b.feature})` : ""}`,
  )
  .join("\n");

// Read a runNumber for prompt framing if available; fall back to "current".
let runLabel = "current";
try {
  const runJson = JSON.parse(
    fs.readFileSync(path.join(ROOT, ".claude", "runtime", "run.json"), "utf8"),
  );
  if (runJson && typeof runJson.runNumber === "number") {
    runLabel = `${runJson.runNumber}`;
  }
} catch {
  /* no run.json — fine */
}

// NOTE: `feature: <name>` MUST be the first line to satisfy GAP-502 in
// scripts/hooks/prompt-validator.js. Any leading comment/heading above it
// makes the validator reject the dispatch.
const prompt = `feature: ${feature}
You are a Builder Agent in the Delta oneshot build system. Run ${runLabel} on current skeleton branch.

## MANDATORY FIRST ACTION (worktree isolation preamble)
Run \`pwd && git worktree list --porcelain | head\` BEFORE any git command.
Your cwd MUST be inside a \`.worktrees/wt-*\` path. If it resolves to the main project root, halt immediately and return:
\`\`\`json
{"status": "isolation-violation", "cwd": "<resolved-path>"}
\`\`\`
Do not commit, do not checkout, do not branch.

After isolation is verified, ensure you're on branch \`agent/${feature}\`:
\`git checkout -b agent/${feature} 2>/dev/null || git checkout agent/${feature}\`
Commit ONLY to this branch — not to the auto-generated \`agent/wt-*\` name.

## Top-5 Bug Patterns — Do NOT Repeat (GAP-1101)
${top5Bugs || "- (no bug dataset available)"}

## Your Role
You are stateless. Produce code, commit to branch \`agent/${feature}\`, return JSON envelope.

## File Scope (read-only elsewhere)
You may ONLY modify these files:
${files.map((f) => `- ${f}`).join("\n")}

All other files are read-only. If you need to change a foundation file, emit to stdout:
\`FOUNDATION-UPDATE-REQUEST: <file> — <reason>\`
then halt without modifying it. Foundation list (partial): ${foundationFiles
  .slice(0, 10)
  .join(", ")}…

## Specs to Read (in this order)
0. ${hygienePath.replace(ROOT + path.sep, "").replace(/\\/g, "/")} — cumulative HYGIENE rules, hard-fail on violation
1. AGENTS.md
2. requirements/05-features/${featureDir}/PRD.md
3. requirements/05-features/${featureDir}/STORIES.md
4. requirements/05-features/${featureDir}/COPY.md (if exists)
5. requirements/05-features/${featureDir}/INPUTS.md (if exists)
6. docs/04-architecture/FLOW_SPEC.md — find your feature's section
7. docs/04-architecture/DATA-CONTRACTS.md
8. docs/04-architecture/VALIDATION_RULES.md (if feature has user inputs)
9. docs/04-architecture/AUTH_SCHEMAS.md (if feature involves auth)
10. docs/04-architecture/PROMPT_TEMPLATES.md (if feature calls Claude API)
11. CLAUDE.md

## Build Verification (before commit)
Run \`node node_modules/typescript/bin/tsc --noEmit\` — NOT \`npx tsc\`, NOT \`npm run build\` (symlink issues).

## Commit Rules
- Commit to branch \`agent/${feature}\` (you should already be on it — verify via \`git branch --show-current\`)
- Conventional commit message: \`feat(${feature}): implement feature\`
- Do NOT push to origin

## Return Format
After completing (or hitting an issue), output ONE JSON envelope as your final message:
\`\`\`json
{
  "status": "built" | "isolation-violation" | "foundation-update-needed" | "spec-missing" | "build-failed",
  "feature": "${feature}",
  "branch": "agent/${feature}",
  "files_modified": ["<relative-paths>"],
  "commit_sha": "<sha>" | null,
  "typecheck_clean": true | false,
  "notes": "<brief — up to 500 chars>"
}
\`\`\`
`;

const promptFile = path.join(DISPATCH_DIR, `${feature}-prompt.txt`);
fs.writeFileSync(promptFile, prompt);

const launchFile = path.join(DISPATCH_DIR, `${feature}-launch.sh`);
const logFile = path.join(DISPATCH_DIR, `${feature}-output.json`);
const launchScript = `#!/bin/bash
# Auto-generated by delta-dispatch-builder.js for feature: ${feature}
set -e
cd "${ROOT.replace(/\\/g, "/")}"

# Worktree isolation per oneshot doctrine: every dispatch gets a fresh worktree.
# Reuse of a prior worktree is forbidden; remove + recreate on every dispatch.
WT_DIR=".worktrees/wt-${feature}"
if [ -d "$WT_DIR" ]; then
  git worktree remove --force "$WT_DIR" 2>/dev/null || rm -rf "$WT_DIR"
fi
git worktree prune 2>/dev/null || true

# Create worktree on agent/${feature} branch FROM CURRENT HEAD (skeleton-testN).
# -B force-resets the branch if it exists from a prior run — necessary because
# run-9 left agent/* branches around. Old commits remain reachable from
# skeleton-testN-1 history; only the branch label moves.
git worktree add -B "agent/${feature}" "$WT_DIR" HEAD

cd "$WT_DIR"
if [ -n "$(git status --porcelain)" ]; then
  echo "[${feature}] worktree pollution detected immediately after creation"
  git status --short
  exit 2
fi
set +e
claude -p --model claude-sonnet-4-6 --effort max --agent builder "$(cat "${promptFile.replace(
  /\\/g,
  "/",
)}")" > "${logFile.replace(/\\/g, "/")}" 2>&1
EXIT=$?
echo "[${feature}] exit=$EXIT (worktree=$WT_DIR)"
exit $EXIT
`;
fs.writeFileSync(launchFile, launchScript);
fs.chmodSync(launchFile, 0o755);

console.log(
  JSON.stringify(
    {
      feature,
      promptFile,
      launchFile,
      logFile,
      files: files.length,
      hygieneRef: hygienePath,
      featureDir,
    },
    null,
    2,
  ),
);
