#!/usr/bin/env node
/**
 * generate-steps-maps.js — regenerate step tables in canonical docs.
 *
 * Source of truth: docs/00-canonical/STEPS.json
 * Targets:
 *   - docs/00-canonical/PRODUCT_MODEL.md    (10-Step Model section)
 *   - docs/00-canonical/GLOSSARY.md         (Onboarding Steps + Dashboard Activities)
 *   - docs/00-canonical/GOLDEN_PATHS.md     (Flow target-state diagram)
 *
 * Each target doc carries a region delimited by:
 *   <!-- maps:steps:START (region=<name>) --- auto-generated; do not edit -->
 *   <!-- maps:steps:END (region=<name>) -->
 *
 * Flags:
 *   --check   read-only; exit 1 if regen would change anything (CI mode)
 *   --verbose explain every replacement
 */

const fs = require("fs");
const path = require("path");

const PROJECT = path.resolve(__dirname, "..");
const STEPS_PATH = path.join(PROJECT, "docs/00-canonical/STEPS.json");

const CHECK = process.argv.includes("--check");
const VERBOSE = process.argv.includes("--verbose");

function loadRegistry() {
  const raw = fs.readFileSync(STEPS_PATH, "utf8");
  const r = JSON.parse(raw);
  if (!r.phases || !r.steps) {
    throw new Error("STEPS.json missing phases/steps");
  }
  return r;
}

