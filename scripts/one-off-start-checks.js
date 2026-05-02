#!/usr/bin/env node
// One-off: run /oneshot:start's 8 launchable-state checks. Read-only.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { PATHS } = require("./hooks/lib/paths");

const TELEMETRY_WHITELIST = [
  ".claude/.agent-result-hashes.json",
  ".claude/.last-checkpoint",
  ".claude/.session-checkpoint.json",
  ".claude/runtime/.topology-snapshot.json",
  ".claude/runtime/handoff.md",
  ".claude/settings.local.json",
  ".claude/scheduled_tasks.lock",
  ".claude/agents/02-oneshot/.system/store.json.prev-run-backup.json",
  PATHS.store,
  PATHS.oneshotStore,
];
const TELEMETRY_PREFIXES = [
  ".claude/project/events/",
  ".claude/runtime/logs/",
  ".claude/agents/02-oneshot/.system/retros/", // pre-existing untracked
  ".claude/project/memory/",
];

function isTelemetry(rel) {
  if (TELEMETRY_WHITELIST.includes(rel)) return true;
  return TELEMETRY_PREFIXES.some((p) => rel.startsWith(p));
}

const results = [];
function check(label, fn) {
  try {
    const r = fn();
    results.push({ label, pass: r.pass, detail: r.detail || "" });
  } catch (e) {
    results.push({ label, pass: false, detail: `error: ${e.message}` });
  }
}

// A. Mode
check("A. Mode == oneshot", () => {
  const modeFile = path.join(".claude", "runtime", "mode.json");
  if (!fs.existsSync(modeFile))
    return { pass: false, detail: "mode.json missing — run /mode:oneshot" };
  const m = JSON.parse(fs.readFileSync(modeFile, "utf8"));
  return m.mode === "oneshot"
    ? { pass: true, detail: `mode=oneshot (set ${m.setAt || "unknown"})` }
    : { pass: false, detail: `mode is "${m.mode}" — run /mode:oneshot first` };
});

// B. Branch
check("B. Branch is skeleton-testN", () => {
  const branch = execSync("git branch --show-current", {
    encoding: "utf8",
  }).trim();
  if (/^skeleton-test\d+$/.test(branch)) return { pass: true, detail: branch };
  return {
    pass: false,
    detail: `branch=${branch} — run /oneshot:preflight --setup-only`,
  };
});

// C. Working tree clean (modulo telemetry whitelist)
check("C. Working tree clean", () => {
  const out = execSync("git status --porcelain", { encoding: "utf8" });
  const lines = out.split("\n").filter(Boolean);
  const dirty = lines.filter((l) => {
    const rel = l.slice(3).trim().replace(/\\/g, "/");
    return !isTelemetry(rel);
  });
  return dirty.length === 0
    ? {
        pass: true,
        detail: `clean (${lines.length - dirty.length} telemetry-whitelisted)`,
      }
    : {
        pass: false,
        detail: `${dirty.length} non-whitelisted dirty paths: ${dirty.slice(0, 3).join("; ")}`,
      };
});

// D. Store exists
check("D. Store exists", () => {
  return fs.existsSync(PATHS.oneshotStore)
    ? { pass: true, detail: PATHS.oneshotStore }
    : { pass: false, detail: "missing" };
});

const store = JSON.parse(fs.readFileSync(PATHS.oneshotStore, "utf8"));
const manifest = JSON.parse(fs.readFileSync(PATHS.manifest, "utf8"));

// E. Store ready for run
check("E. Non-foundation features at not_started", () => {
  const wrong = [];
  for (const [name, f] of Object.entries(store.features || {})) {
    if (name.startsWith("foundation-") || name === "foundation") continue;
    if (f.status !== "not_started") wrong.push(`${name}=${f.status}`);
  }
  return wrong.length === 0
    ? { pass: true, detail: `all set` }
    : { pass: false, detail: `wrong status: ${wrong.slice(0, 3).join(", ")}` };
});

// F. Run number matches branch
check("F. Run number matches branch", () => {
  const runFile = path.join(".claude", "runtime", "run.json");
  if (!fs.existsSync(runFile))
    return { pass: false, detail: "run.json missing" };
  const branch = execSync("git branch --show-current", {
    encoding: "utf8",
  }).trim();
  const m = branch.match(/^skeleton-test(\d+)$/);
  if (!m) return { pass: false, detail: `not on skeleton branch` };
  const branchN = parseInt(m[1], 10);
  const runJson = JSON.parse(fs.readFileSync(runFile, "utf8"));
  return runJson.runNumber === branchN
    ? { pass: true, detail: `runNumber=${branchN}` }
    : {
        pass: false,
        detail: `runNumber=${runJson.runNumber}, branch N=${branchN}`,
      };
});

