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
const { spawnSync } = require("child_process");
const { printHumanReport } = require("./report-format");
const migrationsLoader = require("./migrations-loader");
// SP-20260513-005 tri-pillar — wired into run() at T-20260513-062.
// Preflight refuses to apply when any of 10 gates blocks; transaction wraps
// the apply + migrations in a snapshot/lock/rollback envelope; postflight
// runs 5 diagnostic checks (incl. provider-smoke via registerExternalCheck).
const preflightModule = require("./preflight");
const transactionModule = require("./transaction");
const postflightModule = require("./postflight");
// SP-20260514-001 R-1 — single content-hash surface. contentHash() is
// LF-normalized for text assets (extension allowlist) and raw for binary;
// rawHash() is unconditional raw; hashMatches() is prefix-tolerant for
// 0.6.x truncated-sha256 capsule back-compat. Closes the CRLF false-positive
// bug class at the source. T-20260514-068 owns the module.
const cHash = require("./lib/content-hash");
// SP-20260514-001 R-5 / T-20260514-076 — new event kinds wired into the
// classifier (content-hash-mismatch lf_only/real_drift, ownership-
// transitioned).
const updateEvents = require("./lib/update-events");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function sha256File(filePath) {
  // contentHash returns the LF-normalized sha256 for text assets and raw
  // sha256 for binary. Path-based call infers text/binary from extension.
  if (!fs.existsSync(filePath)) return null;
  return cHash.contentHash(filePath);
}

// LF normalization is now intrinsic to contentHash for text assets; this
// shim stays for backward-compat with existing callsites and explicit
// "force text-mode" intent at the classifier boundary.
function sha256FileLfNormalized(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return cHash.contentHash(filePath, { text: true });
}

// True iff `hashLong` (full or any length) starts with `hashShort`.
// Tolerates the 0.6.x capsule's 12-char truncation in
// framework-manifest.json#assets[].sha256 during the un-truncation transition.
const hashMatches = cHash.hashMatches;

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

