#!/usr/bin/env node
/**
 * delta-mark-built.js — mark a feature as 'built' in the oneshot store.
 *
 * Usage:
 *   node scripts/delta-mark-built.js <feature> <commit-sha> <typecheck-clean> [note]
 *
 * Sets:
 *   features[<feature>].status        = 'built'
 *   features[<feature>].builderCommit = <commit-sha>
 *   features[<feature>].typecheckClean = <bool>
 *   features[<feature>].builderNote   = <note?>
 *   features[<feature>].builtAt       = <iso-now>
 *
 * Builder-envelope guards (BUG-071 class — see paths.decisionPolicy):
 *   1. Phantom commit — commit_sha must resolve in the repo.
 *   2. Empty merge — commit must change at least one file.
 *   3. Branch theft — commit must be on agent/<feature>.
 *   4. Tech-introduction — if commit touches package.json, every new dep
 *      is logged as NEW_DEP_CANDIDATE (Class B; ADR required next phase).
 *
 * On guard failure: feature.status set to 'escalated', BUILDER_EMPTY_MERGE
 * runLog entry written, exit 2 (caller halts cycle with EMPTY_MERGE_BUG_071).
 * On tech-intro flag: NEW_DEP_CANDIDATE runLog entries written; mark-built
 * still proceeds (Class B is log-and-flag, not auto-reject).
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const STORE = path.join(
  ROOT,
  ".claude",
  "agents",
  "02-oneshot",
  ".system",
  "store.json",
);

const [, , feature, commit, typecheckArg, ...noteParts] = process.argv;
if (!feature || !commit) {
  console.error(
    "usage: delta-mark-built.js <feature> <commit-sha> <typecheck-clean> [note]",
  );
  process.exit(1);
}

const typecheckClean = String(typecheckArg).toLowerCase() === "true";
const note = noteParts.join(" ").trim() || undefined;

const s = JSON.parse(fs.readFileSync(STORE, "utf8"));
if (!s.features[feature]) {
  console.error(`feature '${feature}' not in store.features`);
  process.exit(1);
}

function git(cmd) {
  return execSync(cmd, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function envelopeGuard(commitSha, featureName) {
  const violations = [];

  // 1. Phantom commit — commit must exist as a reachable revision.
  // (Do NOT use `^{commit}` dereference suffix — fails in some shells.)
  try {
    git(`git cat-file -e ${commitSha}`);
  } catch {
    violations.push({
      type: "PHANTOM_COMMIT_SHA",
      detail: `commit ${commitSha} does not resolve in repo`,
    });
    return violations;
  }

  // 2. Empty merge — commit must change at least one file
  let filesChanged = 0;
  try {
    const stat = git(`git show --name-only --format= ${commitSha}`);
    filesChanged = stat.split("\n").filter((l) => l.trim()).length;
  } catch (e) {
    violations.push({
      type: "COMMIT_STAT_FAIL",
      detail: `git show failed: ${e.message}`,
    });
    return violations;
  }

  if (filesChanged === 0) {
    violations.push({
      type: "BUILDER_EMPTY_MERGE",
      detail: `commit ${commitSha} changed 0 files (BUG-071 class)`,
      remediation:
        "Do NOT auto-retry. Halt cycle. Manual recovery required; cite EMPTY_MERGE_BUG_071 in recovery commit.",
    });
  }

  // 3. Branch theft — commit must be on agent/<feature>
  try {
    const branches = git(`git branch --contains ${commitSha}`);
    if (
      !branches
        .split("\n")
        .some(
          (b) => b.replace(/^[*+]?\s*/, "").trim() === `agent/${featureName}`,
        )
    ) {
      violations.push({
        type: "BRANCH_THEFT",
        detail: `commit ${commitSha} not reachable from agent/${featureName}`,
      });
    }
  } catch {
    // non-fatal — branch contains lookup can fail in odd worktree states
  }

  return violations;
}

