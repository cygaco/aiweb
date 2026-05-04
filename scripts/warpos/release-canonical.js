#!/usr/bin/env node
/**
 * release-canonical.js — drive a full WarpOS release of the canonical clone
 * from the product repo, without ever switching the caller's cwd into the
 * canonical repo. All canonical-side ops happen via spawnSync({cwd: canonical})
 * or `git -C <canonical> ...`.
 *
 * Why it exists: the prior release flow required the operator to cd into the
 * WarpOS clone for bump/regen/build/gates/merge. RT-017 (2026-05-01) flagged
 * this as a real workflow gap. This script is the closer.
 *
 * Stages (default = dry-run; --apply executes):
 *   0  Locate canonical clone
 *   1  Promote framework changes (product → canonical)        [--no-promote skips]
 *   2  Compute new version (patch | minor | <explicit>)
 *   3  Bump <canonical>/version.json
 *   4  Regen <canonical>/.claude/framework-manifest.json
 *   5  Create <canonical>/framework/releases/<v>/ skeleton
 *   6  Build capsule (release-build.js)
 *   7  Run release gates
 *   8  Commit on release/<v> branch in canonical
 *   9  Fast-forward main + push origin main
 *  10  Tag warpos@<v> + push                                  [--no-tag skips]
 *
 * Each stage emits a receipt {stage, ok, what, where, rollback}. On failure
 * the report tells you which stages did/didn't run + how to resume.
 *
 * Usage:
 *   node scripts/warpos/release-canonical.js --canonical ../WarpOS --version patch
 *   node scripts/warpos/release-canonical.js --version patch --apply
 *   node scripts/warpos/release-canonical.js --canonical ../WarpOS --version 0.2.0 --apply --no-tag
 *   node scripts/warpos/release-canonical.js --resume-from 7 --apply
 *
 * Slash entry point: /warp:release (see .claude/commands/warp/release.md).
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const PRODUCT_ROOT = path.resolve(__dirname, "..", "..");

// ── arg parse ─────────────────────────────────────────────

function parseArgs(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    if (i === -1) return null;
    return argv[i + 1];
  };
  return {
    canonical: get("--canonical"),
    version: get("--version") || "patch",
    apply: argv.includes("--apply"),
    noPromote: argv.includes("--no-promote"),
    noTag: argv.includes("--no-tag"),
    resumeFrom: get("--resume-from") ? parseInt(get("--resume-from"), 10) : 0,
    json: argv.includes("--json"),
  };
}

// ── helpers ───────────────────────────────────────────────

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
}

function isCanonicalLayout(p) {
  if (!p) return false;
  return (
    fs.existsSync(path.join(p, "version.json")) &&
    fs.existsSync(path.join(p, ".claude")) &&
    fs.existsSync(path.join(p, "framework"))
  );
}

function locateCanonical(opt) {
  // Order: explicit flag → sibling ../WarpOS → manifest hint → walk up.
  const tries = [];
  if (opt) tries.push(path.resolve(opt));
  tries.push(path.resolve(PRODUCT_ROOT, "..", "WarpOS"));
  tries.push(path.resolve(PRODUCT_ROOT, "..", "warpos"));
  try {
    const manifest = readJson(
      path.join(PRODUCT_ROOT, ".claude", "manifest.json"),
    );
    const src = manifest?.warpos?.source;
    if (src && !/^https?:\/\//.test(src)) tries.push(path.resolve(src));
  } catch {
    /* no manifest is fine */
  }
  for (const candidate of tries) {
    if (isCanonicalLayout(candidate)) return candidate;
  }
  return null;
}

function bumpVersion(current, mode) {
  if (/^\d+\.\d+\.\d+$/.test(mode)) return mode;
  const m = current.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`current version not semver: ${current}`);
  const [, maj, min, pat] = m.map(Number);
  if (mode === "patch") return `${maj}.${min}.${pat + 1}`;
  if (mode === "minor") return `${maj}.${min + 1}.0`;
  if (mode === "major") return `${maj + 1}.0.0`;
  throw new Error(`unknown --version mode: ${mode}`);
}

