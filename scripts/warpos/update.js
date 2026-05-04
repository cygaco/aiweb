/**
 * update.js — /warp:update engine. Apply or dry-run a release capsule against
 * a local install.
 *
 * Cross-repo aware:
 *   --source <path>   canonical WarpOS repo (where the capsule lives)
 *   --target <path>   the install to be updated (where writes land)
 *   --to <version>    capsule version (e.g. 0.1.2)
 *
 * If --source/--target are omitted, both default to REPO_ROOT (the repo where
 * update.js itself lives), which is the legacy "self-update" mode used by
 * release-gate fixtures.
 *
 * Algorithm:
 *   1. Read installed snapshot from <target>/.claude/framework-installed.json
 *   2. Read source release capsule from <source>/framework/releases/<to>/release.json
 *   3. Classify each asset into one of 12 categories.
 *   4. dry-run: print plan + exit.
 *      apply  : write transaction record, copy files, run migrations,
 *               execute post-update checks, update installed snapshot.
 *
 * Pre-0.1.2 update.js had four broken behaviours that this rewrite fixes:
 *   - sourceTreeRoot was resolved as `..`/`..` from the capsule, landing at
 *     warpos/ (not the repo root) and making every cross-repo apply load
 *     from the wrong source tree.
 *   - migrations listed in release.json were never executed; only counted.
 *   - postUpdateChecks were never executed; only counted.
 *   - MERGE_SAFE was a fiction: any local-customized file with mergeStrategy
 *     three_way_markdown got overwritten by upstream and reported as
 *     "merged."
 *   - No transaction/rollback. An interrupted apply left no breadcrumbs.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { printHumanReport } = require("./report-format");
const migrationsLoader = require("./migrations-loader");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function readJSON(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

/**
 * Resolve the WarpOS source-tree root from a capsule directory.
 *
 * Walk up from the capsule looking for a dir that has version.json + .claude
 * + warpos/. This is robust to capsule location moves and avoids the brittle
 * `..`/`..` two-level assumption that landed at warpos/, not the repo root.
 */