// 0.4.1: when sourceRoot doesn't have the target capsule, try to discover
// a canonical WarpOS clone via the same walk release-canonical.js uses:
// sibling ../WarpOS, sibling ../warpos, manifest.json#warpos.source.
// Returns an absolute path to the canonical, or null if nothing usable.
function discoverCanonical(targetRoot, version) {
  const tries = [];
  tries.push(path.resolve(targetRoot, "..", "WarpOS"));
  tries.push(path.resolve(targetRoot, "..", "warpos"));
  try {
    const manifestPath = path.join(targetRoot, ".claude", "manifest.json");
    if (fs.existsSync(manifestPath)) {
      const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const src = m && m.warpos && m.warpos.source;
      if (src && !/^https?:\/\//.test(src)) tries.push(path.resolve(src));
    }
  } catch {
    /* manifest optional */
  }
  // Also try the framework-installed.json's recorded source path.
  try {
    const fi = path.join(targetRoot, ".claude", "framework-installed.json");
    if (fs.existsSync(fi)) {
      const j = JSON.parse(fs.readFileSync(fi, "utf8"));
      if (j && j.source && !/^https?:\/\//.test(j.source)) {
        tries.push(path.resolve(j.source));
      }
    }
  } catch {
    /* optional */
  }
  for (const candidate of tries) {
    if (!fs.existsSync(candidate)) continue;
    if (!fs.existsSync(path.join(candidate, "version.json"))) continue;
    if (!fs.existsSync(path.join(candidate, "framework"))) continue;
    const capsule = path.join(
      candidate,
      "framework",
      "releases",
      version,
      "release.json",
    );
    if (fs.existsSync(capsule)) return candidate;
  }
  return null;
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

    // SP-20260514-001 R-3 / T-20260514-073 — framework_template ownership
    // transition. Decision-ledger 2026-05-14 (Alpha-resolved Class C per
    // no-pause directive, Beta-recommended): automatic on any non-whitespace
    // edit. contentHash is already LF-normalized for text, so a mismatch
    // here means a real edit (not just CRLF↔LF).
    if (asset.owner === "framework_template" && localExists) {
      const matches = hashMatches(localSha, targetSha);
      if (!matches) {
        updateEvents.emitOwnershipTransitioned(root, {
          txId: null,
          file: dest,
          from: "framework_template",
          to: "project_owned",
          reason: "consumer_edit_detected",
        });
        category = "LOCAL_CUSTOMIZED";
        reason =
          "owner=framework_template promoted to project_owned (consumer non-whitespace edit detected); leave as-is.";
        decisions.push({
          id: asset.id,
          dest,
          kind: asset.kind,
          owner: "project_owned",
          previousOwner: "framework_template",
          category,
          reason,
        });
        continue;
      }
      // No consumer edits — treat as a regular framework asset; falls through.
    }

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
    } else if (hashMatches(localSha, targetSha)) {
      // targetSha from capsule manifest is intentionally truncated to 12 chars
      // by generate-framework-manifest.js; localSha is full 64. Prefix match.
      category = "UPDATE_SAFE";
      reason = "Already at target version (sha matches).";
    } else if (
      targetSha &&
      hashMatches(sha256FileLfNormalized(localPath), targetSha)
    ) {
      // Windows autocrlf=true smudges working tree CRLF after the capsule
      // manifest was hashed against LF. Text-file content is equivalent;
      // classify as UPDATE_SAFE and let apply rewrite from canonical source.
      category = "UPDATE_SAFE";
      reason =
        "Already at target version (sha matches under LF normalization).";
      // T-076: surface LF-only mismatches as diagnostic events. Should be
      // rare with content-hash already LF-normalizing — if it stays non-zero,
      // some caller is bypassing the central hash module.
      updateEvents.emitContentHashMismatch(root, {
        txId: null,
        file: dest,
        contentHashLocal: localSha,
        rawHashLocal: cHash.rawHash(localPath),
        expectedHash: targetSha,
        kind: "lf_only",
      });
    } else if (
      installedRecord &&
      hashMatches(localSha, installedRecord.installedHash)
    ) {
      // installedHash may be truncated 12-char (if propagated from a.sha256
      // by older apply runs) or full 64-char (if computed locally). Prefix
      // match handles both.
      category = "UPDATE_SAFE";
      reason =
        "Local matches the version originally installed → upstream change is safe to apply.";
    } else if (
      installedRecord &&
      installedRecord.installedHash &&
      hashMatches(
        sha256FileLfNormalized(localPath),
        installedRecord.installedHash,
      )
    ) {
      // Same LF/CRLF tolerance applied to the installed-snapshot branch.
      category = "UPDATE_SAFE";
      reason =
        "Local matches installed snapshot under LF normalization → upstream change is safe to apply.";
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
        // T-076: real drift means the local content genuinely diverges from
        // the capsule (not an LF artifact). Worth a dedicated event so we
        // can count how many MERGE_CONFLICTs are real vs noise.
        if (targetSha) {
          updateEvents.emitContentHashMismatch(root, {
            txId: null,
            file: dest,
            contentHashLocal: localSha,
            rawHashLocal: localExists ? cHash.rawHash(localPath) : null,
            expectedHash: targetSha,
            kind: "real_drift",
          });
        }
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
      } else if (
        rec.installedHash &&
        localSha &&
        !cHash.hashMatches(localSha, rec.installedHash)
      ) {
        // SP-20260514-001 R-3 / T-20260514-073 — files that were
        // framework_template are now project_owned once edited; if the
        // framework restructure drops the template path, the consumer
        // edit must SURVIVE. DELETE_SAFE, not DELETE_CONFLICT.
        if (
          rec.owner === "framework_template" ||
          rec.owner === "project_owned"
        ) {
          category = "DELETE_SAFE";
          reason =
            "Removed in target version; local was project_owned (or transitioned from framework_template) — preserve in place, do not delete.";
        } else {
          category = "DELETE_CONFLICT";
          reason =
            "Removed in target but local differs from installed snapshot — preserve.";
        }
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
//
// The old stub (writeTransactionPlan + backupFile + newTransactionId) was
// replaced at T-20260513-062 by scripts/warpos/transaction.js, which owns
// header/plan/snapshot/capsule writes, pre-state sha256 + backup capture,
// the active.lock guard (R-32), atomic snapshot hashing (R-31), the fast
// preflight subset re-run (R-33), and rollback. The legacy backupFile()
// helper used during apply is preserved below since applyUpdateDecisions
// captures per-file backups during the apply loop (in addition to the
// pre-apply snapshot taken by beginTransaction).

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
        // T-20260514-071: always persist the locally-computed full 64-char
        // sha256. With T-070 in effect, capsule a.sha256 is also 64-char on
        // 0.7.0+; fallback to a.sha256 only when local file is genuinely
        // missing (best-effort). Back-compat read remains via hashMatches.
        installedHash: localHash || a.sha256,
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
  let sourceRoot = opts.source ? path.resolve(opts.source) : REPO_ROOT;
  const targetRoot = opts.target ? path.resolve(opts.target) : REPO_ROOT;

  // 0.4.1: if --source wasn't passed AND the target capsule isn't in the
  // local REPO_ROOT, walk sibling clones / manifest hint to find a canonical
  // that has it. This makes `/warp:update --to <v>` work in product repos
  // that have a sibling WarpOS clone without forcing the user to remember
  // --source. Honours --no-discover to disable.
  if (!opts.source && target && !opts.noDiscover) {
    const haveLocal = fs.existsSync(
      path.join(sourceRoot, "framework", "releases", target, "release.json"),
    );
    if (!haveLocal) {
      const discovered = discoverCanonical(targetRoot, target);
      if (discovered) {
        process.stderr.write(
          `[update] capsule ${target} not in local framework/releases/ — using canonical at ${discovered}\n`,
        );
        sourceRoot = discovered;
      }
    }
  }

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

  // ── SP-005 Preflight (T-20260513-062) ───────────────────
  //
  // Run 10 gates BEFORE any file touches. Red on any gate (after override
  // consideration) refuses apply. Yellow with matching override accepted is
  // re-interpreted as green but logs overrideUsed=true. Skipped only with
  // --force-fresh which is its own gate-1 override.
  let preflightReport = null;
  if (!opts.skipPreflight) {
    preflightReport = preflightModule.runPreflight({
      targetRoot,
      sourceTreeRoot,
      toVersion: target,
      sourceRoot,
      allowStale: !!opts.allowStale,
      forceFresh: !!opts.forceFresh,
      allowVersionDrift: !!opts.allowVersionDrift,
      allRed: false,
    });
    if (!preflightReport.ok) {
      const firstRed = preflightReport.gates.find((g) => g.status === "red");
      const remediation =
        firstRed && firstRed.remediation
          ? `\n  Remediation:\n  ${firstRed.remediation.split("\n").join("\n  ")}`
          : "";
      return {
        ok: false,
        mode: "apply",
        error: `PREFLIGHT BLOCKED: ${preflightReport.redCount} red gate(s). First red: ${firstRed ? firstRed.name : "<unknown>"} — ${firstRed ? firstRed.reason : ""}${remediation}`,
        report,
        preflight: preflightReport,
      };
    }
  }

  // ── SP-005 Transaction begin (T-20260513-062) ───────────
  //
  // beginTransaction writes header/plan/snapshot/capsule, copies pre-apply
  // backups, takes active.lock (R-32), re-runs fast preflight subset (R-33),
  // hashes the snapshot (R-31). --no-transaction skips the wrapper for
  // legacy compatibility but DOES still write a minimal txDir for the
  // existing report/result.json contract.
  let txId, txDir;
  if (opts.noTransaction) {
    // Legacy path: synthesize a txId + dir without the snapshot envelope.
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    txId = `${ts}-warp-update-${path.basename(targetRoot)}-notx`;
    txDir = path.join(targetRoot, ".warpos", "transactions", txId);
    fs.mkdirSync(txDir, { recursive: true });
    fs.writeFileSync(
      path.join(txDir, "header.json"),
      JSON.stringify(
        {
          kind: "warp:update",
          txId,
          fromVersion,
          toVersion: target,
          sourceRoot,
          targetRoot,
          sourceTreeRoot,
          startedAt: new Date().toISOString(),
          noTransaction: true,
        },
        null,
        2,
      ) + "\n",
    );
    fs.writeFileSync(
      path.join(txDir, "plan.json"),
      JSON.stringify(decisions, null, 2) + "\n",
    );
    fs.writeFileSync(
      path.join(txDir, "capsule.json"),
      JSON.stringify({ dir: capsule.dir, release: capsule.release }, null, 2) +
        "\n",
    );
  } else {
    try {
      const txBegin = transactionModule.beginTransaction({
        targetRoot,
        sourceTreeRoot,
        fromVersion,
        toVersion: target,
        sourceRoot,
        decisions,
        capsule,
        allowStale: !!opts.allowStale,
        forceFresh: !!opts.forceFresh,
        allowVersionDrift: !!opts.allowVersionDrift,
        // R-33 fast-preflight already implicitly covered by the outer
        // preflight pass above; skip if operator explicitly opted out of
        // preflight too.
        skipFastPreflight: !!opts.skipPreflight,
      });
      txId = txBegin.txId;
      txDir = txBegin.txDir;
    } catch (e) {
      return {
        ok: false,
        mode: "apply",
        error: `TRANSACTION BEGIN FAILED (${e.code || "unknown"}): ${e.message}`,
        report,
        preflight: preflightReport,
      };
    }
  }

  // ── Apply + migrations, wrapped in try/catch for rollback ─
  const applyStartedAt = Date.now();
  let applyResult;
  let migrationsResult;
  try {
    applyResult = applyUpdateDecisions(
      sourceTreeRoot,
      targetRoot,
      decisions,
      capsule.manifest,
      txDir,
      {
        confirmDeletes: !!opts.confirmDeletes,
      },
    );
    if (!applyResult.ok) {
      const firstErr = (applyResult.errors && applyResult.errors[0]) || {
        dest: "<unknown>",
        error: "apply reported errors but no detail",
      };
      throw new Error(
        `apply phase failed at ${firstErr.dest}: ${firstErr.error}`,
      );
    }

    // Run migrations as part of the wrapped phase — a failed migration must
    // also roll back the file copies.
    migrationsResult = await runMigrations(fromVersion, target, targetRoot);
    if (migrationsResult.status === "failed") {
      throw new Error(
        `migration phase failed: ${migrationsResult.failed} migration(s) failed during ${fromVersion}->${target}`,
      );
    }
  } catch (err) {
    // ── Rollback ──
    if (!opts.noTransaction) {
      try {
        transactionModule.rollbackTransaction(txDir, {
          trigger: applyResult && !applyResult.ok ? "apply" : "migration",
          failedAt:
            (applyResult &&
              applyResult.errors &&
              applyResult.errors[0] &&
              applyResult.errors[0].dest) ||
            null,
          errorMessage: err.message,
        });
      } catch (rbErr) {
        // Rollback itself failed — surface both errors.
        return {
          ok: false,
          mode: "apply",
          error: `APPLY FAILED + ROLLBACK FAILED: ${err.message} | rollback: ${rbErr.message}`,
          report,
          preflight: preflightReport,
          transaction: txId,
          transactionDir: path.relative(targetRoot, txDir).replace(/\\/g, "/"),
        };
      }
    }
    return {
      ok: false,
      mode: "apply",
      error: `APPLY ROLLED BACK: ${err.message}`,
      report,
      preflight: preflightReport,
      apply: applyResult,
      migrations: migrationsResult,
      transaction: txId,
      transactionDir: path.relative(targetRoot, txDir).replace(/\\/g, "/"),
    };
  }
  const applyDurationMs = Date.now() - applyStartedAt;

  // Run per-capsule post-update checks (release.json#postUpdateChecks).
  // These coexist with SP-005 postflight: capsule-declared checks fire
  // first, then the framework-side postflight composer below.
  const postUpdateResults = runPostUpdateChecks(
    capsule.release.postUpdateChecks || [],
    targetRoot,
  );

  // Write updated installed snapshot before commit so the manifest is
  // visible to postflight (manifest-honesty would otherwise see stale state).
  const newInstalled = buildInstalledSnapshot(
    target,
    capsule,
    applyResult,
    installed,
    targetRoot,
  );
  fs.writeFileSync(installedFile, JSON.stringify(newInstalled, null, 2) + "\n");

  // ── SP-005 Transaction commit (T-20260513-062) ──────────
  if (!opts.noTransaction) {
    transactionModule.commitTransaction(txDir, {
      apply: applyResult,
      migrations: migrationsResult,
      postUpdateChecks: postUpdateResults,
      applyDurationMs,
    });
  } else {
    // Legacy path: write our own result.json so downstream consumers still
    // see a finalized record.
    fs.writeFileSync(
      path.join(txDir, "result.json"),
      JSON.stringify(
        {
          completedAt: new Date().toISOString(),
          outcome: "committed-no-transaction",
          apply: applyResult,
          migrations: migrationsResult,
          postUpdateChecks: postUpdateResults,
          rollback: null,
        },
        null,
        2,
      ) + "\n",
    );
  }

  // Always write the human-facing ROLLBACK.md (transaction.js doesn't, by
  // design — it owns the JSON envelope, this stays as the prose copy).
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
      "Preferred automated path:",
      "",
      `    node scripts/warpos/update.js --rollback ${txId}`,
      "",
      "Manual restore of a single file:",
      "",
      "    cp <transaction>/backup/<rel-path> <rel-path>",
      "",
      "Manual restore of everything:",
      "",
      "    cp -r <transaction>/backup/* .",
      "",
      "Then check `git status` and reset framework-installed.json from the prior snapshot.",
      "",
    ].join("\n"),
  );

  // ── SP-005 Postflight (T-20260513-062) ──────────────────
  //
  // Runs 5 composed checks: manifest-honesty, path-resolution,
  // applied-migrations, provider-smoke (external), /warp:health rollup.
  // Diagnostic — does NOT roll back. Operator action surfaces in the
  // returned report. Honour --skip-postflight + --strict-postflight.
  let postflightReport = null;
  if (!opts.skipPostflight) {
    try {
      postflightReport = postflightModule.runPostflight({
        targetRoot,
        txId,
        txDir,
        capsule: { release: capsule.release },
        strict: !!opts.strictPostflight,
      });
    } catch (pfErr) {
      // Postflight should never throw — but if it does, capture it and
      // continue rather than masking a successful commit.
      postflightReport = {
        ok: false,
        checkCount: 0,
        redCount: 0,
        yellowCount: 0,
        greenCount: 0,
        degradedCount: 1,
        checks: [],
        evidencePath: null,
        operatorAction: "review-then-decide",
        error: pfErr.message,
      };
    }
  }

  // Strict postflight: a red in postflight makes the overall update fail
  // even though apply + commit succeeded. Operator opt-in only.
  const strictBlock =
    !!opts.strictPostflight &&
    postflightReport &&
    postflightReport.redCount > 0;

  // Update overall ok with migration + post-check results
  const allOk =
    applyResult.ok &&
    migrationsResult.status !== "failed" &&
    !postUpdateResults.some((c) => c.status === "failed") &&
    !strictBlock;

  return {
    ok: allOk,
    mode: "apply",
    report,
    preflight: preflightReport,
    apply: applyResult,
    migrations: migrationsResult,
    postUpdateChecks: postUpdateResults,
    postflight: postflightReport,
    transaction: txId,
    transactionDir: path.relative(targetRoot, txDir).replace(/\\/g, "/"),
  };
}