function runIn(cwd, cmd, args, env) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...(env || {}) },
    timeout: 300_000,
  });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}

function nodeIn(cwd, scriptRel, args) {
  return runIn(cwd, process.execPath, [scriptRel, ...(args || [])]);
}

function gitC(cwd, args) {
  return runIn(cwd, "git", ["-C", cwd, ...args]);
}

// ── stages ────────────────────────────────────────────────

const STAGE_NAMES = [
  "locate-canonical",
  "promote",
  "compute-version",
  "bump-version",
  "regen-manifest",
  "create-capsule-skeleton",
  "build-capsule",
  "run-gates",
  "commit-release-branch",
  "merge-to-main-and-push",
  "tag-and-push",
];

function receipt(stage, ok, what, where, rollback, extra) {
  return {
    stage,
    name: STAGE_NAMES[stage],
    ok,
    what,
    where,
    rollback,
    ...(extra || {}),
  };
}

// ── stage 0: locate ───────────────────────────────────────
function stageLocate(opts) {
  const canonical = locateCanonical(opts.canonical);
  if (!canonical) {
    return receipt(
      0,
      false,
      "Could not locate the canonical WarpOS clone",
      null,
      "Pass --canonical <absolute-or-relative-path> or place a clone at ../WarpOS",
    );
  }
  return receipt(
    0,
    true,
    `Found canonical clone`,
    canonical,
    "n/a — read-only check",
    { canonical },
  );
}

// ── stage 1: promote ──────────────────────────────────────
function stagePromote(opts, canonical) {
  if (opts.noPromote) {
    return receipt(
      1,
      true,
      "Promote skipped (--no-promote)",
      canonical,
      "n/a",
      { skipped: true },
    );
  }
  const args = ["scripts/warpos/promote.js", "--to", canonical];
  if (opts.apply) args.push("--apply");
  else args.push("--dry-run");
  args.push("--json");
  const r = nodeIn(PRODUCT_ROOT, args[0], args.slice(1));
  let parsed = null;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    /* non-json output */
  }
  if (!r.ok) {
    return receipt(
      1,
      false,
      "Promote failed (engine error)",
      canonical,
      "Inspect promote.js stderr; fix root cause; re-run with --resume-from 1",
      { stderr: r.stderr.slice(0, 500), parsed },
    );
  }
  if (
    parsed &&
    parsed.report &&
    parsed.report.classCounts &&
    parsed.report.classCounts.C > 0
  ) {
    return receipt(
      1,
      false,
      `Promote refused: ${parsed.report.classCounts.C} Class C item(s) need human resolution`,
      canonical,
      "Resolve TEMPLATE_REVIEW or SECRET_BLOCK items in source, then --resume-from 1",
      { promote: parsed },
    );
  }
  const counts =
    (parsed && parsed.apply && parsed.apply.counts) ||
    (parsed && parsed.report && parsed.report.counts) ||
    {};
  return receipt(
    1,
    true,
    opts.apply
      ? `Promote applied: ${counts.copied || 0} added, ${counts.updated || 0} updated, ${counts.migrations_copied || 0} migrations`
      : `Promote dry-run plan ready (${parsed && parsed.total != null ? parsed.total : 0} decisions)`,
    canonical,
    "Last promote-applied state can be inspected at <canonical>/.warpos-sync.json",
    { promote: parsed },
  );
}

// ── stage 2: compute version ──────────────────────────────
function stageComputeVersion(opts, canonical) {
  let current;
  try {
    current = readJson(path.join(canonical, "version.json")).version;
  } catch (e) {
    return receipt(
      2,
      false,
      `Cannot read canonical version.json: ${e.message}`,
      canonical,
      "Verify <canonical>/version.json exists",
    );
  }
  let next;
  try {
    next = bumpVersion(current, opts.version);
  } catch (e) {
    return receipt(
      2,
      false,
      e.message,
      canonical,
      "Pass --version patch|minor|major|<x.y.z>",
    );
  }
  if (next === current) {
    return receipt(
      2,
      false,
      `Computed version ${next} equals current — nothing to release`,
      canonical,
      "Pass a higher --version, or skip this script if no release intended",
    );
  }
  return receipt(
    2,
    true,
    `Bumping ${current} → ${next}`,
    canonical,
    "n/a — read-only computation",
    { current, next },
  );
}

