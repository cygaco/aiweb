#!/usr/bin/env node
/**
 * check:warpos-capsule-resolvable — preflight gate (F-1 mitigation).
 *
 * Verifies the capsule for `--to <version>` is resolvable from the target
 * project, walking the same lookup paths /warp:update#discoverCanonical
 * uses, in this order:
 *
 *   1. <target>/framework/releases/<v>/release.json          (self-update)
 *   2. ../WarpOS/framework/releases/<v>/release.json         (sibling)
 *   3. ../warpos/framework/releases/<v>/release.json         (sibling)
 *   4. <manifest.warpos.source>/framework/releases/<v>/      (manifest hint)
 *   5. <framework-installed.json#source>/framework/releases/ (install hint)
 *
 * Status:
 *   green  — capsule found AND release.json parses
 *   red    — capsule absent in all searched locations (with remediation
 *            listing every available version per location)
 *   red    — capsule release.json malformed (does NOT throw)
 *
 * Output schema (per IN-1):
 *   { name, status, reason, remediation, durationMs, evidence }
 *
 * Usage:
 *   node scripts/checks/warpos-capsule-resolvable.js --to <v> [--target <path>] [--json]
 *
 * Linked: SP-20260513-005 / S-3 / AC-S-3.{1,2,3} / R-3 / C-2 / F-1
 */

const fs = require("fs");
const path = require("path");

const START = Date.now();
const NAME = "warpos-capsule-resolvable";

function arg(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  return process.argv[i + 1] || null;
}
const JSON_OUT = process.argv.includes("--json");
const TARGET_ROOT = path.resolve(
  arg("--target") || process.env.CLAUDE_PROJECT_DIR || process.cwd(),
);
const VERSION = arg("--to");

function emit(result) {
  const out = {
    name: NAME,
    status: result.status,
    reason: result.reason,
    remediation: result.remediation || null,
    durationMs: Date.now() - START,
    evidence: result.evidence || {},
  };
  if (JSON_OUT) {
    console.log(JSON.stringify(out));
  } else if (result.status === "green") {
    console.log(`OK   [${NAME}] ${result.reason}`);
  } else {
    console.error(`FAIL [${NAME}] ${result.reason}`);
    if (result.remediation) console.error(`     fix: ${result.remediation}`);
  }
  process.exit(result.status === "green" ? 0 : 1);
}

if (!VERSION) {
  emit({
    status: "red",
    reason: "missing --to <version>",
    remediation: "node scripts/checks/warpos-capsule-resolvable.js --to <v>",
    evidence: {},
  });
}

function listAvailableVersions(releasesDir) {
  if (!fs.existsSync(releasesDir)) return null;
  try {
    return fs
      .readdirSync(releasesDir)
      .filter((d) => /^\d/.test(d))
      .filter((d) => fs.existsSync(path.join(releasesDir, d, "release.json")))
      .sort();
  } catch {
    return null;
  }
}

function manifestSource() {
  const file = path.join(TARGET_ROOT, ".claude", "manifest.json");
  if (!fs.existsSync(file)) return null;
  try {
    const m = JSON.parse(fs.readFileSync(file, "utf8"));
    const src = m && m.warpos && m.warpos.source;
    if (!src) return null;
    if (/^https?:\/\//.test(src)) return null;
    return path.resolve(src);
  } catch {
    return null;
  }
}

function installedSource() {
  const file = path.join(TARGET_ROOT, ".claude", "framework-installed.json");
  if (!fs.existsSync(file)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!j || !j.source) return null;
    if (/^https?:\/\//.test(j.source)) return null;
    // installed.source typically points to .../framework/releases/<v>; walk up
    // to the repo root (the source root is the dir above framework/).
    let s = path.resolve(j.source);
    if (s.includes(`${path.sep}framework${path.sep}`)) {
      s = s.split(`${path.sep}framework${path.sep}`)[0];
    }
    return s;
  } catch {
    return null;
  }
}

function searchLocations() {
  const list = [];
  list.push({ kind: "self", root: TARGET_ROOT });
  list.push({
    kind: "sibling-WarpOS",
    root: path.resolve(TARGET_ROOT, "..", "WarpOS"),
  });
  list.push({
    kind: "sibling-warpos",
    root: path.resolve(TARGET_ROOT, "..", "warpos"),
  });
  const ms = manifestSource();
  if (ms) list.push({ kind: "manifest.warpos.source", root: ms });
  const is = installedSource();
  if (is) list.push({ kind: "framework-installed.source", root: is });
  // De-dup by absolute path
  const seen = new Set();
  return list.filter((l) => {
    const k = l.root.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function inspect(searchedLocations, version) {
  const evidence = { searched: [], available: {} };
  for (const loc of searchedLocations) {
    const releasesDir = path.join(loc.root, "framework", "releases");
    const capsuleDir = path.join(releasesDir, version);
    const releaseJson = path.join(capsuleDir, "release.json");
    const exists = fs.existsSync(releaseJson);
    let malformed = false;
    if (exists) {
      try {
        JSON.parse(fs.readFileSync(releaseJson, "utf8"));
      } catch {
        malformed = true;
      }
    }
    evidence.searched.push({
      kind: loc.kind,
      releaseJson,
      exists,
      malformed,
    });
    if (fs.existsSync(releasesDir)) {
      evidence.available[loc.root] = listAvailableVersions(releasesDir) || [];
    }
    if (exists && !malformed) {
      evidence.resolvedAt = capsuleDir;
      evidence.resolvedRoot = loc.root;
      return { found: true, malformedOnly: false, evidence };
    }
    if (exists && malformed) {
      evidence.malformedAt = releaseJson;
      return { found: false, malformedOnly: true, evidence };
    }
  }
  return { found: false, malformedOnly: false, evidence };
}

const result = inspect(searchLocations(), VERSION);

if (result.found) {
  emit({
    status: "green",
    reason: `capsule ${VERSION} resolved at ${result.evidence.resolvedAt}`,
    evidence: result.evidence,
  });
}

if (result.malformedOnly) {
  emit({
    status: "red",
    reason: "capsule release.json malformed",
    remediation: `Inspect ${result.evidence.malformedAt} or rebuild with: node scripts/warpos/release-build.js ${VERSION}`,
    evidence: result.evidence,
  });
}

// Not found anywhere. Build the remediation message listing available
// versions per location.
const availableLines = Object.entries(result.evidence.available)
  .map(([root, versions]) => {
    if (!versions || versions.length === 0) return `    ${root}: (none)`;
    return `    ${root}: ${versions.slice(-8).join(", ")}`;
  })
  .join("\n");

const remediation = [
  `capsule ${VERSION} not found in any searched location. Options:`,
  availableLines,
  `  1. Use one of the available versions above:`,
  `       /warp:update --to <available-v> --apply`,
  `  2. Or point --source at a canonical clone explicitly:`,
  `       /warp:update --to ${VERSION} --source /abs/path/to/WarpOS --apply`,
  `  3. If the capsule was never built, build it in canonical:`,
  `       node scripts/warpos/release-build.js ${VERSION}`,
].join("\n");

emit({
  status: "red",
  reason: `capsule ${VERSION} not found in any searched location`,
  remediation,
  evidence: result.evidence,
});
