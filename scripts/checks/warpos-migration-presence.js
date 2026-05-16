#!/usr/bin/env node
/**
 * check:warpos-migration-presence — preflight gate (F-5 mitigation).
 *
 * For the capsule under `--to <version>`, walks
 * `framework/releases/<v>/release.json#migrations[]` and verifies every
 * referenced file exists in the source tree.
 *
 * Status:
 *   green  — every listed migration file exists in source
 *   green  — release.json has no migrations
 *   red    — any listed migration is missing in source
 *
 * Override: NONE per RT-5 — the broken capsule is the bug, not the gate.
 *
 * Output schema (IN-1).
 *
 * Usage:
 *   node scripts/checks/warpos-migration-presence.js --to <v> \
 *     [--source <path>] [--target <path>] [--json]
 *
 *   --source defaults to --target (self-update mode).
 *
 * Linked: SP-20260513-005 / S-4 / AC-S-4.3 / R-10 / C-4 / F-5
 */

const fs = require("fs");
const path = require("path");

const START = Date.now();
const NAME = "warpos-migration-presence";

function arg(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  return process.argv[i + 1] || null;
}
const JSON_OUT = process.argv.includes("--json");
const TARGET_ROOT = path.resolve(
  arg("--target") || process.env.CLAUDE_PROJECT_DIR || process.cwd(),
);
const SOURCE_ROOT = path.resolve(arg("--source") || TARGET_ROOT);
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
    remediation: "node scripts/checks/warpos-migration-presence.js --to <v>",
    evidence: {},
  });
}

const capsuleDir = path.join(SOURCE_ROOT, "framework", "releases", VERSION);
const releaseFile = path.join(capsuleDir, "release.json");
if (!fs.existsSync(releaseFile)) {
  emit({
    status: "red",
    reason: `capsule ${VERSION} not at ${path.relative(SOURCE_ROOT, capsuleDir).replace(/\\/g, "/")}/release.json`,
    remediation: `Run /check:warpos-capsule-resolvable --to ${VERSION} to locate the capsule, then pass --source <path>.`,
    evidence: { releaseFile },
  });
}

let release;
try {
  release = JSON.parse(fs.readFileSync(releaseFile, "utf8"));
} catch (e) {
  emit({
    status: "red",
    reason: `capsule ${VERSION} release.json malformed: ${e.message}`,
    remediation: `Inspect ${releaseFile} or rebuild with: node scripts/warpos/release-build.js ${VERSION}`,
    evidence: { releaseFile },
  });
}

const migrations = release.migrations || [];
if (migrations.length === 0) {
  emit({
    status: "green",
    reason: `capsule ${VERSION} lists 0 migrations`,
    evidence: { capsuleDir, migrations: [] },
  });
}

const checked = [];
const missing = [];
for (const m of migrations) {
  // A migration entry may be a string (relative path) or an object
  // {file, id}. Normalize to a relative path string.
  let rel;
  if (typeof m === "string") rel = m;
  else if (m && typeof m === "object")
    rel = m.file || m.path || m.script || null;
  if (!rel) {
    missing.push({ entry: m, reason: "entry has no resolvable file path" });
    continue;
  }
  // Migration paths in release.json are capsule-relative (matches
  // release-build.js: `path.resolve(capsuleDir, m.file)`).
  const abs = path.isAbsolute(rel) ? rel : path.resolve(capsuleDir, rel);
  checked.push({ entry: rel, abs });
  if (!fs.existsSync(abs)) {
    missing.push({ entry: rel, abs, reason: "file not found in source tree" });
  }
}

if (missing.length === 0) {
  emit({
    status: "green",
    reason: `capsule ${VERSION} lists ${migrations.length} migration(s), all present in source`,
    evidence: { capsuleDir, checked },
  });
}

emit({
  status: "red",
  reason: `capsule ${VERSION} lists ${missing.length} migration(s) missing from source`,
  remediation: [
    `Capsule was built with a manifest referencing migrations never committed.`,
    `In the canonical clone, re-run the release build to regenerate:`,
    `  node scripts/warpos/release-build.js ${VERSION}`,
    `Or, if a migration was intentionally omitted, edit ${path.relative(SOURCE_ROOT, releaseFile).replace(/\\/g, "/")} to remove the entry, then:`,
    `  node scripts/warpos/release-canonical.js ${VERSION}`,
    `Override: none — refuse to apply with missing migration files.`,
  ].join("\n"),
  evidence: { capsuleDir, checked, missing },
});
