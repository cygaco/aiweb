#!/usr/bin/env node
/**
 * pre-commit-steps-check.js — hard gate on STEPS.json integrity.
 *
 * Runs from `.git/hooks/pre-commit`. Exits 1 (blocking the commit) if:
 *
 *   (a) docs/00-canonical/STEPS.json is staged AND its post-stage body
 *       violates the registry schema (same invariants step-registry-guard
 *       checks at Edit/Write time), OR
 *   (b) STEPS.json OR any of the 3 canonical step-table docs are staged
 *       AND `node scripts/generate-steps-maps.js --check` reports drift
 *       (i.e. the auto-gen regions in the docs don't match what STEPS.json
 *       would produce).
 *
 * Exits 0 (allowing the commit) if no relevant files are staged, or all
 * checks pass. Does NOT read from stdin — git hooks don't pipe input the
 * way Claude Code hooks do.
 *
 * The runtime warning in step-registry-guard.js (PreToolUse, non-blocking)
 * is the first line of defense; this pre-commit check is the last mile
 * before a bad STEPS.json can reach skeleton-test7 / master and cascade
 * into the WarpOS sync.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

// Resolve project root — pre-commit runs from repo root, but be robust
const PROJECT = path.resolve(__dirname, "..", "..");
const STEPS_JSON_REL = "docs/00-canonical/STEPS.json";
const CANONICAL_DOC_RELS = [
  "docs/00-canonical/PRODUCT_MODEL.md",
  "docs/00-canonical/GLOSSARY.md",
  "docs/00-canonical/GOLDEN_PATHS.md",
];

// ── Staged file discovery ───────────────────────────────────────────────
function stagedFiles() {
  try {
    const out = execFileSync(
      "git",
      ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
      { cwd: PROJECT, encoding: "utf8" },
    );
    return out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/\\/g, "/"));
  } catch (e) {
    // If git fails, don't block — the commit will fail on its own
    return [];
  }
}

// ── Staged STEPS.json body (what's about to land, not working tree) ─────
function stagedBlob(relPath) {
  const res = spawnSync("git", ["show", `:${relPath}`], {
    cwd: PROJECT,
    encoding: "utf8",
  });
  if (res.status !== 0) return null;
  return res.stdout;
}

// ── Schema validation (ported from step-registry-guard.js) ──────────────
function validateStepsRegistry(body) {
  const findings = [];

  let registry;
  try {
    registry = JSON.parse(body);
  } catch (e) {
    return [`STEPS.json is not valid JSON: ${e.message}`];
  }

  // Top-level shape
  if (typeof registry.version !== "number")
    findings.push("missing or non-numeric `version`");
  if (!registry.phases || typeof registry.phases !== "object")
    findings.push("missing or non-object `phases`");
  if (!registry.steps || typeof registry.steps !== "object")
    findings.push("missing or non-object `steps`");
  if (findings.length) return findings;

  // Phase ↔ step membership
  const phaseNames = Object.keys(registry.phases);
  const stepIds = new Set(Object.keys(registry.steps));
  for (const ph of phaseNames) {
    const phaseDef = registry.phases[ph] || {};
    const listed = Array.isArray(phaseDef.steps) ? phaseDef.steps : [];
    for (const id of listed) {
      if (!stepIds.has(id)) {
        findings.push(`phase "${ph}" lists unknown step "${id}"`);
      }
    }
  }

  // Every step: phase membership + required fields
  for (const [id, step] of Object.entries(registry.steps)) {
    if (!step || typeof step !== "object") {
      findings.push(`step "${id}" is not an object`);
      continue;
    }
    const ph = step.phase;
    if (!ph || !phaseNames.includes(ph)) {
      findings.push(`step "${id}" has unknown or missing phase "${ph}"`);
    } else {
      const listed = Array.isArray(registry.phases[ph].steps)
        ? registry.phases[ph].steps
        : [];
      if (!listed.includes(id)) {
        findings.push(
          `step "${id}" declares phase "${ph}" but is not listed in phases.${ph}.steps`,
        );
      }
    }
    for (const req of ["position", "component", "feature"]) {
      if (step[req] === undefined) {
        findings.push(`step "${id}" missing required field "${req}"`);
      }
    }
    if (
      step.position !== undefined &&
      (typeof step.position !== "number" || !Number.isInteger(step.position))
    ) {
      findings.push(`step "${id}" position must be an integer`);
    }
  }

  // Positions unique
  const positionsSeen = new Map();
  for (const [id, step] of Object.entries(registry.steps)) {
    if (typeof step?.position !== "number") continue;
    const prev = positionsSeen.get(step.position);
    if (prev)
      findings.push(`position ${step.position} collides: ${prev} and ${id}`);
    else positionsSeen.set(step.position, id);
  }

  return findings;
}

// ── Drift check via generate-steps-maps.js --check ──────────────────────
function runDriftCheck() {
  const script = path.join(PROJECT, "scripts", "generate-steps-maps.js");
  if (!fs.existsSync(script)) {
    return { ok: true, stdout: "", stderr: "(generator missing, skipped)" };
  }
  const res = spawnSync("node", [script, "--check"], {
    cwd: PROJECT,
    encoding: "utf8",
  });
  return {
    ok: res.status === 0,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
  };
}

// ── Error banner ────────────────────────────────────────────────────────
function banner(title, lines) {
  const bar = "━".repeat(72);
  const out = [
    "",
    bar,
    `BLOCKED: ${title}`,
    bar,
    ...lines,
    bar,
    "",
    "To bypass (NOT recommended — re-runs in CI anyway):",
    "  git commit --no-verify",
    "",
  ];
  process.stderr.write(out.join("\n") + "\n");
}

// ── Main ────────────────────────────────────────────────────────────────
function main() {
  const staged = stagedFiles();
  if (staged.length === 0) process.exit(0);

  const stepsJsonStaged = staged.includes(STEPS_JSON_REL);
  const canonDocStaged = staged.some((f) => CANONICAL_DOC_RELS.includes(f));

  // Nothing relevant — no-op
  if (!stepsJsonStaged && !canonDocStaged) process.exit(0);

  let blocked = false;

  // (a) Schema validation on the staged STEPS.json body
  if (stepsJsonStaged) {
    const body = stagedBlob(STEPS_JSON_REL);
    if (body == null) {
      banner("pre-commit-steps-check: could not read staged STEPS.json", [
        "  `git show :docs/00-canonical/STEPS.json` failed.",
        "  The commit cannot proceed until git can resolve the staged blob.",
      ]);
      process.exit(1);
    }
    const findings = validateStepsRegistry(body);
    if (findings.length) {
      const lines = [
        `${findings.length} schema violation(s) in staged docs/00-canonical/STEPS.json:`,
        "",
        ...findings.map((f) => `  • ${f}`),
        "",
        "STEPS.json is the source of truth for step order + phase membership.",
        "Downstream consumers: src/lib/types.ts Step enum, the 3 canonical docs'",
        "step tables, scripts/hooks/step-registry-guard.js.",
        "",
        "Fix STEPS.json, re-stage, and commit again.",
      ];
      banner("STEPS.json schema violations", lines);
      blocked = true;
    }
  }

  // (b) Drift check — only if schema passed, no point otherwise
  if (!blocked) {
    const drift = runDriftCheck();
    if (!drift.ok) {
      const lines = [
        "`node scripts/generate-steps-maps.js --check` reports drift:",
        "",
        ...(drift.stderr || drift.stdout || "(no output)")
          .split(/\r?\n/)
          .filter(Boolean)
          .map((l) => `  ${l}`),
        "",
        "One of these is true:",
        "  - You edited STEPS.json but did not regenerate the canonical doc tables.",
        "  - You hand-edited an auto-generated region inside a canonical doc.",
        "",
        "Fix: run `/maps:steps` (or `node scripts/generate-steps-maps.js`),",
        "     then stage the updated canonical docs and commit again.",
      ];
      banner("Canonical docs drift from STEPS.json", lines);
      blocked = true;
    }
  }

  process.exit(blocked ? 1 : 0);
}

main();