function sortedStepsForPhase(r, phaseName) {
  const phase = r.phases[phaseName];
  if (!phase) return [];
  return (phase.steps || [])
    .map((id) => ({ id, ...r.steps[id] }))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

// ── Region replacement primitive ───────────────────────────────────────
function replaceRegion(body, regionName, newContent) {
  const start = `<!-- maps:steps:START (region=${regionName}) --- auto-generated from docs/00-canonical/STEPS.json; do not edit manually. Regenerate: /maps:steps or node scripts/generate-steps-maps.js -->`;
  const end = `<!-- maps:steps:END (region=${regionName}) -->`;
  const startRe = new RegExp(
    `<!-- maps:steps:START \\(region=${regionName}\\)[^>]*-->[\\s\\S]*?<!-- maps:steps:END \\(region=${regionName}\\) -->`,
    "m",
  );
  const block = `${start}\n\n${newContent.trim()}\n\n${end}`;
  if (startRe.test(body)) {
    return body.replace(startRe, block);
  }
  return null; // markers missing — caller decides to insert or error
}

// ── Table builders ─────────────────────────────────────────────────────
function productModelOnboardingTable(r) {
  const steps = sortedStepsForPhase(r, "onboarding");
  const rows = steps.map(
    (s, i) =>
      `| ${i + 1} | Onboarding | ${s.id} | ${s.component} | ${s.requires_data || "—"} | ${s.produces_data || "—"} |`,
  );
  return [
    "**Onboarding phase (required, strictly linear):**",
    "",
    "| # | Phase | Step ID | Component | Requires | Produces |",
    "| - | ----- | ------- | --------- | -------- | -------- |",
    ...rows,
    "",
    "Completing the last onboarding step drops the user at the **Dashboard** with a baseline competitiveness score.",
  ].join("\n");
}

function productModelDashboardTable(r) {
  const steps = sortedStepsForPhase(r, "dashboard");
  const rows = steps.map(
    (s) =>
      `| ${s.id} | ${s.component} | ${s.requires_data || "—"} | ${s.produces_data || "—"} |`,
  );
  return [
    "**Dashboard phase (optional activities, user opts in from dashboard):**",
    "",
    "| Activity | Component | Requires | Produces |",
    "| -------- | --------- | -------- | -------- |",
    ...rows,
    "",
    'Dashboard activities have dependency edges (see Requires column), but the user chooses the order. The dashboard surfaces a recommended "next unlock" based on highest point-gain, not a forced sequence.',
  ].join("\n");
}

function glossaryOnboardingTable(r) {
  const steps = sortedStepsForPhase(r, "onboarding");
  const rows = steps.map(
    (s) =>
      `| ${s.position} | ${s.id} | ${s.component} | ${s.component_file || `src/components/steps/${s.component}.tsx`} |`,
  );
  return [
    "| Position | Step ID | Component | File |",
    "| -------- | ------- | --------- | ---- |",
    ...rows,
  ].join("\n");
}

function glossaryDashboardTable(r) {
  const steps = sortedStepsForPhase(r, "dashboard");
  const rows = steps.map(
    (s) =>
      `| ${s.id} | ${s.component} | ${s.component_file || `src/components/steps/${s.component}.tsx`} | ${s.feature} |`,
  );
  return [
    "| Activity | Component | File | Feature |",
    "| -------- | --------- | ---- | ------- |",
    ...rows,
  ].join("\n");
}

function goldenPathsFlow(r) {
  const on = sortedStepsForPhase(r, "onboarding");
  const da = sortedStepsForPhase(r, "dashboard");
  const onNames = on.map((s) => s.id).join(" → ");
  const daNames = da.map((s) => s.id).join(", ");
  return [
    "**Onboarding phase (linear, required):**",
    "",
    "```",
    onNames + " → [ENTER DASHBOARD]",
    "```",
    "",
    "**Dashboard phase (optional, user-ordered):**",
    "",
    "```",
    `dashboard → {${daNames}}`,
    "```",
    "",
    `The user enters the dashboard after completing ${on.length} onboarding step${on.length === 1 ? "" : "s"}. From the dashboard they opt into any of ${da.length} optional activities in any order — each contributes to the competitiveness score.`,
  ].join("\n");
}

// ── Targets ────────────────────────────────────────────────────────────
const TARGETS = [
  {
    file: "docs/00-canonical/PRODUCT_MODEL.md",
    regions: [
      { name: "product-model-onboarding", build: productModelOnboardingTable },
      { name: "product-model-dashboard", build: productModelDashboardTable },
    ],
  },
  {
    file: "docs/00-canonical/GLOSSARY.md",
    regions: [
      { name: "glossary-onboarding", build: glossaryOnboardingTable },
      { name: "glossary-dashboard", build: glossaryDashboardTable },
    ],
  },
  {
    file: "docs/00-canonical/GOLDEN_PATHS.md",
    regions: [{ name: "golden-paths-flow", build: goldenPathsFlow }],
  },
];

// ── Main ───────────────────────────────────────────────────────────────
function main() {
  const registry = loadRegistry();
  let wouldChange = false;
  const missing = [];
  const changed = [];

  for (const t of TARGETS) {
    const filePath = path.join(PROJECT, t.file);
    if (!fs.existsSync(filePath)) {
      missing.push(`${t.file} (does not exist)`);
      continue;
    }
    let body = fs.readFileSync(filePath, "utf8");
    let fileChanged = false;
    for (const region of t.regions) {
      const content = region.build(registry);
      const next = replaceRegion(body, region.name, content);
      if (next == null) {
        missing.push(
          `${t.file}::${region.name} (markers not found — add maps:steps:START/END)`,
        );
        continue;
      }
      if (next !== body) {
        body = next;
        fileChanged = true;
        if (VERBOSE) console.log(`  ✓ updated ${t.file}::${region.name}`);
      }
    }
    if (fileChanged) {
      wouldChange = true;
      changed.push(t.file);
      if (!CHECK) fs.writeFileSync(filePath, body);
    }
  }

  if (missing.length) {
    console.error("MISSING MARKERS:");
    for (const m of missing) console.error(`  - ${m}`);
  }

  if (CHECK) {
    if (wouldChange) {
      console.error(
        `CHECK FAILED: ${changed.length} file(s) would change on regen:`,
      );
      for (const f of changed) console.error(`  - ${f}`);
      process.exit(1);
    }
    if (missing.length) {
      console.error(`CHECK FAILED: ${missing.length} missing marker(s)`);
      process.exit(1);
    }
    console.log("CHECK OK: all auto-generated regions match STEPS.json");
    return;
  }

  if (changed.length === 0 && missing.length === 0) {
    console.log("OK: no changes — all regions already match STEPS.json");
  } else if (changed.length) {
    console.log(`Regenerated ${changed.length} file(s):`);
    for (const f of changed) console.log(`  - ${f}`);
  }
  if (missing.length) process.exit(1);
}

main();
