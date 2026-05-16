#!/usr/bin/env node
/**
 * scripts/warpos/replay-bench.js — Cross-version replay test bench.
 *
 * SP-20260514-001 / T-20260514-077.
 *
 * Drives every load-bearing /warp:update invariant against the current
 * repo state. Exits non-zero on any failure. Intended to run before a
 * candidate WarpOS release is tagged AND as a precommit smoke when any
 * file under scripts/warpos/lib/ or scripts/checks/warpos-*.js is
 * touched.
 *
 * What it covers:
 *   1. content-hash module self-test (AC-1.1, AC-1.2, AC-1.3)
 *   2. capsule un-truncation: every asset in framework-manifest.json has
 *      a 64-char sha256 (AC-3.1)
 *   3. consumer un-truncation: every entry in framework-installed.json
 *      has a 64-char installedHash (AC-4.1)
 *   4. back-compat: every asset hash accepts a simulated 12-char prefix
 *      via hashMatches (AC-4.2, AC-3.2)
 *   5. manifest-honesty against the regenerated state (AC-2.2)
 *   6. applied-migrations gate is capsule-aware (AC-8.1)
 *   7. preflight --operator-override CLI contract (AC-5.1, AC-5.3)
 *
 * Not covered here (run as separate scripts):
 *   - test-transaction-smoke.js — transaction wrapper smoke
 *   - real cross-version replay (0.6.x → 0.7.0) — needs sibling capsules
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function run(label, cmd, args, opts = {}) {
  const r = spawnSync(process.execPath, [cmd, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    ...opts,
  });
  const ok = opts.expectFail ? r.status !== 0 : r.status === 0;
  process.stdout.write(
    `${ok ? "PASS" : "FAIL"} ${label}  (exit=${r.status})\n`,
  );
  if (!ok) {
    process.stdout.write(
      `  stdout: ${(r.stdout || "").trim().slice(0, 300)}\n`,
    );
    process.stdout.write(
      `  stderr: ${(r.stderr || "").trim().slice(0, 300)}\n`,
    );
  }
  return ok;
}

function jsonAssert(label, fn) {
  try {
    const result = fn();
    process.stdout.write(`${result ? "PASS" : "FAIL"} ${label}\n`);
    return !!result;
  } catch (e) {
    process.stdout.write(`FAIL ${label}\n  err: ${e && e.message}\n`);
    return false;
  }
}

const results = [];

// 1. content-hash --selftest
results.push(
  run("AC-1.* content-hash --selftest", "scripts/warpos/lib/content-hash.js", [
    "--selftest",
  ]),
);

// 2. capsule un-truncation
results.push(
  jsonAssert("AC-3.1 framework-manifest.json sha256 length=[64]", () => {
    const m = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, ".claude", "framework-manifest.json"),
        "utf8",
      ),
    );
    const flat = [];
    for (const k of Object.keys(m.assets || {})) {
      for (const a of m.assets[k] || []) flat.push(a);
    }
    const lens = new Set(flat.map((a) => (a.sha256 || "").length));
    return flat.length > 0 && lens.size === 1 && [...lens][0] === 64;
  }),
);

// 3. consumer un-truncation
results.push(
  jsonAssert(
    "AC-4.1 framework-installed.json installedHash length=[64]",
    () => {
      const i = JSON.parse(
        fs.readFileSync(
          path.join(ROOT, ".claude", "framework-installed.json"),
          "utf8",
        ),
      );
      const lens = new Set(
        (i.assets || []).map((a) => (a.installedHash || "").length),
      );
      return (
        (i.assets || []).length > 0 && lens.size === 1 && [...lens][0] === 64
      );
    },
  ),
);

// 4. back-compat smoke (already exists as its own script)
results.push(
  run(
    "AC-4.2 back-compat: hashMatches accepts simulated 12-char prefix",
    "scripts/warpos/test-hash-back-compat.js",
    [],
  ),
);

// 5. manifest-honesty
results.push(
  run(
    "AC-2.2 manifest-honesty after refactor",
    "scripts/checks/warpos-manifest-honesty.js",
    [],
  ),
);

// 6. applied-migrations gate (capsule-aware)
results.push(
  run(
    "AC-8.1 applied-migrations gate capsule-aware",
    "scripts/checks/warpos-applied-migrations.js",
    [],
  ),
);

// 7. preflight --operator-override CLI contract — negative tests
results.push(
  run(
    "AC-5.1 preflight rejects unknown gate name (exit 2)",
    "scripts/warpos/preflight.js",
    [
      "--operator-override",
      "not-a-real-gate",
      "--override-reason",
      "valid reason here",
    ],
    { expectFail: true },
  ),
);

results.push(
  run(
    "AC-5.3 preflight rejects missing --override-reason (exit 2)",
    "scripts/warpos/preflight.js",
    ["--operator-override", "staleness"],
    { expectFail: true },
  ),
);

results.push(
  run(
    "AC-5.3 preflight rejects too-short --override-reason (exit 2)",
    "scripts/warpos/preflight.js",
    ["--operator-override", "staleness", "--override-reason", "short"],
    { expectFail: true },
  ),
);

const total = results.length;
const passed = results.filter(Boolean).length;
process.stdout.write(`\nreplay-bench: ${passed}/${total} pass\n`);
process.exit(passed === total ? 0 : 1);