function techIntroGuard(commitSha) {
  const candidates = [];
  let touchesPkg = false;
  try {
    const filesInCommit = git(`git show --name-only --format= ${commitSha}`);
    touchesPkg = filesInCommit
      .split("\n")
      .map((l) => l.trim())
      .includes("package.json");
  } catch {
    return candidates;
  }

  if (!touchesPkg) return candidates;

  try {
    const before = git(`git show ${commitSha}^:package.json`);
    const after = git(`git show ${commitSha}:package.json`);
    const beforePkg = JSON.parse(before);
    const afterPkg = JSON.parse(after);
    const beforeDeps = {
      ...(beforePkg.dependencies || {}),
      ...(beforePkg.devDependencies || {}),
    };
    const afterDeps = {
      ...(afterPkg.dependencies || {}),
      ...(afterPkg.devDependencies || {}),
    };
    for (const dep of Object.keys(afterDeps)) {
      if (!(dep in beforeDeps)) {
        candidates.push({ name: dep, version: afterDeps[dep] });
      }
    }
  } catch {
    // parse failure or commit has no parent (initial commit) — skip silently
  }

  return candidates;
}

// Run guards
const violations = envelopeGuard(commit, feature);
const halting = violations.some(
  (v) =>
    v.type === "BUILDER_EMPTY_MERGE" ||
    v.type === "BRANCH_THEFT" ||
    v.type === "PHANTOM_COMMIT_SHA",
);

if (!s.runLog) s.runLog = { entries: [] };
if (!Array.isArray(s.runLog.entries)) s.runLog.entries = [];

if (violations.length > 0) {
  for (const v of violations) {
    s.runLog.entries.push({
      type: v.type,
      feature,
      phase: s.heartbeat?.phase ?? null,
      commit_sha: commit,
      severity: halting ? "CRITICAL" : "WARNING",
      issue: v.detail,
      remediation:
        v.remediation ||
        "Inspect builder dispatch; do not advance cycle until resolved.",
      policy_ref:
        "paths.decisionPolicy §Decision classes (Class C: halt + escalate)",
      timestamp: new Date().toISOString(),
    });
  }
}

if (halting) {
  s.features[feature].status = "escalated";
  fs.writeFileSync(STORE, JSON.stringify(s, null, 2) + "\n");
  console.error(
    `BLOCKED: ${feature} failed builder-envelope guard. Violations:\n${violations
      .map((v) => `  - ${v.type}: ${v.detail}`)
      .join("\n")}`,
  );
  console.error(
    "Feature marked 'escalated'. runLog updated. Halt cycle with reason EMPTY_MERGE_BUG_071.",
  );
  process.exit(2);
}

// Tech-introduction gate (non-halting; logged for ADR follow-up)
const newDeps = techIntroGuard(commit);
for (const dep of newDeps) {
  s.runLog.entries.push({
    type: "NEW_DEP_CANDIDATE",
    feature,
    phase: s.heartbeat?.phase ?? null,
    commit_sha: commit,
    dependency: dep.name,
    version: dep.version,
    policy_class: "B",
    policy_ref: "paths.decisionPolicy §Tech-Introduction Rule",
    requirement:
      "ADR required at paths.policy/adr/NNNN-slug.md before next phase. Apply 4-condition rule: (1) current stack cannot solve; (2) benefit > complexity; (3) ADR documented; (4) tests + rollback path.",
    timestamp: new Date().toISOString(),
  });
  console.warn(
    `NEW_DEP_CANDIDATE: ${dep.name}@${dep.version} added by ${feature}. ADR required before next phase (paths.decisionPolicy Class B).`,
  );
}

// Mark built
s.features[feature].status = "built";
s.features[feature].builderCommit = commit;
s.features[feature].typecheckClean = typecheckClean;
if (note) s.features[feature].builderNote = note;
s.features[feature].builtAt = new Date().toISOString();

fs.writeFileSync(STORE, JSON.stringify(s, null, 2) + "\n");
console.log(
  `marked ${feature}=built commit=${commit} typecheck=${typecheckClean}${note ? " (note attached)" : ""}${
    newDeps.length > 0 ? ` (${newDeps.length} NEW_DEP_CANDIDATE flagged)` : ""
  }`,
);
