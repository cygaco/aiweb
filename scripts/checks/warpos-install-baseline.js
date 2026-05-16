#!/usr/bin/env node
/**
 * check:warpos-install-baseline — preflight gate (F-4 mitigation).
 *
 * Verifies a WarpOS install baseline exists in the target project before
 * /warp:update may proceed. Without `--force-fresh`, the gate refuses
 * when `.claude/framework-installed.json` is missing OR
 * `installedVersion === "0.0.0"` (the silent-fallback sentinel).
 *
 * Status:
 *   green  — framework-installed.json present + installedVersion is real
 *   yellow — --force-fresh override accepted (preflight composer may
 *            interpret as green if override was opted in)
 *   red    — missing or sentinel 0.0.0 without override
 *
 * Output schema (IN-1).
 *
 * Usage:
 *   node scripts/checks/warpos-install-baseline.js [--target <path>] [--force-fresh] [--json]
 *
 * Linked: SP-20260513-005 / S-4 / AC-S-4.2 / R-4 / C-1 / F-4
 */

const fs = require("fs");
const path = require("path");

const START = Date.now();
const NAME = "warpos-install-baseline";

function arg(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  return process.argv[i + 1] || null;
}
const JSON_OUT = process.argv.includes("--json");
const FORCE_FRESH = process.argv.includes("--force-fresh");
const TARGET_ROOT = path.resolve(
  arg("--target") || process.env.CLAUDE_PROJECT_DIR || process.cwd(),
);

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
  } else if (result.status === "yellow") {
    console.log(`WARN [${NAME}] ${result.reason}`);
  } else {
    console.error(`FAIL [${NAME}] ${result.reason}`);
    if (result.remediation) console.error(`     fix: ${result.remediation}`);
  }
  process.exit(result.status === "red" ? 1 : 0);
}

const file = path.join(TARGET_ROOT, ".claude", "framework-installed.json");
const exists = fs.existsSync(file);

let installedVersion = null;
let malformed = false;
if (exists) {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    installedVersion = j.installedVersion || j.version || null;
  } catch {
    malformed = true;
  }
}

const hasBaseline =
  exists && !malformed && installedVersion && installedVersion !== "0.0.0";

if (hasBaseline) {
  emit({
    status: "green",
    reason: `installed baseline ${installedVersion} present at ${path.relative(TARGET_ROOT, file).replace(/\\/g, "/")}`,
    evidence: { file, installedVersion },
  });
}

if (FORCE_FRESH) {
  emit({
    status: "yellow",
    reason: `no baseline (${exists ? `sentinel ${installedVersion || "<malformed>"}` : "file missing"}) but --force-fresh override accepted`,
    evidence: {
      file,
      exists,
      installedVersion,
      malformed,
      override: "--force-fresh",
    },
    remediation:
      "Override accepted. Apply will be treated as a fresh install (massive ADD_SAFE plan expected).",
  });
}

const reason = malformed
  ? `framework-installed.json malformed (not parseable JSON)`
  : exists
    ? `framework-installed.json present but installedVersion is sentinel ${installedVersion || "(missing field)"}`
    : `framework-installed.json not found at ${path.relative(TARGET_ROOT, file).replace(/\\/g, "/")} — this project has no installed WarpOS snapshot to update from.`;

emit({
  status: "red",
  reason,
  remediation: [
    "Run install.ps1 first (this is for upgrades, not fresh installs):",
    "  powershell -ExecutionPolicy Bypass -File <warpos-repo>/install.ps1",
    "Or, if a baseline exists in git history, restore it:",
    "  git checkout <prev-commit> -- .claude/framework-installed.json",
    "Override: --force-fresh (DANGER — treats this as a fresh install, produces a massive ADD_SAFE plan)",
  ].join("\n"),
  evidence: { file, exists, installedVersion, malformed },
});
