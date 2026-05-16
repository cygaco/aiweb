/**
 * scripts/warpos/postflight.js — /warp:update postflight verifier.
 *
 * Composes 5 checks after a successful apply:
 *
 *   1. manifest-honesty       (existing check:warpos-manifest-honesty)
 *   2. path-resolution        (existing check:warpos-path-resolution)
 *   3. applied-migrations     (existing check:warpos-applied-migrations)
 *   4. provider-smoke         (external check via T-058 primitive, SP-002)
 *   5. /warp:health rollup    (scripts/check/warpos-health.js if present)
 *
 * Writes an evidence package at `<txDir>/evidence/postflight.json` matching
 * IN-3. Emits TR-5 (per-check + aggregate) and TR-6 (evidence pointer).
 *
 * Does NOT auto-rollback on red — postflight is diagnostic. Exits 0 unless
 * `opts.strict` is true (operator passed `--strict-postflight`).
 *
 * registerExternalCheck(spec) — SP-002 boundary. SP-002 wires one call:
 *
 *   const pf = require("scripts/warpos/postflight");
 *   pf.registerExternalCheck({
 *     name: "provider-smoke",
 *     resolvePath: "paths.providerSmokeSkill",
 *     required: false,
 *     degradedReason: "provider-smoke skill not yet shipped",
 *   });
 *
 * Linked: SP-20260513-005 / S-7, S-8 / T-057, T-058 /
 *   AC-S-7.{1,2,3}, AC-S-8.{1,2} / IN-3, IN-5 / R-19..R-21 / C-8, C-9.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const events = require("./lib/update-events");

// ── External-check registry (T-058) ─────────────────────────────
//
// Module-scoped singleton. SP-002's provider-smoke skill calls
// registerExternalCheck() at module-load time; postflight reads the array
// during runPostflight().

const externalChecks = [];

/**
 * Register an external check to run as part of postflight.
 *
 * @param {Object} spec
 * @param {string} spec.name              — short identifier (e.g. "provider-smoke")
 * @param {string} spec.resolvePath       — paths.X key to resolve the script
 * @param {boolean} [spec.required]       — if true, absence = red; default false → degraded
 * @param {string} [spec.degradedReason]  — message when absent + not required
 * @returns {boolean} whether the spec was accepted
 */
function registerExternalCheck(spec) {
  if (!spec || typeof spec !== "object") return false;
  if (typeof spec.name !== "string" || !spec.name.trim()) return false;
  if (typeof spec.resolvePath !== "string" || !spec.resolvePath.trim())
    return false;
  // De-dup by name
  const existing = externalChecks.findIndex((s) => s.name === spec.name);
  const normalized = {
    name: spec.name,
    resolvePath: spec.resolvePath,
    required: !!spec.required,
    degradedReason: spec.degradedReason || `${spec.name} skill not yet shipped`,
  };
  if (existing >= 0) externalChecks[existing] = normalized;
  else externalChecks.push(normalized);
  return true;
}

function listExternalChecks() {
  return externalChecks.slice();
}

function clearExternalChecks() {
  externalChecks.length = 0;
}

// ── paths.X resolution ──────────────────────────────────────────

function resolvePathsKey(targetRoot, key) {
  const file = path.join(targetRoot, ".claude", "paths.json");
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    // key may be "paths.X" or just "X"
    const k = key.startsWith("paths.") ? key.slice("paths.".length) : key;
    const rel = raw[k];
    if (!rel) return null;
    return path.isAbsolute(rel) ? rel : path.join(targetRoot, rel);
  } catch {
    return null;
  }
}

// ── Per-check runners ───────────────────────────────────────────

function runNodeCheck(scriptAbs, args, cwd) {
  const r = spawnSync(process.execPath, [scriptAbs, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
  });
  return r;
}