// ── stage 3: bump version.json ────────────────────────────
function stageBumpVersion(opts, canonical, current, next) {
  const file = path.join(canonical, "version.json");
  const before = readJson(file);
  const after = {
    ...before,
    version: next,
    releasedAt: new Date().toISOString().slice(0, 10),
    previousVersions: Array.from(
      new Set([...(before.previousVersions || []), current]),
    ),
    notes: `Patch / minor / major bump from ${current} (auto-generated by release-canonical.js — fill in the changelog before publishing).`,
  };
  if (!opts.apply) {
    return receipt(
      3,
      true,
      `[dry-run] Would write version.json with version=${next}`,
      file,
      "n/a — dry-run",
      { before, after },
    );
  }
  writeJson(file, after);
  return receipt(
    3,
    true,
    `Wrote version.json (${current} → ${next})`,
    file,
    `Restore prior content: write {"version":"${current}",...} back, or git -C ${canonical} checkout HEAD -- version.json`,
  );
}

// ── stage 4: regen manifest ───────────────────────────────
function stageRegenManifest(opts, canonical) {
  if (!opts.apply) {
    return receipt(
      4,
      true,
      "[dry-run] Would regen .claude/framework-manifest.json in canonical",
      canonical,
      "n/a — dry-run",
    );
  }
  const r = nodeIn(canonical, "scripts/generate-framework-manifest.js", []);
  if (!r.ok) {
    return receipt(
      4,
      false,
      `generate-framework-manifest.js failed (exit ${r.status})`,
      canonical,
      "Inspect stderr in canonical; fix and --resume-from 4",
      { stderr: r.stderr.slice(0, 500) },
    );
  }
  return receipt(
    4,
    true,
    "Regenerated .claude/framework-manifest.json",
    path.join(canonical, ".claude", "framework-manifest.json"),
    `git -C ${canonical} checkout HEAD -- .claude/framework-manifest.json`,
  );
}

// ── stage 5: capsule skeleton ─────────────────────────────
function buildSkeletonReleaseJson(canonical, version) {
  const v = readJson(path.join(canonical, "version.json"));
  return {
    schema: "warpos/release/v1",
    version,
    createdAt: new Date().toISOString(),
    commit: null,
    minUpgradeableFrom: v.minUpgradeableFrom || null,
    requiresFreshInstallFromBelow: null,
    manifestSchema: v.frameworkManifestSchema || "warpos/framework-manifest/v2",
    pathRegistryVersion: (v.pathRegistrySchema || "").split("/").pop() || "v4",
    hooksRegistrySchema: v.hooksRegistrySchema || "warpos/hooks-registry/v1",
    migrations: [],
    postUpdateChecks: [
      "node scripts/paths/build.js --check",
      "node scripts/paths/gate.js",
      "node scripts/hooks/build.js --check",
      "node scripts/hooks/test.js",
    ],
    checksumsFile: "checksums.json",
  };
}

function buildSkeletonChangelog(version, current) {
  return `# WarpOS ${version} — ${new Date().toISOString().slice(0, 10)}

> Skeleton generated by scripts/warpos/release-canonical.js. Replace this
> placeholder content with real release notes before tagging.

## What's new since ${current}

- (TODO: list user-visible changes)

## Breaking changes

- None (TODO: confirm)

## Schema changes

- None (TODO: confirm)

## Migrations

- None (TODO: confirm)

## Pinned commit

Captured at release-build time (recorded in release.json#commit after
scripts/warpos/release-build.js runs).
`;
}

