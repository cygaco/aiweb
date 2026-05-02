#!/usr/bin/env node
/**
 * delta-dispatch-fixer.js — compose + launch a fixer subprocess.
 *
 * Mirror of delta-dispatch-builder.js but for the fixer role:
 *   - Worktree branched from agent/<feature> (the built code), not skeleton-test10 HEAD
 *   - On branch agent/<feature>-fix-<attempt> (fresh per attempt — protocol forbids reuse)
 *   - Reads a fix brief from .claude/runtime/dispatch/<feature>-fix-brief.md
 *   - Outputs JSON envelope to .claude/runtime/dispatch/<feature>-fix-output.json
 *
 * Usage:
 *   node scripts/delta-dispatch-fixer.js <feature> [<attempt>]
 *
 * The launch script expects the fix brief to already be at:
 *   .claude/runtime/dispatch/<feature>-fix-brief.md
 *
 * The orchestrator (Delta) writes the brief, then runs this script to
 * generate the launch script, then bash-launches it (run_in_background:true).
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
const attempt = parseInt(process.argv[3] || "1", 10);
// Optional base branch (default: agent/<feature> for attempt 1, agent/<feature>-fix-<attempt-1> for retries).
// Pass explicitly to override (e.g., when fix-1 was orchestrator-committed and you want fix-2 to start from it).
const baseBranchArg = process.argv[4];
if (!feature) {
  console.error(
    "usage: delta-dispatch-fixer.js <feature> [<attempt>] [<base-branch>]",
  );
  process.exit(1);
}
if (attempt < 1 || attempt > 3) {
  console.error("attempt must be 1, 2, or 3");
  process.exit(1);
}
const baseBranch =
  baseBranchArg ||
  (attempt === 1 ? `agent/${feature}` : `agent/${feature}-fix-${attempt - 1}`);

fs.mkdirSync(DISPATCH_DIR, { recursive: true });

// Prefer attempt-specific brief (<feature>-fix-<n>-brief.md), fall back to generic.
const attemptBrief = path.join(
  DISPATCH_DIR,
  `${feature}-fix-${attempt}-brief.md`,
);
const genericBrief = path.join(DISPATCH_DIR, `${feature}-fix-brief.md`);
const briefFile = fs.existsSync(attemptBrief) ? attemptBrief : genericBrief;
if (!fs.existsSync(briefFile)) {
  console.error(`fix brief not found at ${attemptBrief} or ${genericBrief}`);
  console.error(
    "orchestrator must write the brief before dispatching the fixer.",
  );
  process.exit(1);
}

const store = JSON.parse(fs.readFileSync(STORE, "utf8"));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const featureEntry = store.features[feature];
if (!featureEntry) {
  console.error(`feature '${feature}' not in store.features`);
  process.exit(1);
}

const files = featureEntry.files || [];
const featureDir = manifest.build.featureIdToDir?.[feature] || feature;

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

const briefBody = fs.readFileSync(briefFile, "utf8");

const fixBranch = `agent/${feature}-fix-${attempt}`;
const wtDir = `.worktrees/wt-${feature}-fix-${attempt}`;

// Prompt-validator hook requires `feature: <name>` first line.
// gauntlet-gate hook requires "fixer" in first 500 chars to skip dep gate.
const prompt = `feature: ${feature}
You are the fixer agent for **${feature}** in run 10. Attempt ${attempt} of 3.

## MANDATORY FIRST ACTION
Run \`pwd && git worktree list --porcelain | head\` BEFORE any git command.
Your cwd MUST be inside a \`.worktrees/wt-${feature}-fix-${attempt}\` path. If it resolves
to the main project root, halt and return:
\`\`\`json
{"status": "isolation-violation", "cwd": "<resolved-path>"}
\`\`\`

You are on branch \`${fixBranch}\`, branched from \`agent/${feature}\` (the built code).

## Your role
Apply the fixes specified in the Fix Brief below. Do NOT add features. Do NOT
refactor surrounding code. Fix only what is specified.

## File scope (you may ONLY modify these)
${files.map((f) => `- ${f}`).join("\n")}

If a fix requires changes to files outside this scope, emit:
\`FOUNDATION-UPDATE-REQUEST: <file> — <reason>\`
and skip that fix.

## Fix Brief
${briefBody}

## Hygiene rules (cumulative)
Read ${hygienePath.replace(ROOT + path.sep, "").replace(/\\/g, "/")} for cumulative hygiene rules.
Notable: HYGIENE Rule 27 (validateOrigin returns boolean — check via \`if (!validateOrigin(req))\`,
NEVER try/catch).

## Build verification (before commit)
Run \`node node_modules/typescript/bin/tsc --noEmit\` — NOT \`npx tsc\`, NOT \`npm run build\`
(symlink issues with worktrees).

## Commit rules
- Commit to branch \`${fixBranch}\` (already current branch)
- Conventional commit message: \`fix(${feature}): apply fix-attempt-${attempt} per gauntlet brief\`
- Do NOT push to origin

## Return format
Final message MUST be ONE \`\`\`json fence:
\`\`\`json
{
  "status": "fixed" | "partial" | "stuck" | "isolation-violation",
  "feature": "${feature}",
  "branch": "${fixBranch}",
  "attempt": ${attempt},
  "fixes_applied": ["short description per item from the brief"],
  "fixes_skipped": [{"item": "...", "reason": "out-of-scope | unable | foundation-needed"}],
  "files_modified": ["..."],
  "commit_sha": "<sha>" | null,
  "typecheck_clean": true | false,
  "notes": "<= 500 chars summary"
}
\`\`\`
`;

const promptFile = path.join(
  DISPATCH_DIR,
  `${feature}-fix-${attempt}-prompt.txt`,
);
fs.writeFileSync(promptFile, prompt);

const launchFile = path.join(
  DISPATCH_DIR,
  `${feature}-fix-${attempt}-launch.sh`,
);
const logFile = path.join(
  DISPATCH_DIR,
  `${feature}-fix-${attempt}-output.json`,
);

const launchScript = `#!/bin/bash
# Auto-generated by delta-dispatch-fixer.js for feature: ${feature} (fix attempt ${attempt})
set -e
cd "${ROOT.replace(/\\/g, "/")}"

# Worktree isolation per oneshot doctrine: every fix attempt gets a fresh worktree.
WT_DIR="${wtDir}"
if [ -d "$WT_DIR" ]; then
  git worktree remove --force "$WT_DIR" 2>/dev/null || rm -rf "$WT_DIR"
fi
git worktree prune 2>/dev/null || true

# Branch from ${baseBranch} (= agent/<feature> for attempt 1, prior fix branch otherwise).
# -B force-resets if branch exists from prior attempt.
git worktree add -B "${fixBranch}" "$WT_DIR" "${baseBranch}"

cd "$WT_DIR"
set +e
claude -p --model claude-sonnet-4-6 --effort max --agent fixer "$(cat "${promptFile.replace(/\\/g, "/")}")" > "${logFile.replace(/\\/g, "/")}" 2>&1
EXIT=$?
echo "[${feature} fix-${attempt}] exit=$EXIT (worktree=$WT_DIR)"
exit $EXIT
`;
fs.writeFileSync(launchFile, launchScript);
fs.chmodSync(launchFile, 0o755);

console.log(
  JSON.stringify(
    {
      feature,
      attempt,
      promptFile,
      launchFile,
      logFile,
      briefFile,
      branch: fixBranch,
      worktree: wtDir,
      filesInScope: files.length,
    },
    null,
    2,
  ),
);