function findRepoRootFromCapsule(capsuleDir) {
  let current = path.resolve(capsuleDir);
  for (let i = 0; i < 6; i++) {
    if (
      fs.existsSync(path.join(current, "version.json")) &&
      fs.existsSync(path.join(current, ".claude")) &&
      fs.existsSync(path.join(current, "framework"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(
    `Could not resolve WarpOS repo root from capsule: ${capsuleDir}`,
  );
}

function loadCapsule(sourceRoot, version) {
  const capsuleDir = path.join(sourceRoot, "framework", "releases", version);
  const releaseFile = path.join(capsuleDir, "release.json");
  const manifestFile = path.join(capsuleDir, "framework-manifest.json");
  const checksumsFile = path.join(capsuleDir, "checksums.json");
  if (!fs.existsSync(releaseFile)) {
    throw new Error(
      `Capsule ${version} missing release.json at ${releaseFile}`,
    );
  }
  if (!fs.existsSync(manifestFile)) {
    throw new Error(
      `Capsule ${version} missing framework-manifest.json snapshot`,
    );
  }
  // Verify checksums match before trusting the capsule.
  if (fs.existsSync(checksumsFile)) {
    const checksums = JSON.parse(fs.readFileSync(checksumsFile, "utf8"));
    const drift = [];
    for (const [file, expected] of Object.entries(checksums.entries || {})) {
      const abs = path.resolve(capsuleDir, file);
      if (!fs.existsSync(abs)) continue;
      const actual = sha256File(abs);
      if (actual !== expected) {
        drift.push({
          file,
          expected: expected.slice(0, 8),
          actual: (actual || "").slice(0, 8),
        });
      }
    }
    if (drift.length > 0) {
      throw new Error(
        `Capsule ${version} checksum drift detected (${drift.length} file(s)): ${drift
          .slice(0, 3)
          .map((d) => `${d.file}:${d.expected}≠${d.actual}`)
          .join(
            "; ",
          )}. Refuse to trust. Re-run scripts/warpos/release-build.js ${version}`,
      );
    }
  } else {
    process.stderr.write(
      `[update] WARN: capsule ${version} missing checksums.json — proceeding without integrity check\n`,
    );
  }
  return {
    dir: capsuleDir,
    release: JSON.parse(fs.readFileSync(releaseFile, "utf8")),
    manifest: JSON.parse(fs.readFileSync(manifestFile, "utf8")),
  };
}

function flattenAssets(manifest) {
  const out = new Map();
  for (const kind of Object.keys(manifest.assets || {})) {
    for (const a of manifest.assets[kind]) {
      out.set(a.dest, { ...a, kind });
    }
  }
  return out;
}

/**
 * Classify each asset in the target manifest against installed state.
 *
 * 0.1.2: a customized local file with mergeStrategy three_way_markdown is
 * classified MERGE_CONFLICT, not MERGE_SAFE. The previous classification
 * pretended a real merge would happen; the apply path then copied upstream
 * over local and reported success. Until a real three-way merger lands,
 * MERGE_SAFE is reserved for files that genuinely don't need a merge.
 */
function classify(installed, capsule, targetRoot) {
  const targetAssets = flattenAssets(capsule.manifest);
  const installedAssets =
    installed && installed.assets
      ? new Map((installed.assets || []).map((a) => [a.dest, a]))
      : new Map();

  const decisions = [];
  const root = targetRoot || REPO_ROOT;

  for (const [dest, asset] of targetAssets) {
    const localPath = path.join(root, dest);
    const installedRecord = installedAssets.get(dest);
    const localExists = fs.existsSync(localPath);
    const localSha = localExists ? sha256File(localPath) : null;
    const targetSha = asset.sha256 || null;

    let category = "UNKNOWN";
    let reason = "";

    if (asset.owner === "generated") {
      category = "GENERATED_REBUILD";
      reason = "Owner=generated; will be regenerated by post-update gate.";
    } else if (!localExists && !installedRecord) {
      category = "ADD_SAFE";
      reason = "New asset, not present locally and not previously installed.";
    } else if (!localExists && installedRecord) {
      category = "DELETE_CONFLICT";
      reason =
        "Was installed but file is missing — possible local delete; do not silently re-add.";
    } else if (localExists && !installedRecord) {
      category = "LOCAL_ONLY";
      reason = "Local file exists outside framework; will not be touched.";
    } else if (localSha === targetSha) {
      category = "UPDATE_SAFE";
      reason = "Already at target version (sha matches).";
    } else if (installedRecord && installedRecord.installedHash === localSha) {
      category = "UPDATE_SAFE";
      reason =
        "Local matches the version originally installed → upstream change is safe to apply.";
    } else {
      // Local has been customized
      const mergeStrategy =
        asset.mergeStrategy ||
        installedRecord?.mergeStrategy ||
        "replace_if_unmodified";
      if (mergeStrategy === "regenerate") {
        category = "GENERATED_REBUILD";
        reason =
          "Local customized but file is regenerable — overwriting with regenerated content.";
      } else if (mergeStrategy === "keep_local") {
        category = "LOCAL_CUSTOMIZED";
        reason = "Local customized, mergeStrategy=keep_local — leave as-is.";
      } else {
        // three_way_markdown / replace_if_unmodified / anything else with a
        // dirty local file ⇒ human review. We do NOT pretend a merge happened.
        category = "MERGE_CONFLICT";
        reason = `Local customized, mergeStrategy=${mergeStrategy} — three-way merge not implemented; requires human review.`;
      }
    }

    decisions.push({
      id: asset.id,
      dest,
      kind: asset.kind,
      owner: asset.owner || "framework",
      category,
      reason,
    });
  }

  // Detect installed assets the new capsule no longer ships
  for (const [dest, rec] of installedAssets) {
    if (!targetAssets.has(dest)) {
      const localPath = path.join(root, dest);
      const localExists = fs.existsSync(localPath);
      const localSha = localExists ? sha256File(localPath) : null;
      let category = "DELETE_SAFE";
      let reason =
        "Removed in target version, local matches installed (safe to delete).";
      if (!localExists) {
        category = "DELETE_SAFE";
        reason = "Already gone locally.";
      } else if (rec.installedHash && localSha !== rec.installedHash) {
        category = "DELETE_CONFLICT";
        reason =
          "Removed in target but local differs from installed snapshot — preserve.";
      }
      decisions.push({
        id: rec.id || dest,
        dest,
        kind: rec.kind || "unknown",
        owner: rec.owner || "framework",
        category,
        reason,
      });
    }
  }

  return decisions;
}

function summarize(decisions) {
  const counts = {};
  for (const d of decisions) counts[d.category] = (counts[d.category] || 0) + 1;
  return counts;
}

function planClass(decisions) {
  // Map 12 categories → A/B/C decision class (Phase 4K wiring)
  const map = {
    ADD_SAFE: "A",
    UPDATE_SAFE: "A",
    DELETE_SAFE: "A",
    GENERATED_REBUILD: "A",
    MERGE_SAFE: "B",
    RENAME_SAFE: "B",
    MIGRATION_REQUIRED: "B",
    LOCAL_ONLY: "A", // no-op
    LOCAL_CUSTOMIZED: "A", // no-op
    MERGE_CONFLICT: "C",
    DELETE_CONFLICT: "C",
    RENAME_CONFLICT: "C",
  };
  const out = { A: [], B: [], C: [] };
  for (const d of decisions) {
    const cls = map[d.category] || "C";
    out[cls].push(d);
  }
  return out;
}

// ── Transaction helpers ──────────────────────────────────

function newTransactionId(target) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${ts}-warp-update-${path.basename(target)}`;
}

function writeTransactionPlan(targetRoot, txId, header, decisions, capsule) {
  const dir = path.join(targetRoot, ".warpos", "transactions", txId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "header.json"),
    JSON.stringify(header, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(dir, "plan.json"),
    JSON.stringify(decisions, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(dir, "capsule.json"),
    JSON.stringify({ dir: capsule.dir, release: capsule.release }, null, 2) +
      "\n",
  );
  return dir;
}

function backupFile(targetRoot, txDir, relPath) {
  const abs = path.join(targetRoot, relPath);
  if (!fs.existsSync(abs)) return null;
  const dest = path.join(txDir, "backup", relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(abs, dest);
  return dest;
}

// ── Apply ────────────────────────────────────────────────

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function flattenSourceAssets(manifest) {
  const out = new Map();
  for (const kind of Object.keys(manifest.assets || {})) {
    for (const a of manifest.assets[kind]) {
      out.set(a.dest, { ...a, kind });
    }
  }
  return out;
}

function applyUpdateDecisions(
  sourceTreeRoot,
  targetRoot,
  decisions,
  capsuleManifest,
  txDir,
  opts,
) {
  const counts = {
    added: 0,
    updated: 0,
    deleted: 0,
    deletes_skipped: 0,
    merge_conflicts_held: 0,
    skipped_no_op: 0,
    errors: 0,
    backups: 0,
  };
  const errors = [];

  const sourceAssets = flattenSourceAssets(capsuleManifest);

  for (const d of decisions) {
    const dstAbs = path.join(targetRoot, d.dest);
    try {
      switch (d.category) {
        case "ADD_SAFE":
        case "UPDATE_SAFE":
        case "GENERATED_REBUILD": {
          const asset = sourceAssets.get(d.dest);
          if (!asset) {
            counts.errors += 1;
            errors.push({
              dest: d.dest,
              error: "asset not in source manifest",
            });
            break;
          }
          const srcAbs = path.join(sourceTreeRoot, asset.src);
          if (!fs.existsSync(srcAbs)) {
            counts.errors += 1;
            errors.push({
              dest: d.dest,
              error: `source missing: ${asset.src}`,
            });
            break;
          }
          // Backup before overwrite (only if a local file actually exists).
          if (fs.existsSync(dstAbs)) {
            backupFile(targetRoot, txDir, d.dest);
            counts.backups += 1;
          }
          ensureDir(path.dirname(dstAbs));
          fs.copyFileSync(srcAbs, dstAbs);
          if (d.category === "ADD_SAFE") counts.added += 1;
          else counts.updated += 1;
          break;
        }
        case "MERGE_CONFLICT": {
          // Held — surface in report, do not write.
          counts.merge_conflicts_held += 1;
          break;
        }
        case "DELETE_SAFE": {
          if (!opts.confirmDeletes) {
            counts.deletes_skipped += 1;
            break;
          }
          if (fs.existsSync(dstAbs)) {
            backupFile(targetRoot, txDir, d.dest);
            counts.backups += 1;
            fs.unlinkSync(dstAbs);
            counts.deleted += 1;
          }
          break;
        }
        case "LOCAL_ONLY":
        case "LOCAL_CUSTOMIZED":
          counts.skipped_no_op += 1;
          break;
        default:
          counts.skipped_no_op += 1;
      }
    } catch (e) {
      counts.errors += 1;
      errors.push({ dest: d.dest, category: d.category, error: e.message });
    }
  }

  return { ok: counts.errors === 0, counts, errors };
}

function buildInstalledSnapshot(
  version,
  capsule,
  applyResult,
  prior,
  targetRoot,
) {
  const root = targetRoot || REPO_ROOT;
  const assets = [];
  for (const kind of Object.keys(capsule.manifest.assets || {})) {
    for (const a of capsule.manifest.assets[kind]) {
      const localPath = path.join(root, a.dest);
      const localHash = fs.existsSync(localPath) ? sha256File(localPath) : null;
      assets.push({
        id: a.id,
        kind,
        dest: a.dest,
        owner: a.owner || "framework",
        mergeStrategy: a.mergeStrategy,
        installedHash: a.sha256 || localHash,
        currentHashAtInstall: localHash,
        introducedIn: a.introducedIn || version,
      });
    }
  }
  return {
    $schema: "warpos/framework-installed/v2",
    installedVersion: version,
    installedCommit:
      capsule.release.commit ||
      capsule.release.sourceCommit ||
      (prior && prior.installedCommit) ||
      null,
    installedAt: new Date().toISOString(),
    source: capsule.dir,
    target: root,
    pathRegistryVersion: "v4",
    manifestSchema: "warpos/framework-manifest/v2",
    assets,
    generated: [
      ".claude/paths.json",
      ".claude/manifest.json",
      ".claude/settings.json",
      ".claude/agents/store.json",
    ],
    applyCounts: applyResult.counts,
  };
}

// ── Migration runner ─────────────────────────────────────
//
// release.json may list migration ids/files. We resolve them through
// migrations-loader.js#applyAll(from, to, ctx). ctx is set so migrations
// know which target tree to mutate. If a migration throws, we mark it
// failed and stop (subsequent migrations are listed but not run).
async function runMigrations(fromVersion, toVersion, targetRoot) {
  const files = migrationsLoader.listMigrations(fromVersion, toVersion);
  if (files.length === 0) {
    return {
      ran: 0,
      failed: 0,
      log: [],
      status: "skipped",
      reason: `no migrations directory migrations/${fromVersion}-to-${toVersion}/ exists`,
    };
  }
  try {
    const log = await migrationsLoader.applyAll(fromVersion, toVersion, {
      targetRoot,
    });
    const ran = log.length;
    const failed = log.filter((e) => e.result && e.result.ok === false).length;
    return {
      ran,
      failed,
      log,
      status: failed === 0 ? "passed" : "failed",
    };
  } catch (e) {
    return {
      ran: 0,
      failed: 1,
      log: [{ error: e.message }],
      status: "failed",
    };
  }
}

// ── Post-update check runner ─────────────────────────────
//
// release.json#postUpdateChecks is an array of shell-style strings ("node
// scripts/X.js [args...]"). We run each in targetRoot. Status mapping:
//   exit 0 → passed
//   exit non-zero → failed
//   absent / parse-error → degraded
function runPostUpdateChecks(checks, targetRoot) {
  const out = [];
  for (const check of checks || []) {
    if (typeof check !== "string" || !check.trim()) {
      out.push({ check, status: "degraded", reason: "empty/invalid entry" });
      continue;
    }
    // Only support `node <script.js> [args...]` — anything else is degraded.
    const trimmed = check.trim();
    const m = trimmed.match(/^node\s+(\S+)(?:\s+(.*))?$/);
    if (!m) {
      out.push({
        check,
        status: "degraded",
        reason: "non-node check; cannot run automatically",
      });
      continue;
    }
    const scriptRel = m[1];
    const args = m[2] ? m[2].split(/\s+/) : [];
    const scriptAbs = path.join(targetRoot, scriptRel);
    if (!fs.existsSync(scriptAbs)) {
      out.push({
        check,
        status: "degraded",
        reason: `script missing in target: ${scriptRel}`,
      });
      continue;
    }
    const r = spawnSync(process.execPath, [scriptAbs, ...args], {
      cwd: targetRoot,
      encoding: "utf8",
      timeout: 60_000,
    });
    out.push({
      check,
      status: r.status === 0 ? "passed" : "failed",
      exitCode: r.status,
      stderr: (r.stderr || "").slice(0, 200),
    });
  }
  return out;
}

async function run(opts) {
  const target = opts.to;
  const apply = !!opts.apply;
  const dryRun = !!opts.dryRun || !apply;

  // Resolve source/target roots. Defaults to self-update against REPO_ROOT.
  const sourceRoot = opts.source ? path.resolve(opts.source) : REPO_ROOT;
  const targetRoot = opts.target ? path.resolve(opts.target) : REPO_ROOT;

  const installedFile = path.join(
    targetRoot,
    ".claude",
    "framework-installed.json",
  );
  const frameworkManifestFile = path.join(
    targetRoot,
    ".claude",
    "framework-manifest.json",
  );

  const installed = readJSON(installedFile, null);
  const currentManifest = readJSON(frameworkManifestFile, { version: "0.0.0" });
  const fromVersion =
    (installed && installed.installedVersion) ||
    currentManifest.version ||
    "0.0.0";

  if (!target) throw new Error("Missing --to <version>");

  const capsule = loadCapsule(sourceRoot, target);
  if (capsule.release.version !== target) {
    throw new Error(
      `Capsule version mismatch: requested ${target}, capsule says ${capsule.release.version}`,
    );
  }

  // Resolve sourceTreeRoot via the robust walk (capsule → repo root).
  // Honours an explicit override for unusual layouts.
  let sourceTreeRoot;
  if (opts.sourceRoot) {
    sourceTreeRoot = path.resolve(opts.sourceRoot);
  } else {
    sourceTreeRoot = findRepoRootFromCapsule(capsule.dir);
  }

  const decisions = classify(installed, capsule, targetRoot);
  const counts = summarize(decisions);
  const byClass = planClass(decisions);

  const report = {
    fromVersion,
    toVersion: target,
    dryRun,
    sourceRoot,
    targetRoot,
    sourceTreeRoot,
    counts,
    classCounts: {
      A: byClass.A.length,
      B: byClass.B.length,
      C: byClass.C.length,
    },
    migrations: capsule.release.migrations || [],
    postUpdateChecks: capsule.release.postUpdateChecks || [],
  };

  if (dryRun) {
    return {
      ok: true,
      mode: "dry-run",
      report,
      sample: {
        A: byClass.A.slice(0, 5).map((d) => ({
          id: d.id,
          dest: d.dest,
          category: d.category,
        })),
        B: byClass.B.slice(0, 5).map((d) => ({
          id: d.id,
          dest: d.dest,
          category: d.category,
        })),
        C: byClass.C.slice(0, 5).map((d) => ({
          id: d.id,
          dest: d.dest,
          category: d.category,
        })),
      },
    };
  }

  // ── Apply ────────────────────────────────────────────────
  if (byClass.C.length > 0) {
    const offenders = byClass.C.slice(0, 10).map(
      (d) => `${d.category}: ${d.dest}`,
    );
    return {
      ok: false,
      mode: "apply",
      error: `ESCALATE: ${byClass.C.length} Class C item(s) must be resolved before --apply. Sample:\n  ${offenders.join("\n  ")}`,
      report,
    };
  }

  const txId = newTransactionId(targetRoot);
  const txDir = writeTransactionPlan(
    targetRoot,
    txId,
    {
      kind: "warp:update",
      fromVersion,
      toVersion: target,
      sourceRoot,
      targetRoot,
      sourceTreeRoot,
      startedAt: new Date().toISOString(),
    },
    decisions,
    capsule,
  );

  const applyResult = applyUpdateDecisions(
    sourceTreeRoot,
    targetRoot,
    decisions,
    capsule.manifest,
    txDir,
    {
      confirmDeletes: !!opts.confirmDeletes,
    },
  );

  // Run migrations if any
  const migrationsResult = await runMigrations(fromVersion, target, targetRoot);

  // Run post-update checks
  const postUpdateResults = runPostUpdateChecks(
    capsule.release.postUpdateChecks || [],
    targetRoot,
  );

  // Write updated installed snapshot
  const newInstalled = buildInstalledSnapshot(
    target,
    capsule,
    applyResult,
    installed,
    targetRoot,
  );
  fs.writeFileSync(installedFile, JSON.stringify(newInstalled, null, 2) + "\n");

  // Finalize transaction
  fs.writeFileSync(
    path.join(txDir, "result.json"),
    JSON.stringify(
      {
        completedAt: new Date().toISOString(),
        apply: applyResult,
        migrations: migrationsResult,
        postUpdateChecks: postUpdateResults,
      },
      null,
      2,
    ) + "\n",
  );
  fs.writeFileSync(
    path.join(txDir, "ROLLBACK.md"),
    [
      "# Rollback instructions",
      "",
      `Transaction ${txId}.`,
      "",
      "Backups of files this update overwrote or deleted live in:",
      "",
      `    ${path.relative(targetRoot, txDir).replace(/\\/g, "/")}/backup/`,
      "",
      "To restore a single file:",
      "",
      "    cp <transaction>/backup/<rel-path> <rel-path>",
      "",
      "To restore everything:",
      "",
      "    cp -r <transaction>/backup/* .",
      "",
      "Then check `git status` and reset framework-installed.json from the prior snapshot.",
      "",
    ].join("\n"),
  );

  // Update overall ok with migration + post-check results
  const allOk =
    applyResult.ok &&
    migrationsResult.status !== "failed" &&
    !postUpdateResults.some((c) => c.status === "failed");

  return {
    ok: allOk,
    mode: "apply",
    report,
    apply: applyResult,
    migrations: migrationsResult,
    postUpdateChecks: postUpdateResults,
    transaction: txId,
    transactionDir: path.relative(targetRoot, txDir).replace(/\\/g, "/"),
  };
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
    source: get("--source"),
    target: get("--target"),
    // Legacy: --source-root pointed at the source tree directly. Kept for
    // back-compat. Prefer --source.
    sourceRoot: get("--source-root"),
  };
  if (!opts.to) {
    console.error(
      "Usage: node scripts/warpos/update.js --to <version> [--source <warpos-repo>] [--target <install-path>] [--dry-run | --apply] [--confirm-deletes]",
    );
    process.exit(2);
  }
  run(opts)
    .then((r) => {
      if (opts.json) {
        console.log(JSON.stringify(r, null, 2));
        return;
      }
      if (!r.ok) {
        console.error(r.error || "Update failed.");
        if (r.report) console.error(JSON.stringify(r.report, null, 2));
        process.exit(1);
      }
      console.log(
        `Update plan ${r.report.fromVersion} → ${r.report.toVersion} (${r.mode})`,
      );
      console.log(`  source:  ${r.report.sourceRoot}`);
      console.log(`  target:  ${r.report.targetRoot}`);
      console.log(`  Class A (auto):           ${r.report.classCounts.A}`);
      console.log(`  Class B (apply+review):   ${r.report.classCounts.B}`);
      console.log(`  Class C (escalate):       ${r.report.classCounts.C}`);
      console.log("  Counts by category:");
      for (const [k, v] of Object.entries(r.report.counts)) {
        console.log(`    ${k.padEnd(22)} ${v}`);
      }
      console.log(`  Migrations: ${r.report.migrations.length}`);
      console.log(`  Post-update checks: ${r.report.postUpdateChecks.length}`);
      const isApply = r.mode === "apply" && r.apply;
      const ac = isApply ? r.apply.counts : null;
      if (isApply) {
        console.log("");
        console.log(
          `Apply: added=${ac.added} updated=${ac.updated} merge_conflicts_held=${ac.merge_conflicts_held} deleted=${ac.deleted} (skipped=${ac.deletes_skipped}) backups=${ac.backups} no-op=${ac.skipped_no_op} errors=${ac.errors}`,
        );
        if (r.migrations) {
          console.log(
            `Migrations: ran=${r.migrations.ran} failed=${r.migrations.failed} status=${r.migrations.status}`,
          );
        }
        if (r.postUpdateChecks && r.postUpdateChecks.length > 0) {
          const pass = r.postUpdateChecks.filter(
            (c) => c.status === "passed",
          ).length;
          const fail = r.postUpdateChecks.filter(
            (c) => c.status === "failed",
          ).length;
          const degr = r.postUpdateChecks.filter(
            (c) => c.status === "degraded",
          ).length;
          console.log(
            `Post-update checks: ${pass} passed, ${fail} failed, ${degr} degraded`,
          );
          for (const c of r.postUpdateChecks) {
            const tag = c.status.toUpperCase().padEnd(8);
            console.log(`  ${tag} ${c.check}`);
            if (c.reason) console.log(`           ${c.reason}`);
          }
        }
        if (r.transactionDir) {
          console.log(
            `Transaction: ${r.transactionDir} (rollback instructions inside)`,
          );
        }
      }
      printHumanReport("warp:update", {
        verdict:
          r.report.classCounts.C > 0
            ? "Needs human decision"
            : isApply
              ? r.ok
                ? "Update applied"
                : "Update applied with failures"
              : "Dry-run plan ready",
        whatChanged: isApply
          ? `${r.report.fromVersion} → ${r.report.toVersion}; ${ac.added + ac.updated + ac.deleted} files written/removed; ${r.migrations?.ran || 0} migration(s) ran`
          : `${r.report.fromVersion} -> ${r.report.toVersion}; ${Object.keys(r.report.counts).length} categories classified`,
        why: "Classifies local framework assets against the target release capsule, runs migrations + post-update checks, writes transaction record.",
        risksRemaining:
          r.report.classCounts.C > 0
            ? `${r.report.classCounts.C} Class C item(s)`
            : isApply
              ? !r.ok
                ? "One or more migration/post-check failed — see details."
                : ac.deletes_skipped > 0
                  ? `${ac.deletes_skipped} delete(s) deferred — re-run with --confirm-deletes.`
                  : "None — verify with /warp:doctor."
              : "Run --apply to execute the plan.",
        whatWasRejected:
          r.mode === "dry-run"
            ? "No files were changed."
            : isApply
              ? ac.errors > 0
                ? `${ac.errors} write(s) failed — see error list.`
                : ac.merge_conflicts_held > 0
                  ? `${ac.merge_conflicts_held} merge-conflict(s) preserved (Class C).`
                  : "Class C items (none surfaced)."
              : "Apply path refused.",
        whatWasTested: `${r.migrations?.ran || 0}/${r.report.migrations.length} migration(s) ran, ${r.postUpdateChecks?.length || 0} post-update check(s) executed`,
        needsHumanDecision:
          r.report.classCounts.C > 0
            ? "Resolve Class C items before apply."
            : isApply
              ? r.ok
                ? "Run /warp:doctor to verify the install is healthy."
                : "Inspect transaction record + ROLLBACK.md to recover."
              : "None for dry-run.",
        recommendedNextAction: isApply
          ? r.ok
            ? "node scripts/warpos/release-gates.js (or /warp:doctor)"
            : `Inspect ${r.transactionDir}/ and consider rollback.`
          : "Review the plan; pass --apply to execute, or /warp:doctor to verify pre-flight.",
      });
    })
    .catch((e) => {
      console.error(`update: ${e.message}`);
      process.exit(2);
    });
}

module.exports = { run, classify, planClass, findRepoRootFromCapsule };