function buildSkeletonUpgradeNotes(version, current) {
  return `# Upgrade notes — ${current} → ${version}

> Skeleton generated by scripts/warpos/release-canonical.js. Replace before
> tagging.

## Pre-flight

1. Tag your current state: \`git tag pre-warpos-${version}-update HEAD\`.
2. Confirm clean working tree: \`git status --porcelain\` empty.

## Run the update

\`\`\`bash
node scripts/warpos/update.js --to ${version} \\
  --source ../WarpOS \\
  --target . \\
  --dry-run

node scripts/warpos/update.js --to ${version} \\
  --source ../WarpOS \\
  --target . \\
  --apply
\`\`\`

## Rollback

\`\`\`bash
git reset --hard pre-warpos-${version}-update
\`\`\`

(or restore from \`.warpos/transactions/<latest>/backup/\`).
`;
}

function stageCreateSkeleton(opts, canonical, current, next) {
  const dir = path.join(canonical, "framework", "releases", next);
  const release = path.join(dir, "release.json");
  const changelog = path.join(dir, "changelog.md");
  const upgrade = path.join(dir, "upgrade-notes.md");
  const wrote = [];
  const reuse = [];
  const plan = [];

  if (fs.existsSync(release)) reuse.push("release.json");
  else plan.push("release.json");
  if (fs.existsSync(changelog)) reuse.push("changelog.md");
  else plan.push("changelog.md");
  if (fs.existsSync(upgrade)) reuse.push("upgrade-notes.md");
  else plan.push("upgrade-notes.md");

  if (!opts.apply) {
    return receipt(
      5,
      true,
      `[dry-run] Would create capsule dir + ${plan.length} skeleton file(s); reuse ${reuse.length}`,
      dir,
      "n/a — dry-run",
      { plan, reuse },
    );
  }

  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(release)) {
    writeJson(release, buildSkeletonReleaseJson(canonical, next));
    wrote.push("release.json");
  }
  if (!fs.existsSync(changelog)) {
    fs.writeFileSync(changelog, buildSkeletonChangelog(next, current));
    wrote.push("changelog.md");
  }
  if (!fs.existsSync(upgrade)) {
    fs.writeFileSync(upgrade, buildSkeletonUpgradeNotes(next, current));
    wrote.push("upgrade-notes.md");
  }

  return receipt(
    5,
    true,
    `Created capsule skeleton: wrote ${wrote.length}, kept ${reuse.length}`,
    dir,
    `Remove: rm -rf ${dir} (only safe if nothing else has been built into it)`,
    { wrote, reuse },
  );
}

// ── stage 6: build capsule ────────────────────────────────
function stageBuildCapsule(opts, canonical, next) {
  if (!opts.apply) {
    return receipt(
      6,
      true,
      `[dry-run] Would run scripts/warpos/release-build.js ${next} in canonical`,
      canonical,
      "n/a — dry-run",
    );
  }
  const r = nodeIn(canonical, "scripts/warpos/release-build.js", [next]);
  if (!r.ok) {
    return receipt(
      6,
      false,
      `release-build.js failed (exit ${r.status})`,
      canonical,
      "Inspect stderr; common cause: missing migration files or stale framework-manifest. Fix + --resume-from 6",
      { stderr: r.stderr.slice(0, 500), stdout: r.stdout.slice(0, 500) },
    );
  }
  return receipt(
    6,
    true,
    `Built capsule ${next} (manifest snapshot + checksums)`,
    path.join(canonical, "framework", "releases", next),
    `git -C ${canonical} checkout HEAD -- framework/releases/${next}/checksums.json framework/releases/${next}/framework-manifest.json`,
  );
}

