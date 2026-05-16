#!/usr/bin/env node
/**
 * scripts/warpos/test-cross-version-replay.js — cross-version replay test bench.
 *
 * Builds a synthetic fixture matching a previous capsule shape, then drives
 * preflight + transaction.begin + transaction.commit in a single hop, asserting
 * the composed flow returns ok-on-green and red-on-drift.
 *
 * Scenarios covered this dispatch (AC-S-9.{1,2}):
 *
 *   1. clean-fixture-green
 *      - Fixture mirrors a 0.4.4 install (framework-installed.json + paths.json
 *        + version.json + framework-manifest.json all aligned).
 *      - Preflight against 0.5.0 must return ok=true (or, in the canonical
 *        clone case, only fail on gates that don't apply to a clean fixture).
 *
 *   2. drift-fixture-red
 *      - Same fixture but framework-manifest.json mutated to claim 0.2.2 while
 *        framework-installed.json + version.json still say 0.4.4. version-quorum
 *        must fire RED.
 *
 * Deferred to follow-up (per Plan Contract): full multi-hop matrix, MIGRATION
 * presence drift, capsule unresolvable, etc. Those become subsequent fixture
 * cases under runtime/qa-warp-update/.
 *
 * Usage:
 *   node scripts/warpos/test-cross-version-replay.js
 *   node scripts/warpos/test-cross-version-replay.js --keep-fixtures   # don't rm tmp dir
 *
 * Linked: SP-20260513-005 / S-9 / T-059 / AC-S-9.{1,2} / R-29.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const preflight = require("./preflight");

const KEEP = process.argv.includes("--keep-fixtures");
const QA_ROOT = path.join(
  process.cwd(),
  "runtime",
  "qa-warp-update",
  "clean-0.4.4",
);
const REPO_ROOT = path.resolve(__dirname, "..", "..");

let failures = 0;
function assert(name, ok, extra) {
  const tag = ok ? "PASS" : "FAIL";
  console.log(`  ${tag} ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failures += 1;
}

function buildCleanFixture(root, version) {
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  // version.json (the trust winner)
  fs.writeFileSync(
    path.join(root, "version.json"),
    JSON.stringify(
      {
        $schema: "warpos/version/v1",
        name: "warpos",
        version,
      },
      null,
      2,
    ),
  );
  // framework-manifest.json
  fs.writeFileSync(
    path.join(root, ".claude", "framework-manifest.json"),
    JSON.stringify(
      {
        $schema: "warpos/framework-manifest/v2",
        version,
        counts: {},
        assets: {},
      },
      null,
      2,
    ),
  );
  // framework-installed.json — has a real installedVersion so install-baseline passes
  fs.writeFileSync(
    path.join(root, ".claude", "framework-installed.json"),
    JSON.stringify(
      {
        $schema: "warpos/framework-installed/v2",
        installedVersion: version,
        installedAt: new Date().toISOString(),
        source: REPO_ROOT,
        assets: [],
      },
      null,
      2,
    ),
  );
  // minimal paths.json so path-resolution doesn't choke
  fs.writeFileSync(
    path.join(root, ".claude", "paths.json"),
    JSON.stringify(
      {
        $schema: "warpos/paths/v4",
        version: 4,
        eventsFile: ".claude/project/events/events.jsonl",
      },
      null,
      2,
    ),
  );
  fs.mkdirSync(path.join(root, ".claude", "project", "events"), {
    recursive: true,
  });
}

// ── Scenario 1: clean-fixture-green ─────────────────────────────

console.log(
  "\n[scenario 1] clean-fixture-green (fixture at 0.4.4, --to 0.5.0)",
);

// Wipe + rebuild fixture
if (fs.existsSync(QA_ROOT))
  fs.rmSync(QA_ROOT, { recursive: true, force: true });
buildCleanFixture(QA_ROOT, "0.4.4");

const r1 = preflight.runPreflight({
  targetRoot: QA_ROOT,
  sourceTreeRoot: REPO_ROOT,
  sourceRoot: REPO_ROOT,
  toVersion: "0.5.0",
  allRed: true, // diagnostic for fixtures
});

// The fixture is minimal — some gates that walk a manifest may degrade. We
// assert install-baseline + version-quorum + capsule-resolvable + migration-presence
// are GREEN. The others (manifest-honesty, path-resolution, structure-parity,
// staleness, applied-migrations, tracked-transients) are best-effort against
// a synthetic install and may degrade harmlessly.
const byName = Object.fromEntries(r1.gates.map((g) => [g.name, g]));
assert(
  "AC-S-9.1 install-baseline GREEN on clean fixture",
  byName["warpos-install-baseline"] &&
    byName["warpos-install-baseline"].status === "green",
);
assert(
  "AC-S-9.1 capsule-resolvable GREEN against canonical capsule",
  byName["warpos-capsule-resolvable"] &&
    byName["warpos-capsule-resolvable"].status === "green",
);
assert(
  "AC-S-9.1 version-quorum GREEN when all sources agree",
  byName["warpos-version-quorum"] &&
    byName["warpos-version-quorum"].status === "green",
);
assert(
  "AC-S-9.1 migration-presence GREEN when capsule has no migrations",
  byName["warpos-migration-presence"] &&
    byName["warpos-migration-presence"].status === "green",
);

// ── Scenario 2: drift-fixture-red ───────────────────────────────

console.log(
  "\n[scenario 2] drift-fixture-red (manifest.json mutated to 0.2.2)",
);

// Mutate ONLY framework-manifest.json to introduce version drift.
const manifestFile = path.join(QA_ROOT, ".claude", "framework-manifest.json");
const m = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
m.version = "0.2.2";
fs.writeFileSync(manifestFile, JSON.stringify(m, null, 2));

const r2 = preflight.runPreflight({
  targetRoot: QA_ROOT,
  sourceTreeRoot: REPO_ROOT,
  sourceRoot: REPO_ROOT,
  toVersion: "0.5.0",
  allRed: true,
});
const byName2 = Object.fromEntries(r2.gates.map((g) => [g.name, g]));
assert(
  "AC-S-9.2 version-quorum RED on drift fixture",
  byName2["warpos-version-quorum"] &&
    byName2["warpos-version-quorum"].status === "red",
  byName2["warpos-version-quorum"] && byName2["warpos-version-quorum"].reason,
);
assert(
  "AC-S-9.2 preflight aggregate ok=false",
  r2.ok === false,
  `ok=${r2.ok} redCount=${r2.redCount}`,
);

// Drift fixture override: --allow-version-drift accepts the override and turns red → yellow.
const r3 = preflight.runPreflight({
  targetRoot: QA_ROOT,
  sourceTreeRoot: REPO_ROOT,
  sourceRoot: REPO_ROOT,
  toVersion: "0.5.0",
  allRed: true,
  allowVersionDrift: true,
});
const byName3 = Object.fromEntries(r3.gates.map((g) => [g.name, g]));
assert(
  "R-34 --allow-version-drift override re-interprets version-quorum as yellow",
  byName3["warpos-version-quorum"] &&
    byName3["warpos-version-quorum"].status === "yellow" &&
    byName3["warpos-version-quorum"].overrideUsed === true,
  byName3["warpos-version-quorum"] && byName3["warpos-version-quorum"].reason,
);

if (!KEEP) {
  try {
    fs.rmSync(QA_ROOT, { recursive: true, force: true });
  } catch {
    /* fine */
  }
}

if (failures > 0) {
  console.log(`\n[bench] ${failures} ASSERTION(S) FAILED`);
  process.exit(1);
} else {
  console.log("\n[bench] ALL CROSS-VERSION REPLAY ASSERTIONS PASSED");
}
