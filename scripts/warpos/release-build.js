/**
 * release-build.js — Build a release capsule for a given version.
 *
 * Phase 4E artifact (engine; the slash command /warp:release is a wrapper).
 *
 * Usage:
 *   node scripts/warpos/release-build.js 0.1.0          # build capsule for 0.1.0
 *   node scripts/warpos/release-build.js 0.1.0 --check  # verify capsule integrity, no writes
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { printHumanReport } = require("./report-format");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RELEASES_DIR = path.join(REPO_ROOT, "warpos", "releases");
const FRAMEWORK_MANIFEST = path.join(
  REPO_ROOT,
  ".claude",
  "framework-manifest.json",
);

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function gitHead() {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

function buildCapsule(version, opts) {
  const checkOnly = opts && opts.check;
  const capsuleDir = path.join(RELEASES_DIR, version);
  if (!fs.existsSync(capsuleDir)) {
    console.error(`Capsule directory missing: ${capsuleDir}`);
    process.exit(2);
  }

  const releaseFile = path.join(capsuleDir, "release.json");
  if (!fs.existsSync(releaseFile)) {
    console.error(`release.json missing in capsule ${version}`);
    process.exit(2);
  }
  const release = JSON.parse(fs.readFileSync(releaseFile, "utf8"));

  // 1. Snapshot framework-manifest.json into capsule (unless already present
  //    and we're in --check mode).
  const manifestSnap = path.join(capsuleDir, "framework-manifest.json");
  if (!checkOnly) {
    if (!fs.existsSync(FRAMEWORK_MANIFEST)) {
      console.error(
        `framework-manifest.json missing — run scripts/generate-framework-manifest.js first`,
      );
      process.exit(2);
    }
    fs.copyFileSync(FRAMEWORK_MANIFEST, manifestSnap);
  } else if (!fs.existsSync(manifestSnap)) {
    console.error(
      `Capsule ${version} missing framework-manifest.json snapshot`,
    );
    process.exit(2);
  }

  // 2. Validate migrations referenced in release.json exist.
  // Fix-forward (codex Phase 4 review 2026-04-30): require all migration
  // paths to resolve INSIDE the repo's migrations/ tree. Without this, a
  // hand-edited release.json could escape via `../../../../etc/...` and
  // checksums.json would silently fingerprint arbitrary local files.
  const MIGRATIONS_ROOT = path.join(REPO_ROOT, "migrations");
  const missingMigrations = [];
  const escapingMigrations = [];
  for (const m of release.migrations || []) {
    const abs = path.resolve(capsuleDir, m.file);
    const rel = path.relative(MIGRATIONS_ROOT, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      escapingMigrations.push({
        id: m.id,
        path: path.relative(REPO_ROOT, abs).replace(/\\/g, "/"),
      });
      continue;
    }
    if (!fs.existsSync(abs)) {
      missingMigrations.push({
        id: m.id,
        expected: path.relative(REPO_ROOT, abs).replace(/\\/g, "/"),
      });
    }
  }
  if (escapingMigrations.length > 0) {
    console.error(
      `Migration paths escape the migrations/ tree (boundary violation):`,
    );
    for (const m of escapingMigrations) {
      console.error(`  ${m.id} → ${m.path}`);
    }
    console.error(
      `Refusing to build capsule. Each migration file must live under ${path.relative(REPO_ROOT, MIGRATIONS_ROOT).replace(/\\/g, "/")}/`,
    );
    process.exit(2);
  }
  if (missingMigrations.length > 0) {
    console.error(`Migration files missing for capsule ${version}:`);
    for (const m of missingMigrations) {
      console.error(`  ${m.id} → ${m.expected}`);
    }
    process.exit(2);
  }

  // 3. Compute checksums for every file in the capsule
  const checksums = {};
  for (const ent of fs.readdirSync(capsuleDir, { withFileTypes: true })) {
    if (ent.isFile() && ent.name !== "checksums.json") {
      checksums[ent.name] = sha256File(path.join(capsuleDir, ent.name));
    }
  }

  // 4. Compute checksums for migration files (stored as relative paths under <capsule>/migrations.relative)
  for (const m of release.migrations || []) {
    const abs = path.resolve(capsuleDir, m.file);
    const rel = path.relative(capsuleDir, abs).replace(/\\/g, "/");
    checksums[rel] = sha256File(abs);
  }

  const checksumsFile = path.join(capsuleDir, "checksums.json");
  if (checkOnly) {
    if (!fs.existsSync(checksumsFile)) {
      console.error(`Capsule ${version} missing checksums.json`);
      process.exit(2);
    }
    const existing = JSON.parse(fs.readFileSync(checksumsFile, "utf8"));
    const drift = [];
    for (const [k, v] of Object.entries(checksums)) {
      if (existing.entries[k] !== v)
        drift.push({
          file: k,
          expected: existing.entries[k] || "(missing)",
          actual: v,
        });
    }
    if (drift.length > 0) {
      console.error(`Capsule ${version} checksum drift:`);
      for (const d of drift)
        console.error(
          `  ${d.file}: ${d.expected.slice(0, 12)} → ${d.actual.slice(0, 12)}`,
        );
      process.exit(1);
    }
    console.log(
      `Capsule ${version} verified: ${Object.keys(checksums).length} files, all checksums match.`,
    );
    printHumanReport("warp:release", {
      verdict: "Capsule verified",
      whatChanged: "No files changed in --check mode.",
      why: "The existing release capsule checksum set matches current capsule contents.",
      risksRemaining: "Run release gates separately before publishing.",
      whatWasRejected: "Checksum drift would have been rejected.",
      whatWasTested: `${Object.keys(checksums).length} capsule and migration checksum entries`,
      needsHumanDecision: "None.",
      recommendedNextAction: "Run node scripts/warpos/release-gates.js before tagging.",
    });
    return { ok: true, version, files: Object.keys(checksums).length };
  }

  // 5. Write checksums.json
  const out = {
    version,
    generatedAt: new Date().toISOString(),
    commit: gitHead(),
    entries: checksums,
  };
  fs.writeFileSync(checksumsFile, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `Capsule ${version} built: ${Object.keys(checksums).length} files, checksums at ${path.relative(REPO_ROOT, checksumsFile)}`,
  );
  printHumanReport("warp:release", {
    verdict: "Capsule built",
    whatChanged: `Updated manifest snapshot and checksums for ${version}.`,
    why: "Release capsules give /warp:update a deterministic source manifest, migrations, and integrity checks.",
    risksRemaining: "Release gates still need to pass before publishing.",
    whatWasRejected: "Migration paths outside migrations/ were rejected before checksums.",
    whatWasTested: `${Object.keys(checksums).length} capsule and migration checksum entries`,
    needsHumanDecision: "Review changelog and upgrade notes before tagging.",
    recommendedNextAction: "Run node scripts/warpos/release-gates.js.",
  });
  return { ok: true, version, files: Object.keys(checksums).length };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const version = args.find((a) => /^\d+\.\d+\.\d+/.test(a));
  const checkOnly = args.includes("--check");
  if (!version) {
    console.error(
      "Usage: node scripts/warpos/release-build.js <version> [--check]",
    );
    process.exit(2);
  }
  buildCapsule(version, { check: checkOnly });
}

module.exports = { buildCapsule };