// ── stage 7: gates ────────────────────────────────────────
function stageGates(opts, canonical) {
  // Gates are read-only; safe to run in dry-run too.
  const r = nodeIn(canonical, "scripts/warpos/release-gates.js", ["--json"]);
  let parsed = null;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    /* keep raw */
  }
  // Exit code: 0=green, 1=yellow, 2=red. We block on red only.
  if (r.status === 2) {
    return receipt(
      7,
      false,
      `Release gates: ${parsed ? parsed.red : "?"} red, ${parsed ? parsed.yellow : "?"} yellow — RED blocks release`,
      canonical,
      "Inspect: node scripts/warpos/release-gates.js (in canonical). Fix RED gates, then --resume-from 7",
      { gates: parsed, stdout: r.stdout.slice(0, 500) },
    );
  }
  return receipt(
    7,
    true,
    `Release gates: ${parsed ? parsed.green : "?"} green, ${parsed ? parsed.yellow : "?"} yellow, ${parsed ? parsed.red : 0} red, ${parsed ? parsed.manual || 0 : "?"} manual`,
    canonical,
    "n/a — read-only check",
    { gates: parsed },
  );
}

// ── stage 8: commit on release branch ─────────────────────
function stageCommit(opts, canonical, next) {
  if (!opts.apply) {
    return receipt(
      8,
      true,
      `[dry-run] Would create release/${next} branch in canonical and commit capsule + manifest + version.json`,
      canonical,
      "n/a — dry-run",
    );
  }
  // Pre-flight: there should be SOME staged or unstaged changes (otherwise nothing to commit).
  const status = gitC(canonical, ["status", "--porcelain"]);
  if (!status.ok) {
    return receipt(
      8,
      false,
      `git status failed: ${status.stderr.slice(0, 200)}`,
      canonical,
      "Make sure canonical is a git repo with committable HEAD",
    );
  }
  if (!status.stdout.trim()) {
    return receipt(
      8,
      false,
      "Nothing to commit in canonical — earlier stages may have produced no diff",
      canonical,
      "Verify stages 3-6 actually ran and produced diff; --resume-from 3 to redo",
    );
  }
  // Branch: create or reuse release/<v>.
  const branch = `release/${next}`;
  const branchExists = gitC(canonical, ["rev-parse", "--verify", branch]).ok;
  if (!branchExists) {
    const create = gitC(canonical, ["checkout", "-b", branch]);
    if (!create.ok) {
      return receipt(
        8,
        false,
        `Could not create branch ${branch}: ${create.stderr.slice(0, 200)}`,
        canonical,
        `git -C ${canonical} branch -D ${branch} (if partial) then --resume-from 8`,
      );
    }
  } else {
    const sw = gitC(canonical, ["checkout", branch]);
    if (!sw.ok) {
      return receipt(
        8,
        false,
        `Could not checkout existing branch ${branch}: ${sw.stderr.slice(0, 200)}`,
        canonical,
        "Resolve git state in canonical, then --resume-from 8",
      );
    }
  }
  // Stage all release-related files.
  const add = gitC(canonical, [
    "add",
    "version.json",
    ".claude/framework-manifest.json",
    `framework/releases/${next}`,
  ]);
  if (!add.ok) {
    return receipt(
      8,
      false,
      `git add failed: ${add.stderr.slice(0, 200)}`,
      canonical,
      `git -C ${canonical} reset && --resume-from 8`,
    );
  }
  const commit = gitC(canonical, [
    "commit",
    "-m",
    `release(warpos): ${next} — built by scripts/warpos/release-canonical.js`,
  ]);
  if (!commit.ok) {
    return receipt(
      8,
      false,
      `git commit failed: ${commit.stderr.slice(0, 200)}`,
      canonical,
      `git -C ${canonical} reset HEAD~ then --resume-from 8`,
    );
  }
  return receipt(
    8,
    true,
    `Committed on branch ${branch}`,
    canonical,
    `git -C ${canonical} reset --soft HEAD~ && git -C ${canonical} checkout main && git -C ${canonical} branch -D ${branch}`,
    { branch },
  );
}