function runBuiltinCheck(name, targetRoot) {
  const start = Date.now();
  const scriptMap = {
    "manifest-honesty": "scripts/checks/warpos-manifest-honesty.js",
    "path-resolution": "scripts/checks/warpos-path-resolution.js",
    "applied-migrations": "scripts/checks/warpos-applied-migrations.js",
  };
  const rel = scriptMap[name];
  if (!rel) {
    return {
      name,
      status: "degraded",
      reason: `unknown built-in check: ${name}`,
      durationMs: Date.now() - start,
      evidence: {},
    };
  }
  // Resolve from the warpos source root (the dir containing scripts/checks/).
  // For postflight the script lives in the framework, not the target — so
  // walk up from postflight.js to find scripts/checks/.
  const candidates = [
    path.join(__dirname, "..", "..", rel),
    path.join(targetRoot, rel),
  ];
  let scriptAbs = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      scriptAbs = c;
      break;
    }
  }
  if (!scriptAbs) {
    return {
      name,
      status: "degraded",
      reason: `script not found: ${rel}`,
      durationMs: Date.now() - start,
      evidence: { searched: candidates },
    };
  }
  const r = runNodeCheck(scriptAbs, ["--json"], targetRoot);
  const status = r.status === 0 ? "green" : "red";
  let evidence = {};
  let reason = `exit code ${r.status}`;
  try {
    const parsed = JSON.parse(r.stdout || "{}");
    evidence = parsed;
    if (parsed.reason) reason = parsed.reason;
  } catch {
    evidence = {
      stdout: (r.stdout || "").slice(0, 4096),
      stderr: (r.stderr || "").slice(0, 4096),
    };
  }
  return {
    name,
    status,
    reason,
    durationMs: Date.now() - start,
    evidence,
  };
}

function runWarpHealthRollup(targetRoot) {
  const start = Date.now();
  // Look for an existing /warp:health entry point. The convention varies; we
  // try the most likely candidates and fall back to degraded if none exist.
  const candidates = [
    path.join(__dirname, "..", "check", "warpos-health.js"),
    path.join(targetRoot, "scripts", "check", "warpos-health.js"),
    path.join(__dirname, "..", "..", "scripts", "check", "warpos-health.js"),
  ];
  let scriptAbs = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      scriptAbs = c;
      break;
    }
  }
  if (!scriptAbs) {
    return {
      name: "warp-health",
      status: "degraded",
      reason: "/warp:health rollup script not present yet",
      durationMs: Date.now() - start,
      evidence: { searched: candidates },
    };
  }
  const r = runNodeCheck(scriptAbs, ["--json"], targetRoot);
  return {
    name: "warp-health",
    status: r.status === 0 ? "green" : "red",
    reason: `exit code ${r.status}`,
    durationMs: Date.now() - start,
    evidence: {
      stdout: (r.stdout || "").slice(0, 4096),
      stderr: (r.stderr || "").slice(0, 4096),
    },
  };
}

function runExternalCheck(spec, targetRoot) {
  const start = Date.now();
  const resolved = resolvePathsKey(targetRoot, spec.resolvePath);
  if (!resolved || !fs.existsSync(resolved)) {
    return {
      name: spec.name,
      status: spec.required ? "red" : "degraded",
      reason: spec.required
        ? `required external check '${spec.name}' not registered (paths.${spec.resolvePath} unresolved)`
        : spec.degradedReason,
      durationMs: Date.now() - start,
      evidence: { resolvePath: spec.resolvePath, resolved: resolved || null },
    };
  }
  const r = runNodeCheck(resolved, ["--json"], targetRoot);
  let evidence = {};
  try {
    evidence = JSON.parse(r.stdout || "{}");
  } catch {
    evidence = { stdout: (r.stdout || "").slice(0, 4096) };
  }
  return {
    name: spec.name,
    status: r.status === 0 ? "green" : "red",
    reason: `exit code ${r.status}`,
    durationMs: Date.now() - start,
    evidence,
  };
}

// ── Composer ────────────────────────────────────────────────────

/**
 * Run all 5 postflight checks in order and write the evidence package.
 *
 * @param {Object} opts
 * @param {string} opts.targetRoot   — absolute path to install root
 * @param {string} opts.txId         — transaction id (for events + evidence)
 * @param {string} opts.txDir        — abs path to .warpos/transactions/<txId>/
 * @param {Object} [opts.capsule]    — capsule metadata (release.json contents)
 * @param {boolean} [opts.strict]    — --strict-postflight: any red = exit non-zero
 * @returns {Object} { ok, checkCount, redCount, yellowCount, greenCount, degradedCount, checks, evidencePath, operatorAction }
 */
