#!/usr/bin/env node

/**
 * generate-framework-manifest.js — build .claude/framework-manifest.json
 *
 * Walks the WarpOS source tree, classifies every shippable asset by kind,
 * and writes a single declarative manifest at .claude/framework-manifest.json.
 *
 * The installer (warp-setup.js) consumes this manifest instead of hand-coded
 * copyDir calls. Missing assets become impossible because every dir is
 * enumerated — if a file isn't in the manifest, the installer doesn't see it.
 *
 * Usage:
 *   node scripts/generate-framework-manifest.js
 *
 * Run this:
 *   - After adding/removing/renaming any .claude/, scripts/, requirements/,
 *     patterns/ asset
 *   - Before every WarpOS commit that touches assets (enforced by the
 *     framework-manifest-guard hook at commit time)
 *
 * Not auto-run via hook because:
 *   - PostToolUse rewriting a committed file on every edit is noisy
 *   - Mid-session manifest bouncing during rapid edits is worse than the
 *     deterministic "run before commit" model
 *   - β DECIDE 2026-04-18 (0.91): "Guards that block, not guards that mutate"
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, ".claude", "framework-manifest.json");

// Phase 1C — manifest schema v2.
// Each asset gains:
//   id              stable identity for diffing across renames: <kind>.<scope>.<name>
//   sha256          12-char content hash (drift detection in /warp:update)
//   mergeStrategy   how /warp:update reconciles upstream changes for this asset
//   owner           framework | generated | runtime | project (lifecycle policy)
//   introducedIn    semver where it first shipped (read from version.json or "0.0.0")
//   removedIn       null while alive
//   replaces        previous id if this entry was renamed
const MANIFEST_SCHEMA_VERSION = "warpos/framework-manifest/v2";

// EXCLUDE_GLOBS — tree paths the generator must skip when walking ASSET_DIRS.
// Phase 1C bug fix: dispatch-backups was being included, blowing up the asset
// list with stale snapshots. Run-level retros are also runtime-only.
// Phase 4J (2026-04-30): broadened to cover every per-project runtime
// surface so /warp:promote sees a clean framework-only manifest.
const EXCLUDE_RELATIVE_PREFIXES = [
  // Existing exclusions
  ".claude/agents/.system/dispatch-backups/",
  ".claude/agents/02-oneshot/.system/retros/",
  ".claude/agents/02-oneshot/.system/store.json", // per-project state
  ".claude/agents/02-oneshot/.system/store.json.prev-run-backup.json",
  // Phase 4J — runtime + per-session + per-project event/memory state
  ".claude/runtime/",
  ".claude/project/events/",
  ".claude/project/memory/",
  ".claude/runtime/dispatch/",
  ".claude/runtime/handoffs/",
  ".claude/runtime/notes/",
  ".claude/runtime/logs/",
  ".claude/.agent-result-hashes.json",
  ".claude/.last-checkpoint",
  ".claude/.session-checkpoint.json",
  ".claude/scheduled_tasks.lock",
  ".claude/agents/store.json", // alpha heartbeat marker — per-project
  ".claude/.session_index.json",
];

function isExcluded(relPath) {
  // Release capsules ship their metadata, notes, and migrations. The manifest
  // snapshot and checksums inside each capsule are generated from this manifest,
  // so including them would make `manifest -> capsule -> manifest` unstable.
  if (/^warpos\/releases\/[^/]+\/(framework-manifest|checksums)\.json$/.test(relPath)) {
    return true;
  }
  return EXCLUDE_RELATIVE_PREFIXES.some(
    (p) => relPath === p || relPath.startsWith(p),
  );
}

// Default mergeStrategy by kind. Per-asset overrides may be added later.
const DEFAULT_MERGE_STRATEGY = {
  agent: "three_way_markdown",
  skill: "three_way_markdown",
  reference: "three_way_markdown",
  maps_baseline: "regenerate",
  hook: "replace_if_unmodified",
  hook_lib: "replace_if_unmodified",
  tool: "replace_if_unmodified",
  top_script: "replace_if_unmodified",
  requirement: "keep_local",
  pattern: "three_way_markdown",
  framework_doc: "three_way_markdown",
};

const DEFAULT_OWNER_BY_KIND = {
  agent: "framework",
  skill: "framework",
  reference: "framework",
  maps_baseline: "generated",
  hook: "framework",
  hook_lib: "framework",
  tool: "framework",
  top_script: "framework",
  requirement: "project",
  pattern: "framework",
  framework_doc: "framework",
};

function sha256OfFile(absPath) {
  const buf = fs.readFileSync(absPath);
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12);
}

// Stable id: <kind>.<scope>.<name>. Scope is the relative path with the kind's
// root stripped and slashes flattened to dots. Extension is preserved when it
// disambiguates (e.g. .md vs .jsonl maps share the same stem under
// .claude/project/maps/) — without it, ids collide across kinds with parallel
// formats.
function idForAsset(kind, srcRel, srcRoot) {
  const stripped = srcRel.replace(srcRoot + "/", "");
  const scope = stripped.replace(/\//g, ".");
  return `${kind}.${scope}`;
}

// ── What counts as a shippable asset ────────────────────
// Directories the manifest enumerates, and the kind label for each.
const ASSET_DIRS = [
  { src: ".claude/agents", kind: "agent" },
  { src: ".claude/commands", kind: "skill" },
  { src: ".claude/project/reference", kind: "reference" },
  { src: ".claude/project/maps", kind: "maps_baseline" },
  { src: "scripts/hooks", kind: "hook" }, // refined to hook_lib by path below
  { src: "scripts/tools", kind: "tool" },
  { src: "requirements", kind: "requirement" },
  { src: "patterns", kind: "pattern" },
  { src: "fixtures/hooks", kind: "fixture" },
  { src: "fixtures/install-empty-next-app", kind: "fixture" },
  { src: "fixtures/update-from-0.0.0-clean", kind: "fixture" },
  { src: "fixtures/update-from-0.0.0-customized-claude-md", kind: "fixture" },
  // Phase 4 codex review fix-forward (2026-04-30): the engines + capsules +
  // schemas + migrations Phase 4 introduced were NOT shipped by the installer.
  // /warp:update couldn't materialize them because they weren't in the
  // manifest. Now they are.
  { src: "scripts/warpos", kind: "warpos_script" },
  { src: "scripts/checks", kind: "check_tool" },
  { src: "scripts/agents", kind: "agent_tool" },
  { src: "scripts/decisions", kind: "decision_tool" },
  { src: "scripts/runtime", kind: "runtime_tool" },
  { src: "scripts/memory", kind: "memory_tool" },
  { src: "scripts/security", kind: "security_tool" },
  { src: "scripts/deps", kind: "dependency_tool" },
  { src: "scripts/timeline", kind: "timeline_tool" },
  { src: "scripts/budgets", kind: "budget_tool" },
  { src: "scripts/self-mod", kind: "self_mod_tool" },
  { src: "scripts/preflight", kind: "preflight_tool" },
  { src: "scripts/requirements", kind: "requirements_engine" },
  { src: "scripts/paths", kind: "paths_engine" },
  { src: "schemas", kind: "schema" },
  { src: "migrations", kind: "migration" },
  { src: "warpos/releases", kind: "release_capsule" },
  { src: "warpos/paths.registry.json", kind: "paths_registry" },
];

// Top-level scripts (peers of scripts/hooks/, scripts/tools/).
const TOP_LEVEL_SCRIPTS = [
  { src: "scripts/path-lint.js", kind: "top_script" },
  { src: "scripts/dispatch-agent.js", kind: "top_script" },
  { src: "scripts/generate-maps.js", kind: "top_script" },
  { src: "scripts/generate-framework-manifest.js", kind: "top_script" },
  // warp-setup.js is NOT shipped to target projects — it's the installer itself.
  //   Clients invoke it from ../WarpOS/, not from their own scripts/.
];

// Root-level Phase 4 artifacts that ship as single files (not dirs).
const TOP_LEVEL_FRAMEWORK_FILES = [
  { src: "version.json", kind: "version_file" },
  { src: "install.ps1", kind: "installer_script" },
  { src: ".github/workflows/test.yml", kind: "ci_workflow" },
];

// Root-level docs installed into the target project root (not into .claude/).
const FRAMEWORK_DOCS = [
  { src: "CLAUDE.md", dest: "CLAUDE.md", merge: "append-if-exists" },
  { src: "AGENTS.md", dest: "AGENTS.md", merge: "append-if-exists" },
];

// Files the installer GENERATES at install time (not copied from source).
// Each entry lists the output path + the name of the code block that builds it.
// These are declarative markers — the installer code still writes the logic,
// but the manifest declares what outputs must exist post-install.
const GENERATED_FILES = [
  { dest: ".claude/paths.json", builder: "paths-builder" },
  { dest: ".claude/manifest.json", builder: "manifest-builder" },
  { dest: ".claude/agents/store.json", builder: "store-builder" },
  { dest: ".claude/project/memory/events.jsonl", builder: "empty-file" },
  { dest: ".claude/project/memory/learnings.jsonl", builder: "empty-file" },
  { dest: ".claude/project/memory/traces.jsonl", builder: "empty-file" },
  { dest: ".claude/project/memory/systems.jsonl", builder: "systems-seeder" },
  {
    dest: ".claude/settings.json",
    builder: "settings-merger",
    idempotent: true,
  },
  { dest: ".gitignore", builder: "gitignore-block-appender", idempotent: true },
];

// Refine kind labels based on file path — e.g. files inside scripts/hooks/lib/
// are hook_lib, not hook. Keeps category-level counts accurate for the installer.
function refineKind(baseKind, relPath) {
  if (baseKind === "hook" && relPath.includes("scripts/hooks/lib/")) {
    return "hook_lib";
  }
  return baseKind;
}

// ── Walker ──────────────────────────────────────────────
// Skips EXCLUDE_RELATIVE_PREFIXES (dispatch-backups, retros, oneshot store).
function walkDir(absDir, relBase = "", srcRoot = "") {
  const out = [];
  if (!fs.existsSync(absDir)) return out;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, entry.name);
    const rel = path.join(relBase, entry.name).replace(/\\/g, "/");
    const fullRel = srcRoot ? `${srcRoot}/${rel}` : rel;
    if (isExcluded(fullRel)) continue;
    if (entry.isDirectory()) {
      out.push(...walkDir(abs, rel, srcRoot));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

function decorateAsset(asset) {
  const kind = asset.kind;
  const absSrc = path.join(ROOT, asset.src);
  const id = idForAsset(
    kind,
    asset.src,
    asset.srcRoot || asset.src.split("/")[0],
  );
  const sha256 = fs.existsSync(absSrc) ? sha256OfFile(absSrc) : null;
  const owner = asset.owner || DEFAULT_OWNER_BY_KIND[kind] || "framework";
  const mergeStrategy =
    asset.mergeStrategy ||
    asset.merge ||
    DEFAULT_MERGE_STRATEGY[kind] ||
    "replace_if_unmodified";
  return {
    id,
    src: asset.src,
    dest: asset.dest,
    kind,
    sha256,
    owner,
    mergeStrategy,
    introducedIn: asset.introducedIn || "0.0.0",
    removedIn: asset.removedIn || null,
    replaces: asset.replaces || null,
    ...(asset.merge ? { merge: asset.merge } : {}),
  };
}

function collectAssets() {
  const assets = [];
  for (const dir of ASSET_DIRS) {
    const abs = path.join(ROOT, dir.src);
    if (!fs.existsSync(abs)) continue;
    // Phase 4 fix-forward: ASSET_DIRS may now point at single files (e.g.
    // warpos/paths.registry.json), not just directories. Handle both.
    const stat = fs.statSync(abs);
    if (stat.isFile()) {
      if (isExcluded(dir.src)) continue;
      assets.push({
        src: dir.src,
        dest: dir.src,
        kind: refineKind(dir.kind, dir.src),
        srcRoot: path.posix.dirname(dir.src),
      });
      continue;
    }
    const files = walkDir(abs, "", dir.src);
    for (const f of files) {
      const fullRel = `${dir.src}/${f}`;
      if (isExcluded(fullRel)) continue;
      assets.push({
        src: fullRel,
        dest: fullRel,
        kind: refineKind(dir.kind, fullRel),
        srcRoot: dir.src,
      });
    }
  }
  for (const t of TOP_LEVEL_SCRIPTS) {
    if (fs.existsSync(path.join(ROOT, t.src))) {
      assets.push({
        src: t.src,
        dest: t.src,
        kind: t.kind,
        srcRoot: "scripts",
      });
    }
  }
  // Phase 4 fix-forward: top-level framework files (version.json, install.ps1)
  if (typeof TOP_LEVEL_FRAMEWORK_FILES !== "undefined") {
    for (const t of TOP_LEVEL_FRAMEWORK_FILES) {
      if (fs.existsSync(path.join(ROOT, t.src))) {
        assets.push({
          src: t.src,
          dest: t.src,
          kind: t.kind,
          srcRoot: "",
        });
      }
    }
  }
  for (const d of FRAMEWORK_DOCS) {
    if (fs.existsSync(path.join(ROOT, d.src))) {
      assets.push({
        src: d.src,
        dest: d.dest,
        kind: "framework_doc",
        merge: d.merge,
        srcRoot: "",
      });
    }
  }
  return assets.map(decorateAsset);
}

// ── Build manifest ──────────────────────────────────────
const assets = collectAssets();

// Group by kind for human readability. Within a kind, sort by src path.
const byKind = {};
for (const a of assets) {
  (byKind[a.kind] = byKind[a.kind] || []).push(a);
}
for (const kind of Object.keys(byKind)) {
  byKind[kind].sort((x, y) => x.src.localeCompare(y.src));
}

const version = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8"))
      .version;
  } catch {
    return "0.0.0";
  }
})();

const manifest = {
  $schema: MANIFEST_SCHEMA_VERSION,
  version,
  generated_by: "scripts/generate-framework-manifest.js",
  counts: Object.fromEntries(
    Object.entries(byKind).map(([k, v]) => [k, v.length]),
  ),
  total: assets.length,
  assets: byKind,
  generated_files: GENERATED_FILES,
};

// Phase 4 fix-forward (codex review 2026-04-30): honor --check flag.
// Without this, release-gates.js gate "framework_manifest" always passes
// while silently mutating the file under test.
const CHECK_MODE = process.argv.includes("--check");
const newJson = JSON.stringify(manifest, null, 2) + "\n";

if (CHECK_MODE) {
  let existing = "";
  try {
    existing = fs.readFileSync(OUT, "utf8");
  } catch {
    console.error(
      `framework-manifest.json missing — run: node scripts/generate-framework-manifest.js`,
    );
    process.exit(1);
  }
  // Strip volatile fields (sha256 of any in-flight ts-bearing assets is fine
  // since the manifest itself has no timestamp; compare verbatim).
  if (existing !== newJson) {
    console.error(
      `framework-manifest.json is stale — run: node scripts/generate-framework-manifest.js`,
    );
    process.exit(1);
  }
  console.log(`framework-manifest.json is current.`);
  process.exit(0);
}

// Ensure output dir exists
fs.mkdirSync(path.dirname(OUT), { recursive: true });

// Stable JSON output (sorted keys at each level would be nicer, but grouping
// by kind already gives us determinism where it matters)
fs.writeFileSync(OUT, newJson);

// Reporting
const pad = (s, n) => s.padEnd(n, " ");
console.log(`\n  WarpOS framework manifest written`);
console.log(`  Output: .claude/framework-manifest.json`);
console.log(`  Version: ${version}`);
console.log(`  Schema: ${manifest.$schema}\n`);
console.log(`  Asset counts by kind:`);
for (const [k, v] of Object.entries(manifest.counts).sort(
  (a, b) => b[1] - a[1],
)) {
  console.log(`    ${pad(k, 20)} ${v}`);
}
console.log(`    ${pad("TOTAL", 20)} ${manifest.total}`);
console.log(`    ${pad("+ generated", 20)} ${GENERATED_FILES.length}\n`);