// ── stage 9: merge to main + push ─────────────────────────
function stageMergeAndPush(opts, canonical, next, branch) {
  if (!opts.apply) {
    return receipt(
      9,
      true,
      `[dry-run] Would ff-merge release/${next} → main in canonical and push origin main`,
      canonical,
      "n/a — dry-run",
    );
  }
  const sw = gitC(canonical, ["checkout", "main"]);
  if (!sw.ok) {
    return receipt(
      9,
      false,
      `Could not checkout main: ${sw.stderr.slice(0, 200)}`,
      canonical,
      "Resolve canonical git state; --resume-from 9",
    );
  }
  const pull = gitC(canonical, ["pull", "--ff-only", "origin", "main"]);
  if (!pull.ok) {
    return receipt(
      9,
      false,
      `git pull --ff-only origin main failed: ${pull.stderr.slice(0, 200)}`,
      canonical,
      "Reconcile canonical main with origin (rebase/merge upstream first); --resume-from 9",
    );
  }
  const merge = gitC(canonical, ["merge", "--ff-only", branch]);
  if (!merge.ok) {
    return receipt(
      9,
      false,
      `ff-merge failed: ${merge.stderr.slice(0, 200)}`,
      canonical,
      "Inspect canonical history (probably non-linear); resolve manually; --resume-from 9",
    );
  }
  const push = gitC(canonical, ["push", "origin", "main"]);
  if (!push.ok) {
    return receipt(
      9,
      false,
      `push origin main failed: ${push.stderr.slice(0, 200)}`,
      canonical,
      "Authenticate or reconcile; --resume-from 9 (merge already done; only push pending)",
    );
  }
  return receipt(
    9,
    true,
    `Merged ${branch} → main and pushed origin main`,
    canonical,
    `git -C ${canonical} reset --hard origin/main~1 + git -C ${canonical} push --force-with-lease origin main (DESTRUCTIVE — only if not yet consumed downstream)`,
  );
}

// ── stage 10: tag + push ──────────────────────────────────
function stageTag(opts, canonical, next) {
  if (opts.noTag) {
    return receipt(10, true, "Tag skipped (--no-tag)", canonical, "n/a", {
      skipped: true,
    });
  }
  if (!opts.apply) {
    return receipt(
      10,
      true,
      `[dry-run] Would tag warpos@${next} and push to origin`,
      canonical,
      "n/a — dry-run",
    );
  }
  const tag = gitC(canonical, ["tag", `warpos@${next}`]);
  if (!tag.ok) {
    return receipt(
      10,
      false,
      `git tag failed: ${tag.stderr.slice(0, 200)}`,
      canonical,
      `git -C ${canonical} tag -d warpos@${next}; --resume-from 10`,
    );
  }
  const push = gitC(canonical, ["push", "origin", `warpos@${next}`]);
  if (!push.ok) {
    return receipt(
      10,
      false,
      `Tag push failed: ${push.stderr.slice(0, 200)}`,
      canonical,
      `git -C ${canonical} push origin :refs/tags/warpos@${next} to remove remote tag if partial`,
    );
  }
  return receipt(
    10,
    true,
    `Tagged warpos@${next} and pushed to origin`,
    canonical,
    `git -C ${canonical} push origin :refs/tags/warpos@${next} && git -C ${canonical} tag -d warpos@${next}`,
  );
}

// ── orchestrator ──────────────────────────────────────────