function runPostflight(opts) {
  const startedAt = Date.now();
  const { targetRoot, txId, txDir } = opts;

  if (!targetRoot) throw new Error("runPostflight: targetRoot required");

  const checks = [];

  // 1. manifest-honesty
  checks.push(runBuiltinCheck("manifest-honesty", targetRoot));
  // 2. path-resolution
  checks.push(runBuiltinCheck("path-resolution", targetRoot));
  // 3. applied-migrations
  checks.push(runBuiltinCheck("applied-migrations", targetRoot));
  // 4. external checks (provider-smoke + any future registrations)
  for (const spec of externalChecks) {
    checks.push(runExternalCheck(spec, targetRoot));
  }
  // If no external check registered, surface the dependency explicitly for
  // diagnostic clarity (matches IN-3 example with provider-smoke degraded).
  if (externalChecks.length === 0) {
    checks.push({
      name: "provider-smoke",
      status: "degraded",
      reason: "provider-smoke skill not yet shipped (SP-002 dependency)",
      durationMs: 0,
      evidence: {
        note: "T-058 primitive ready; SP-002 has not registered yet",
      },
    });
  }
  // 5. /warp:health rollup
  checks.push(runWarpHealthRollup(targetRoot));

  const summary = { green: 0, yellow: 0, red: 0, degraded: 0 };
  for (const c of checks) {
    if (c.status === "green") summary.green += 1;
    else if (c.status === "yellow") summary.yellow += 1;
    else if (c.status === "red") summary.red += 1;
    else summary.degraded += 1;
  }

  const ok = summary.red === 0;
  let operatorAction = "green-light";
  if (summary.red >= 2) operatorAction = "rollback-recommended";
  else if (summary.red > 0 || summary.yellow > 0)
    operatorAction = "review-then-decide";

  // Emit per-check TR-5 envelopes
  for (const c of checks) {
    events.emitPostflightCheck(targetRoot, {
      txId,
      check: c.name,
      status: c.status,
      reason: c.reason,
      durationMs: c.durationMs,
      evidence: c.evidence,
    });
  }

  // Write evidence package
  let evidencePath = null;
  if (txDir) {
    try {
      const evDir = path.join(txDir, "evidence");
      fs.mkdirSync(evDir, { recursive: true });
      evidencePath = path.join(evDir, "postflight.json");
      const pkg = {
        $schema: "warpos/update-evidence/v1",
        txId,
        completedAt: new Date().toISOString(),
        checks,
        summary,
        operatorAction,
      };
      fs.writeFileSync(evidencePath, JSON.stringify(pkg, null, 2) + "\n");
    } catch (e) {
      // Postflight dies → write the error log
      try {
        const errLog = path.join(txDir, "evidence", "postflight.error.log");
        fs.mkdirSync(path.dirname(errLog), { recursive: true });
        fs.writeFileSync(errLog, `${new Date().toISOString()} ${e.message}\n`);
      } catch {
        /* fail-open */
      }
    }
  }

  // Aggregate TR-5
  events.emitPostflight(targetRoot, {
    txId,
    ok,
    checkCount: checks.length,
    greenCount: summary.green,
    yellowCount: summary.yellow,
    redCount: summary.red,
    degradedCount: summary.degraded,
    operatorAction,
    evidencePath,
    durationMs: Date.now() - startedAt,
  });

  return {
    ok,
    checkCount: checks.length,
    redCount: summary.red,
    yellowCount: summary.yellow,
    greenCount: summary.green,
    degradedCount: summary.degraded,
    checks,
    evidencePath,
    operatorAction,
    summary,
  };
}

// ── SP-20260513-002 wire-up (T-024) ──────────────────────────────
//
// Self-register the provider-smoke external check on module load. This
// keeps the SP-005 contract (registerExternalCheck is the seam) while
// closing the SP-002 boundary without forcing SP-002 to monkey-patch
// scripts/warpos/update.js. The orchestrator at
// scripts/warpos/provider-smoke.js is resolved via paths.providerSmokeSkill;
// when paths.json is absent or the key is missing, runExternalCheck
// surfaces a degraded state per its existing semantics.
//
// Idempotent: registerExternalCheck de-dupes by spec.name, so multiple
// requires of this module re-register the same spec without growing the
// array.
registerExternalCheck({
  name: "provider-smoke",
  resolvePath: "paths.providerSmokeSkill",
  required: false,
  degradedReason:
    "provider-smoke orchestrator not resolvable from paths.providerSmokeSkill",
});

module.exports = {
  runPostflight,
  registerExternalCheck,
  listExternalChecks,
  clearExternalChecks,
  // Exposed for tests:
  resolvePathsKey,
  runBuiltinCheck,
  runExternalCheck,
};