// ── Manual rollback CLI handler ──────────────────────────────────
//
// Companion to the auto-rollback inside run() (which fires on any apply or
// migration error). The operator surface exists because:
//   - ROLLBACK.md inside every txDir already advertises this command.
//   - Postflight red with --strict-postflight surfaces the txId but doesn't
//     auto-rollback (postflight is diagnostic by contract).
//
// Usage:
//   node scripts/warpos/update.js --rollback <txId>
//   node scripts/warpos/update.js --rollback=<txId>
//   node scripts/warpos/update.js --rollback <txId> --target <install-path>
//   node scripts/warpos/update.js --rollback <txId> --json
//
// Exit codes:
//   0  — full rollback (no partial, no error)
//   1  — partial rollback (some entries restored, some failed)
//   4  — txDir not found / invalid txId
//   5  — rollback threw (e.g. snapshot hash mismatch — R-31)
function runRollbackCli(txId, opts) {
  // paths.warposTransactionsDir = .warpos/transactions (relative to target).
  const targetRoot = opts.target ? path.resolve(opts.target) : REPO_ROOT;
  const txDir = path.join(targetRoot, ".warpos", "transactions", txId);
  if (!fs.existsSync(txDir)) {
    const msg = `rollback: transaction directory not found at ${txDir}\n  txId: ${txId}\n  target: ${targetRoot}\n  hint: list available transactions with: ls ${path.join(targetRoot, ".warpos", "transactions")}`;
    if (opts.json) {
      console.log(
        JSON.stringify(
          { ok: false, mode: "rollback", error: msg, txId, txDir },
          null,
          2,
        ),
      );
    } else {
      console.error(msg);
    }
    process.exit(4);
  }
  const headerFile = path.join(txDir, "header.json");
  if (!fs.existsSync(headerFile)) {
    const msg = `rollback: header.json missing in ${txDir} — transaction directory is corrupt or unrelated to /warp:update`;
    if (opts.json) {
      console.log(
        JSON.stringify(
          { ok: false, mode: "rollback", error: msg, txId, txDir },
          null,
          2,
        ),
      );
    } else {
      console.error(msg);
    }
    process.exit(4);
  }
  let header;
  try {
    header = JSON.parse(fs.readFileSync(headerFile, "utf8"));
  } catch (e) {
    const msg = `rollback: failed to parse header.json: ${e.message}`;
    if (opts.json) {
      console.log(
        JSON.stringify(
          { ok: false, mode: "rollback", error: msg, txId, txDir },
          null,
          2,
        ),
      );
    } else {
      console.error(msg);
    }
    process.exit(4);
  }
  // Refuse to rollback a txDir that was created with --no-transaction (it has
  // no snapshot envelope; rollbackTransaction would fail with a worse error).
  if (header.noTransaction) {
    const msg = `rollback: transaction ${txId} was created with --no-transaction (no snapshot envelope to roll back). Restore manually from ${path.relative(targetRoot, txDir).replace(/\\/g, "/")}/backup/`;
    if (opts.json) {
      console.log(
        JSON.stringify(
          { ok: false, mode: "rollback", error: msg, txId, txDir, header },
          null,
          2,
        ),
      );
    } else {
      console.error(msg);
    }
    process.exit(4);
  }
  let result;
  try {
    result = transactionModule.rollbackTransaction(txDir, {
      trigger: "operator",
      reason: "manual-cli-rollback",
      operator:
        process.env.USER ||
        process.env.USERNAME ||
        process.env.LOGNAME ||
        "unknown",
      errorMessage: `Manual CLI rollback by operator (${process.env.USER || process.env.USERNAME || "unknown"})`,
    });
  } catch (e) {
    const msg = `rollback: rollbackTransaction threw: ${e.message}`;
    if (opts.json) {
      console.log(
        JSON.stringify(
          { ok: false, mode: "rollback", error: msg, txId, txDir, header },
          null,
          2,
        ),
      );
    } else {
      console.error(msg);
    }
    process.exit(5);
  }
  const fullSuccess = !result.partial && !result.error;
  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          ok: fullSuccess,
          mode: "rollback",
          txId,
          txDir,
          fromVersion: header.fromVersion,
          toVersion: header.toVersion,
          restoredCount: result.restoredCount,
          unlinkedCount: result.unlinkedCount,
          partial: result.partial,
          error: result.error || null,
        },
        null,
        2,
      ),
    );
  } else {
    const status = fullSuccess ? "OK" : result.partial ? "PARTIAL" : "ERROR";
    console.log(
      `[${status}] rollback ${txId}: restored=${result.restoredCount} unlinked=${result.unlinkedCount} partial=${result.partial}`,
    );
    console.log(`  txDir:        ${txDir}`);
    console.log(
      `  fromVersion:  ${header.fromVersion} (would have been ${header.toVersion})`,
    );
    if (result.error) console.log(`  error:        ${result.error}`);
    if (!fullSuccess) {
      console.log(
        `  inspect:      ${path.join(txDir, "diagnostics.log")} and ${path.join(txDir, "result.json")}`,
      );
    }
  }
  process.exit(fullSuccess ? 0 : 1);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    if (i === -1) return null;
    return args[i + 1];
  };
  // Support both --rollback <txId> (positional) and --rollback=<txId>.
  const getEqOrPositional = (flag) => {
    for (let i = 0; i < args.length; i++) {
      if (args[i].startsWith(`${flag}=`)) return args[i].slice(flag.length + 1);
      if (args[i] === flag) return args[i + 1] || null;
    }
    return null;
  };
  // ── Early branch: --rollback <txId> ──
  // Runs the manual rollback handler, never falls through to the normal
  // update flow. Honours --target and --json; ignores --to/--apply/etc.
  const rollbackArg = getEqOrPositional("--rollback");
  if (rollbackArg !== null) {
    if (!rollbackArg || rollbackArg.startsWith("--")) {
      console.error(
        "Usage: node scripts/warpos/update.js --rollback <txId> [--target <install-path>] [--json]\n  txId is the directory name under <target>/.warpos/transactions/.",
      );
      process.exit(2);
    }
    runRollbackCli(rollbackArg, {
      target: get("--target"),
      json: args.includes("--json"),
    });
    return; // unreachable — runRollbackCli always exits — but keeps lint honest.
  }
  const opts = {
    to: get("--to"),
    apply: args.includes("--apply"),
    dryRun: args.includes("--dry-run"),
    json: args.includes("--json"),
    confirmDeletes: args.includes("--confirm-deletes"),
    source: get("--source"),
    noDiscover: args.includes("--no-discover"),
    target: get("--target"),
    // Legacy: --source-root pointed at the source tree directly. Kept for
    // back-compat. Prefer --source.
    sourceRoot: get("--source-root"),
    // SP-005 tri-pillar flags (T-20260513-062):
    // --force-fresh           Preflight: accept yellow on install-baseline (treat as fresh install)
    // --allow-stale           Preflight: accept yellow on staleness
    // --allow-version-drift   Preflight: accept yellow on version-quorum
    // --skip-preflight        Bypass the preflight composer entirely (NOT recommended)
    // --no-transaction        Skip the transaction wrapper (legacy compatibility)
    // --skip-postflight       Skip the postflight composer (suppresses 5 diagnostic checks)
    // --strict-postflight     Treat any postflight red as a non-zero exit
    forceFresh: args.includes("--force-fresh"),
    allowStale: args.includes("--allow-stale"),
    allowVersionDrift: args.includes("--allow-version-drift"),
    skipPreflight: args.includes("--skip-preflight"),
    noTransaction: args.includes("--no-transaction"),
    skipPostflight: args.includes("--skip-postflight"),
    strictPostflight: args.includes("--strict-postflight"),
  };
  if (!opts.to) {
    console.error(
      "Usage: node scripts/warpos/update.js --to <version> [--source <warpos-repo>] [--target <install-path>] [--dry-run | --apply] [--confirm-deletes] [--force-fresh] [--allow-stale] [--allow-version-drift] [--no-transaction] [--skip-postflight] [--strict-postflight]\n       node scripts/warpos/update.js --rollback <txId> [--target <install-path>] [--json]",
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
        // SP-005 preflight summary
        if (r.preflight) {
          console.log(
            `Preflight: ${r.preflight.greenCount}/${r.preflight.gateCount} GREEN, ${r.preflight.redCount} RED, ${r.preflight.yellowCount} YELLOW, ${r.preflight.degradedCount} DEGRADED`,
          );
        }
        // SP-005 postflight summary
        if (r.postflight) {
          console.log(
            `Postflight: ${r.postflight.greenCount}/${r.postflight.checkCount} GREEN, ${r.postflight.redCount} RED, ${r.postflight.yellowCount} YELLOW, ${r.postflight.degradedCount} DEGRADED (operatorAction=${r.postflight.operatorAction})`,
          );
          if (r.postflight.evidencePath) {
            console.log(
              `  evidence: ${path.relative(r.report.targetRoot, r.postflight.evidencePath).replace(/\\/g, "/")}`,
            );
          }
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

module.exports = {
  run,
  classify,
  planClass,
  findRepoRootFromCapsule,
  discoverCanonical,
  loadCapsule,
};