// G. Manifest features in store (phase=0 exempt)
check("G. Manifest features in store", () => {
  const features = manifest.build?.features || [];
  const missing = [];
  for (const f of features) {
    if ((f.phase || 0) === 0) continue; // exempt
    if (!(f.id in (store.features || {}))) missing.push(f.id);
  }
  return missing.length === 0
    ? {
        pass: true,
        detail: `${features.filter((f) => (f.phase || 0) >= 1).length} phase≥1 features all in store`,
      }
    : { pass: false, detail: `missing: ${missing.join(", ")}` };
});

// H. validate-gates ↔ manifest (phase=0 exempt)
check("H. validate-gates PHASES matches manifest", () => {
  const src = fs.readFileSync(
    path.resolve("scripts", "validate-gates.js"),
    "utf8",
  );
  const phasesIds = new Set();
  // Parse PHASES = { 0: [...], 1: [...], ... }
  const phasesMatch = src.match(/const PHASES\s*=\s*\{([\s\S]*?)\n\};/);
  if (!phasesMatch)
    return { pass: false, detail: "could not parse PHASES dict" };
  const body = phasesMatch[1];
  const entries = body.matchAll(/(\d+(?:\.\d+)?)\s*:\s*\[([^\]]+)\]/g);
  for (const m of entries) {
    const phase = parseFloat(m[1]);
    if (phase === 0) continue; // exempt
    const ids = m[2].match(/"([^"]+)"/g) || [];
    for (const id of ids) phasesIds.add(id.replace(/"/g, ""));
  }
  const manifestIds = new Set(
    (manifest.build?.features || [])
      .filter((f) => (f.phase || 0) > 0)
      .map((f) => f.id),
  );
  const missingFromPhases = [...manifestIds].filter((x) => !phasesIds.has(x));
  const orphanInPhases = [...phasesIds].filter((x) => !manifestIds.has(x));
  if (missingFromPhases.length === 0 && orphanInPhases.length === 0) {
    return { pass: true, detail: `${phasesIds.size} phase≥1 ids aligned` };
  }
  return {
    pass: false,
    detail: `missing from PHASES: ${missingFromPhases.join(",") || "none"}; orphan in PHASES: ${orphanInPhases.join(",") || "none"}`,
  };
});

// I. Canonical-dispatch smoke (auto-runs if marker missing or stale > 4h)
check("I. Canonical-dispatch smoke (cross-provider reachable)", () => {
  const markerPath = path.join(
    ".claude",
    "runtime",
    ".canonical-dispatch-smoke-passed",
  );
  const STALE_MS = 4 * 60 * 60 * 1000; // 4 hours

  let needRun = true;
  if (fs.existsSync(markerPath)) {
    const stat = fs.statSync(markerPath);
    const age = Date.now() - stat.mtimeMs;
    if (age < STALE_MS) needRun = false;
  }

  if (needRun) {
    try {
      execSync("node scripts/delta-canonical-dispatch-smoke.js", {
        stdio: "pipe",
        timeout: 200_000,
      });
    } catch (e) {
      const stderr = (e.stderr || "").toString().slice(-300);
      return {
        pass: false,
        detail: `smoke test failed — fix providers OR update manifest.agentProviders to fall back to claude. Last stderr: ${stderr}`,
      };
    }
  }

  // Marker should now exist with all providers ok
  if (!fs.existsSync(markerPath)) {
    return { pass: false, detail: "smoke marker not written despite exit 0" };
  }
  const data = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  const failed = Object.entries(data.providers || {})
    .filter(([, v]) => !v.ok)
    .map(([k]) => k);
  if (failed.length > 0) {
    return {
      pass: false,
      detail: `providers failing: ${failed.join(", ")} — run scripts/delta-canonical-dispatch-smoke.js for details`,
    };
  }
  const fresh = needRun
    ? "(just ran)"
    : `(cached, ${Math.round((Date.now() - fs.statSync(markerPath).mtimeMs) / 60000)}m old)`;
  return {
    pass: true,
    detail: `${Object.keys(data.providers).length} providers ok ${fresh}`,
  };
});

// Print
let allPass = true;
for (const r of results) {
  const mark = r.pass ? "✓" : "✗";
  console.log(`${mark} ${r.label}: ${r.detail}`);
  if (!r.pass) allPass = false;
}

console.log("");
if (allPass) {
  console.log("ALL CHECKS PASS — ready to hand off to Delta.");
  process.exit(0);
} else {
  console.log("CHECKS FAILED — fix before launching.");
  process.exit(1);
}
