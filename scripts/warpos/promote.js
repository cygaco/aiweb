/**
 * promote.js — /warp:promote engine. Push framework changes from this repo
 * (the further-along version) to the canonical WarpOS clone.
 *
 * Phase 4D artifact. Per §11 architectural fix (2026-04-30): does NOT trust
 * BACKLOG §4 as a literal acceptance list. Regenerates the propagation
 * list from current state at run time; §4 is treated as intent annotation
 * only.
 *
 * Algorithm:
 *   1. Identify source (this repo) and target (--to <warpos-clone-path>).
 *   2. Read both .claude/framework-installed.json snapshots when available,
 *      else fall back to .claude/framework-manifest.json.
 *   3. Scan only framework-owned paths. Exclude runtime, project memory,
 *      events, logs, handoffs, project manifest, project specs, secrets,
 *      app code (controlled by EXCLUDE_PREFIXES below).
 *   4. Classify per asset into one of 9 categories:
 *      FRAMEWORK_UPDATE, FRAMEWORK_ADD, FRAMEWORK_DELETE,
 *      GENERATED_IGNORE, RUNTIME_IGNORE, PROJECT_IGNORE,
 *      SECRET_BLOCK, TEMPLATE_REVIEW, MIGRATION_CANDIDATE.
 *   5. Generate propagation plan; in --dry-run, print and exit.
 *   6. In --apply, walk the plan and write to target:
 *      Class A: copy adds/updates, skip ignores
 *      Class B: copy migrations, delete framework-deletes (gated by
 *               --confirm-deletes; otherwise list and skip)
 *      Class C: refuse the entire apply (caller must resolve first)
 *      Then write target/.warpos-sync.json sync-stamp and emit a
 *      sync(from-jobhunter): warpos@<version> commit message stub.
 *
 * Usage:
 *   node scripts/warpos/promote.js --to ../WarpOS --dry-run
 *   node scripts/warpos/promote.js --to ../WarpOS --apply
 *   node scripts/warpos/promote.js --to ../WarpOS --apply --confirm-deletes
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { printHumanReport } = require("./report-format");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// Framework-owned tree roots. Only files under these prefixes are candidates
// for promotion. Anything outside is considered project / app code and
// ignored.
//
// 2026-05-01 fix: framework-manifest.json + paths.json had been missing from
// this list, leaving the WarpOS canonical clone with a stale install manifest
// (0.1.0, 203 assets) and no path registry at all — install.ps1 silently
// installed a degraded subset on consumer projects.
const FRAMEWORK_PREFIXES = [
  ".claude/agents/",
  ".claude/commands/",
  ".claude/project/reference/",
  ".claude/framework-manifest.json",
  ".claude/paths.json",
  "scripts/",
  "schemas/",
  "warpos/",
  "migrations/",
  "patterns/",
  "fixtures/",
  "version.json",
  "install.ps1",
  "AGENTS.md",
  "CLAUDE.md",
  "PROJECT.md",
];

// Always-exclude prefixes (runtime, per-project, generated, secrets).
const EXCLUDE_PREFIXES = [
  ".claude/runtime/",
  ".claude/project/events/",
  ".claude/project/memory/",
  ".claude/project/maps/", // generated
  ".claude/agents/.system/dispatch-backups/",
  ".claude/agents/02-oneshot/.system/retros/",
  ".claude/agents/02-oneshot/.system/store.json",
  ".claude/agents/02-oneshot/.system/store.json.prev-run-backup.json",
  ".claude/agents/store.json",
  ".claude/.agent-result-hashes.json",
  ".claude/.last-checkpoint",
  ".claude/.session-checkpoint.json",
  ".claude/scheduled_tasks.lock",
  ".claude/manifest.json", // per-project filled
  ".claude/framework-installed.json", // per-install snapshot
  "requirements/05-features/", // project specs (jobzooka-specific)
  "requirements/_index/", // generated graph
  ".env",
  "node_modules/",
];

// Project-specific manifest fields/files we can ship to WarpOS as TEMPLATES,
// not as filled values. settings.json gets per-project env vars
// (CLAUDE_RUN_NUMBER, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS) that must NOT
// overwrite the canonical distribution settings.
//
// 2026-05-01 fix: paths.json removed — it's framework-canonical (every
// consumer project shares the same path layout). Earlier classification as
// template-review was over-conservative and blocked routine promotion.
const TEMPLATE_REVIEW_PATHS = [
  ".claude/manifest.json",
  ".claude/agents/02-oneshot/.system/store.json",
  ".claude/settings.json",
];

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function isUnder(p, prefix) {
  return p === prefix || p.startsWith(prefix);
}

function isFrameworkOwned(rel) {
  return FRAMEWORK_PREFIXES.some((p) => isUnder(rel, p));
}

function isExcluded(rel) {
  return EXCLUDE_PREFIXES.some((p) => isUnder(rel, p));
}

function isSecretCandidate(rel, content) {
  if (/\.env$/i.test(rel)) return true;
  if (!content) return false;
  // Lightweight scan — extended per codex Phase 4 review (2026-04-30).
  // Catches: OpenAI sk- / sk-proj- / sk-ant- (Anthropic), Slack tokens,
  // Google API keys, AWS access keys, GCP service-account JSON, JWTs,
  // PEM-style private keys, credentialed connection strings.
  const patterns = [
    // Anthropic
    /sk-ant-[A-Za-z0-9_\-]{20,}/,
    // OpenAI (legacy + project-scoped)
    /sk-(?:proj-)?[A-Za-z0-9_\-]{20,}/,
    // Slack bot/oauth tokens
    /x(?:ox[bpsroa])-[0-9A-Za-z\-]{10,}/,
    // Google API keys
    /AIza[0-9A-Za-z_\-]{35}/,
    // AWS
    /AKIA[0-9A-Z]{16}/,
    // GCP service account marker
    /"type"\s*:\s*"service_account"/,
    // JWT (header.payload.sig — three b64url segments)
    /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/,
    // Private keys
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
    // Credentialed connection strings
    /(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^:\/\s]+:[^@\s]+@/i,
  ];
  return patterns.some((p) => p.test(content));
}

function walk(dir, root, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    const rel = path.relative(root, full).replace(/\\/g, "/");
    if (ent.isDirectory()) {
      if (rel === ".git" || rel === "node_modules") continue;
      walk(full, root, out);
    } else if (ent.isFile()) {
      out.push(rel);
    }
  }
}

function listFrameworkFiles(root) {
  const all = [];
  walk(root, root, all);
  return all.filter((f) => isFrameworkOwned(f) && !isExcluded(f));
}

function classify(sourceRoot, targetRoot) {
  const sourceFiles = new Set(listFrameworkFiles(sourceRoot));
  const targetFiles = new Set(targetRoot ? listFrameworkFiles(targetRoot) : []);

  const decisions = [];

  for (const rel of sourceFiles) {
    const sourceAbs = path.join(sourceRoot, rel);
    const targetAbs = targetRoot ? path.join(targetRoot, rel) : null;

    let content;
    try {
      content = fs.readFileSync(sourceAbs, "utf8");
    } catch {
      content = null;
    }

    if (isSecretCandidate(rel, content || "")) {
      decisions.push({
        rel,
        category: "SECRET_BLOCK",
        reason: "Looks like a secret — refuse to promote.",
      });
      continue;
    }
    if (TEMPLATE_REVIEW_PATHS.includes(rel)) {
      decisions.push({
        rel,
        category: "TEMPLATE_REVIEW",
        reason:
          "Per-project filled file — promote as TEMPLATE only after manual review.",
      });
      continue;
    }
    if (rel.startsWith("requirements/05-features/")) {
      decisions.push({
        rel,
        category: "PROJECT_IGNORE",
        reason: "Project-specific specs.",
      });
      continue;
    }
    if (
      rel.startsWith(".claude/project/maps/") ||
      rel.startsWith("requirements/_index/")
    ) {
      decisions.push({
        rel,
        category: "GENERATED_IGNORE",
        reason: "Regenerated artifact.",
      });
      continue;
    }
    if (rel.startsWith(".claude/runtime/")) {
      decisions.push({
        rel,
        category: "RUNTIME_IGNORE",
        reason: "Per-session state.",
      });
      continue;
    }
    if (rel.startsWith("migrations/")) {
      decisions.push({
        rel,
        category: "MIGRATION_CANDIDATE",
        reason: "Migration scripts — promote if not already in target.",
      });
      continue;
    }

    if (!targetRoot) {
      decisions.push({
        rel,
        category: "FRAMEWORK_ADD",
        reason: "Source-only (target not provided for full diff).",
      });
      continue;
    }
    if (!targetFiles.has(rel)) {
      decisions.push({
        rel,
        category: "FRAMEWORK_ADD",
        reason: "Source has it, target doesn't.",
      });
      continue;
    }
    const sourceSha = sha256File(sourceAbs);
    const targetSha = sha256File(targetAbs);
    if (sourceSha !== targetSha) {
      decisions.push({
        rel,
        category: "FRAMEWORK_UPDATE",
        reason: "Source differs from target.",
      });
    }
    // sourceSha === targetSha → already in sync, skip
  }

  if (targetRoot) {
    for (const rel of targetFiles) {
      if (!sourceFiles.has(rel)) {
        decisions.push({
          rel,
          category: "FRAMEWORK_DELETE",
          reason: "Target has it, source doesn't — candidate for deletion.",
        });
      }
    }
  }

  return decisions;
}

function summarize(decisions) {
  const counts = {};
  for (const d of decisions) counts[d.category] = (counts[d.category] || 0) + 1;
  return counts;
}

async function run(opts) {
  const targetRoot = opts.to ? path.resolve(opts.to) : null;
  const dryRun = opts.dryRun || !opts.apply;

  if (targetRoot && !fs.existsSync(targetRoot)) {
    throw new Error(`Target path does not exist: ${targetRoot}`);
  }

  const decisions = classify(REPO_ROOT, targetRoot);
  const counts = summarize(decisions);

  // Map promote categories → A/B/C decision class (Phase 4K wiring)
  const classMap = {
    FRAMEWORK_ADD: "A",
    FRAMEWORK_UPDATE: "A",
    FRAMEWORK_DELETE: "B", // human ack on deletes
    GENERATED_IGNORE: "A",
    RUNTIME_IGNORE: "A",
    PROJECT_IGNORE: "A",
    MIGRATION_CANDIDATE: "B",
    TEMPLATE_REVIEW: "C",
    SECRET_BLOCK: "C",
  };
  const byClass = { A: 0, B: 0, C: 0 };
  for (const d of decisions) {
    const cls = classMap[d.category] || "C";
    byClass[cls] += 1;
  }

  const report = {
    sourceRoot: REPO_ROOT,
    targetRoot,
    dryRun,
    counts,
    classCounts: byClass,
    notes: [
      "Phase 4D: §4 promotion-backlog is treated as intent annotation only — this list is regenerated from current filesystem state.",
      "Items in §4 that no longer match filesystem state are silently dropped.",
      "Items not in §4 surface as part of the appropriate category for human acknowledgement before promotion.",
    ],
  };

  if (dryRun) {
    return {
      ok: true,
      mode: "dry-run",
      report,
      sample: decisions.slice(0, 20),
      total: decisions.length,
    };
  }

  // ── Apply path ──────────────────────────────────────────
  // Refuse if any Class C surfaced (TEMPLATE_REVIEW / SECRET_BLOCK).
  // The user must resolve those before any write hits target.
  if (byClass.C > 0) {
    const offenders = decisions
      .filter((d) => classMap[d.category] === "C")
      .slice(0, 10)
      .map((d) => `${d.category}: ${d.rel}`);
    return {
      ok: false,
      mode: "apply",
      error: `ESCALATE: ${byClass.C} Class C item(s) must be resolved before --apply. Sample:\n  ${offenders.join("\n  ")}`,
      report,
    };
  }

  const applyResult = applyDecisions(REPO_ROOT, targetRoot, decisions, {
    confirmDeletes: !!opts.confirmDeletes,
  });

  // Sync stamp + version for downstream tooling / commit message.
  let sourceVersion = null;
  try {
    sourceVersion = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "version.json"), "utf8"),
    ).version;
  } catch {}
  const stamp = {
    syncedAt: new Date().toISOString(),
    sourceVersion,
    sourceCommit: gitHeadShort(REPO_ROOT),
    counts: applyResult.counts,
    notes:
      "Written by scripts/warpos/promote.js --apply. Do not hand-edit; this is the canonical sync record.",
  };
  fs.writeFileSync(
    path.join(targetRoot, ".warpos-sync.json"),
    JSON.stringify(stamp, null, 2) + "\n",
  );

  const commitMessage = buildCommitMessage(sourceVersion, applyResult);
  fs.writeFileSync(
    path.join(targetRoot, ".warpos-sync-commit-msg.txt"),
    commitMessage,
  );

  return {
    ok: applyResult.ok,
    mode: "apply",
    report,
    apply: applyResult,
    sourceVersion,
    commitMessage,
  };
}

// ── Apply helpers ─────────────────────────────────────────

function gitHeadShort(root) {
  try {
    return require("child_process")
      .execSync("git rev-parse --short HEAD", { cwd: root, encoding: "utf8" })
      .trim();
  } catch {
    return null;
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function applyDecisions(sourceRoot, targetRoot, decisions, opts) {
  const counts = {
    copied: 0,
    updated: 0,
    deleted: 0,
    deletes_skipped: 0,
    migrations_copied: 0,
    skipped_ignore: 0,
    errors: 0,
  };
  const errors = [];

  for (const d of decisions) {
    const srcAbs = path.join(sourceRoot, d.rel);
    const dstAbs = path.join(targetRoot, d.rel);

    try {
      switch (d.category) {
        case "FRAMEWORK_ADD": {
          ensureDir(path.dirname(dstAbs));
          fs.copyFileSync(srcAbs, dstAbs);
          counts.copied += 1;
          break;
        }
        case "FRAMEWORK_UPDATE": {
          ensureDir(path.dirname(dstAbs));
          fs.copyFileSync(srcAbs, dstAbs);
          counts.updated += 1;
          break;
        }
        case "MIGRATION_CANDIDATE": {
          ensureDir(path.dirname(dstAbs));
          fs.copyFileSync(srcAbs, dstAbs);
          counts.migrations_copied += 1;
          break;
        }
        case "FRAMEWORK_DELETE": {
          if (!opts.confirmDeletes) {
            counts.deletes_skipped += 1;
            break;
          }
          if (fs.existsSync(dstAbs)) {
            fs.unlinkSync(dstAbs);
            counts.deleted += 1;
          }
          break;
        }
        case "GENERATED_IGNORE":
        case "RUNTIME_IGNORE":
        case "PROJECT_IGNORE":
          counts.skipped_ignore += 1;
          break;
        default:
          // Class C and unknowns should have been blocked above. Skip.
          counts.skipped_ignore += 1;
      }
    } catch (e) {
      counts.errors += 1;
      errors.push({ rel: d.rel, category: d.category, error: e.message });
    }
  }

  return { ok: counts.errors === 0, counts, errors };
}

function buildCommitMessage(sourceVersion, applyResult) {
  const v = sourceVersion || "unknown";
  const c = applyResult.counts;
  const lines = [
    `sync(from-jobhunter): warpos@${v}`,
    "",
    "Promotion via scripts/warpos/promote.js --apply.",
    "",
    `- ${c.copied} files added`,
    `- ${c.updated} files updated`,
    `- ${c.migrations_copied} migrations copied`,
    `- ${c.deleted} files deleted` +
      (c.deletes_skipped
        ? ` (${c.deletes_skipped} delete(s) skipped — re-run with --confirm-deletes to apply)`
        : ""),
    `- ${c.skipped_ignore} files skipped (generated/runtime/project-specific)`,
    "",
    "See .warpos-sync.json for the full sync record.",
  ];
  return lines.join("\n") + "\n";
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    if (i === -1) return null;
    return args[i + 1];
  };
  const opts = {
    to: get("--to"),
    apply: args.includes("--apply"),
    dryRun: args.includes("--dry-run"),
    json: args.includes("--json"),
    confirmDeletes: args.includes("--confirm-deletes"),
  };
  run(opts)
    .then((r) => {
      if (opts.json) {
        console.log(JSON.stringify(r, null, 2));
        // Fix-forward (codex Phase 4 review): exit non-zero on engine failure.
        process.exit(r.ok ? 0 : 1);
        return;
      }
      console.log(
        `Promote plan (${r.mode}): ${r.report.sourceRoot} → ${r.report.targetRoot || "(no target — source-only scan)"}`,
      );
      console.log(`  Class A (auto):           ${r.report.classCounts.A}`);
      console.log(`  Class B (apply+review):   ${r.report.classCounts.B}`);
      console.log(`  Class C (escalate):       ${r.report.classCounts.C}`);
      console.log("  Counts by category:");
      for (const [k, v] of Object.entries(r.report.counts)) {
        console.log(`    ${k.padEnd(22)} ${v}`);
      }
      if (r.total !== undefined) {
        console.log(`  Total decisions: ${r.total}`);
      }
      const isApply = r.mode === "apply" && r.apply;
      const applyCounts = isApply ? r.apply.counts : null;
      if (isApply) {
        console.log("");
        console.log(
          `Apply: copied=${applyCounts.copied} updated=${applyCounts.updated} migrations=${applyCounts.migrations_copied} deleted=${applyCounts.deleted} (skipped=${applyCounts.deletes_skipped}) ignored=${applyCounts.skipped_ignore} errors=${applyCounts.errors}`,
        );
      }
      printHumanReport("warp:promote", {
        verdict:
          r.report.classCounts.C > 0
            ? "Needs human decision"
            : isApply
              ? "Promotion applied"
              : "Promotion dry-run ready",
        whatChanged: isApply
          ? `${applyCounts.copied + applyCounts.updated + applyCounts.migrations_copied + applyCounts.deleted} files written/removed in target`
          : `${r.total || 0} promotion decision(s) classified`,
        why: "Regenerates the framework propagation list from filesystem state instead of trusting a stale backlog.",
        risksRemaining:
          r.report.classCounts.C > 0
            ? `${r.report.classCounts.C} Class C item(s)`
            : isApply
              ? applyCounts.deletes_skipped > 0
                ? `${applyCounts.deletes_skipped} delete(s) deferred — pass --confirm-deletes to apply.`
                : "None — review the target diff before committing."
              : "Run --apply to write the plan to target.",
        whatWasRejected:
          r.mode === "dry-run"
            ? "No files were changed."
            : isApply
              ? applyCounts.errors > 0
                ? `${applyCounts.errors} write(s) failed — see error list.`
                : "Class C items (none surfaced)."
              : "Apply path refused.",
        whatWasTested:
          "Framework/project/runtime/secret boundaries were classified.",
        needsHumanDecision:
          r.report.classCounts.C > 0
            ? "Resolve template-review or secret-block items."
            : isApply
              ? "Review the .warpos-sync-commit-msg.txt and target diff, then commit + push."
              : "None for dry-run.",
        recommendedNextAction: isApply
          ? `cd ${r.report.targetRoot} && git add -A && git commit -F .warpos-sync-commit-msg.txt && git push origin main`
          : "Review Class B/C entries before promoting to the canonical WarpOS clone.",
      });
      if (!r.ok) {
        console.error(`promote: ${r.error || "engine failure"}`);
        process.exit(1);
      }
    })
    .catch((e) => {
      console.error(`promote: ${e.message}`);
      process.exit(2);
    });
}

module.exports = { run, classify };