async function run(opts) {
  const receipts = [];
  let canonical = null;
  let current = null;
  let next = null;
  let branch = null;

  function shouldRun(stage) {
    return stage >= opts.resumeFrom;
  }

  // Stage 0
  if (shouldRun(0)) {
    const r0 = stageLocate(opts);
    receipts.push(r0);
    if (!r0.ok) return finalize(receipts, opts);
    canonical = r0.canonical;
  } else {
    canonical = locateCanonical(opts.canonical);
    if (!canonical) {
      receipts.push(
        receipt(
          0,
          false,
          "Cannot resume without locating canonical",
          null,
          "Re-run without --resume-from",
        ),
      );
      return finalize(receipts, opts);
    }
  }

  // Stage 1
  if (shouldRun(1)) {
    const r1 = stagePromote(opts, canonical);
    receipts.push(r1);
    if (!r1.ok) return finalize(receipts, opts);
  }

  // Stage 2
  if (shouldRun(2)) {
    const r2 = stageComputeVersion(opts, canonical);
    receipts.push(r2);
    if (!r2.ok) return finalize(receipts, opts);
    current = r2.current;
    next = r2.next;
  } else {
    // Re-derive for downstream stages
    current = readJson(path.join(canonical, "version.json")).version;
    if (/^\d+\.\d+\.\d+$/.test(opts.version)) next = opts.version;
    else
      throw new Error(
        "--resume-from past stage 2 requires explicit --version <x.y.z>",
      );
  }

  // Stage 3
  if (shouldRun(3)) {
    const r3 = stageBumpVersion(opts, canonical, current, next);
    receipts.push(r3);
    if (!r3.ok) return finalize(receipts, opts);
  }

  // Stage 4
  if (shouldRun(4)) {
    const r4 = stageRegenManifest(opts, canonical);
    receipts.push(r4);
    if (!r4.ok) return finalize(receipts, opts);
  }

  // Stage 5
  if (shouldRun(5)) {
    const r5 = stageCreateSkeleton(opts, canonical, current, next);
    receipts.push(r5);
    if (!r5.ok) return finalize(receipts, opts);
  }

  // Stage 6
  if (shouldRun(6)) {
    const r6 = stageBuildCapsule(opts, canonical, next);
    receipts.push(r6);
    if (!r6.ok) return finalize(receipts, opts);
  }

  // Stage 7
  if (shouldRun(7)) {
    const r7 = stageGates(opts, canonical);
    receipts.push(r7);
    if (!r7.ok) return finalize(receipts, opts);
  }

  // Stage 8
  branch = `release/${next}`;
  if (shouldRun(8)) {
    const r8 = stageCommit(opts, canonical, next);
    receipts.push(r8);
    if (!r8.ok) return finalize(receipts, opts);
    if (r8.branch) branch = r8.branch;
  }

  // Stage 9
  if (shouldRun(9)) {
    const r9 = stageMergeAndPush(opts, canonical, next, branch);
    receipts.push(r9);
    if (!r9.ok) return finalize(receipts, opts);
  }

  // Stage 10
  if (shouldRun(10)) {
    const r10 = stageTag(opts, canonical, next);
    receipts.push(r10);
    if (!r10.ok) return finalize(receipts, opts);
  }

  return finalize(receipts, opts, { canonical, current, next, branch });
}

function finalize(receipts, opts, ctx) {
  const allOk = receipts.every((r) => r.ok);
  return {
    ok: allOk,
    mode: opts.apply ? "apply" : "dry-run",
    receipts,
    ...(ctx || {}),
  };
}

// ── CLI ───────────────────────────────────────────────────

function printText(result) {
  console.log(
    `\nrelease-canonical — ${result.mode} — ${result.ok ? "OK" : "FAILED"}\n`,
  );
  for (const r of result.receipts) {
    const tag = r.ok ? "ok " : "FAIL";
    const skipped = r.skipped ? " (skipped)" : "";
    console.log(`  [${tag}] stage ${r.stage} ${r.name}${skipped}`);
    console.log(`         ${r.what}`);
    if (r.where) console.log(`         where: ${r.where}`);
    if (!r.ok && r.rollback) console.log(`         rollback: ${r.rollback}`);
  }
  if (!result.ok) {
    const failed = result.receipts.find((r) => !r.ok);
    console.log(`\nResume after fixing: --resume-from ${failed.stage} --apply`);
  } else if (result.mode === "dry-run") {
    console.log(`\nDry-run complete. Re-run with --apply to execute.`);
  } else {
    console.log(
      `\nReleased ${result.current} → ${result.next}. Canonical: ${result.canonical}`,
    );
  }
  console.log("");
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  run(opts)
    .then((r) => {
      if (opts.json) console.log(JSON.stringify(r, null, 2));
      else printText(r);
      process.exit(r.ok ? 0 : 1);
    })
    .catch((e) => {
      console.error(`release-canonical: ${e.message}`);
      process.exit(2);
    });
}

module.exports = { run, locateCanonical, bumpVersion };
