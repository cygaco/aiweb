#!/usr/bin/env node
// CLI tool: validate phase gates for the agent build system.
//
// Usage:
//   node scripts/validate-gates.js              # validate ALL features
//   node scripts/validate-gates.js --phase 2    # validate specific phase
//   node scripts/validate-gates.js --advance 3  # can phase 3 start?

const fs = require("fs");
const path = require("path");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const PHASES = {
  0: [
    "foundation-types",
    "foundation-constants",
    "foundation-storage",
    "foundation-validators",
    "foundation-pipeline",
    "foundation-api",
    "foundation-utils",
    "foundation-prompts",
    "foundation-ui",
    "foundation-layout",
  ],
  1: ["auth", "rockets"],
  1.5: ["backend"],
  2: ["onboarding"],
  2.5: ["shell", "profile"],
  3: ["market-research"],
  4: ["deep-dive-qa", "skills-curation", "competitiveness"],
  5: ["resume-generation", "linkedin"],
  6: ["extension", "auto-apply"],
  7: ["deus-mechanicus"],
};

const PHASE_KEYS = Object.keys(PHASES)
  .map(Number)
  .sort((a, b) => a - b);

function loadStore() {
  // Canonical oneshot state — resolve via paths.json (paths.oneshotStore).
  // The root .claude/agents/store.json is a foundation-edit heartbeat marker,
  // NOT the oneshot build state. This is a classic path-drift pitfall; the
  // registry makes it fix-once-propagate-everywhere.
  let storePath;
  try {
    const { PATHS } = require("./hooks/lib/paths");
    storePath = PATHS.oneshotStore;
  } catch {
    storePath = path.resolve(
      __dirname,
      "..",
      ".claude",
      "agents",
      "02-oneshot",
      ".system",
      "store.json",
    );
  }
  try {
    return JSON.parse(fs.readFileSync(storePath, "utf8"));
  } catch (e) {
    console.error(
      `${RED}ERROR: Could not read oneshot store.json at ${storePath}: ${e.message}${RESET}`,
    );
    process.exit(1);
  }
}

function validateFeature(name, store) {
  const entry = store.features[name];
  if (!entry) {
    return {
      feature: name,
      status: "missing",
      blockers: ["not found in store"],
    };
  }

  const blockers = [];
  const isFoundation = name.startsWith("foundation-");

  // Foundation features: just need "done"
  if (isFoundation) {
    if (entry.status !== "done") {
      blockers.push(`status is "${entry.status}" (needs "done")`);
    }
    return { feature: name, status: entry.status, blockers };
  }

  // Non-foundation: check for missing gates
  if (entry.status === "built") {
    if (!entry.evalResult) {
      blockers.push("missing: evalResult");
    }
  }

  if (entry.status === "eval_pass") {
    if (!entry.securityResult) {
      blockers.push("missing: securityResult");
    }
  }

  return { feature: name, status: entry.status, blockers };
}

function validatePhase(phaseNum, store) {
  const features = PHASES[phaseNum];
  if (!features) {
    console.error(`${RED}ERROR: Unknown phase ${phaseNum}${RESET}`);
    console.error(`${YELLOW}Valid phases: ${PHASE_KEYS.join(", ")}${RESET}`);
    process.exit(1);
  }

  const results = features.map((f) => validateFeature(f, store));
  return results;
}

function isFeatureComplete(name, store) {
  const entry = store.features[name];
  if (!entry) return false;

  // Foundation: done is sufficient
  if (name.startsWith("foundation-")) return entry.status === "done";

  // Non-foundation: "done" OR "skipped" OR ("eval_pass" AND "security_pass")
  if (entry.status === "done") return true;
  if (entry.status === "skipped") return true;
  if (entry.status === "eval_pass" && entry.securityResult === "pass")
    return true;
  if (entry.status === "security_pass") return true;

  return false;
}

function checkAdvance(targetPhase, store) {
  const blockers = [];

  // All phases before targetPhase must be complete
  for (const pk of PHASE_KEYS) {
    if (pk >= targetPhase) break;

    const features = PHASES[pk];
    for (const f of features) {
      if (!isFeatureComplete(f, store)) {
        const entry = store.features[f];
        const status = entry ? entry.status : "missing";
        blockers.push({
          feature: f,
          phase: pk,
          status,
          reason: `not complete (status: "${status}")`,
        });
      }
    }
  }

  return { canAdvance: blockers.length === 0, blockers };
}

function printFeatureResult(r) {
  const icon =
    r.blockers.length === 0 ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
  const statusColor =
    r.status === "done" ? GREEN : r.status === "not_started" ? RED : YELLOW;
  console.log(`  ${icon}  ${r.feature} (${statusColor}${r.status}${RESET})`);
  for (const b of r.blockers) {
    console.log(`       ${RED}- ${b}${RESET}`);
  }
}

// --- Main ---

const args = process.argv.slice(2);
const store = loadStore();

if (args.includes("--advance")) {
  const idx = args.indexOf("--advance");
  const targetPhase = parseFloat(args[idx + 1]);
  if (isNaN(targetPhase)) {
    console.error(`${RED}ERROR: --advance requires a phase number${RESET}`);
    process.exit(1);
  }

  console.log(`\n${BOLD}Can phase ${targetPhase} start?${RESET}\n`);

  const result = checkAdvance(targetPhase, store);

  if (result.canAdvance) {
    console.log(
      `${GREEN}YES — all prerequisite phases are complete.${RESET}\n`,
    );
    console.log(JSON.stringify({ canAdvance: true, blockers: [] }, null, 2));
    process.exit(0);
  } else {
    console.log(`${RED}NO — blockers found:${RESET}\n`);
    for (const b of result.blockers) {
      console.log(
        `  ${RED}- [Phase ${b.phase}] ${b.feature}: ${b.reason}${RESET}`,
      );
    }
    console.log();
    console.log(
      JSON.stringify({ canAdvance: false, blockers: result.blockers }, null, 2),
    );
    process.exit(1);
  }
} else if (args.includes("--phase")) {
  const idx = args.indexOf("--phase");
  const phaseNum = parseFloat(args[idx + 1]);
  if (isNaN(phaseNum)) {
    console.error(`${RED}ERROR: --phase requires a phase number${RESET}`);
    process.exit(1);
  }

  console.log(`\n${BOLD}Phase ${phaseNum} gate validation${RESET}\n`);

  const results = validatePhase(phaseNum, store);
  const hasBlockers = results.some((r) => r.blockers.length > 0);

  for (const r of results) {
    printFeatureResult(r);
  }

  console.log();
  if (hasBlockers) {
    console.log(`${RED}Phase ${phaseNum} has blockers.${RESET}\n`);
    process.exit(1);
  } else {
    console.log(`${GREEN}Phase ${phaseNum} is clean.${RESET}\n`);
    process.exit(0);
  }
} else {
  // Validate ALL features across all phases
  console.log(`\n${BOLD}Full gate validation${RESET}\n`);

  let totalBlockers = 0;

  for (const pk of PHASE_KEYS) {
    console.log(`${BOLD}--- Phase ${pk} ---${RESET}`);
    const results = validatePhase(pk, store);
    for (const r of results) {
      printFeatureResult(r);
      totalBlockers += r.blockers.length;
    }
    console.log();
  }

  if (totalBlockers > 0) {
    console.log(`${RED}${totalBlockers} blocker(s) found.${RESET}\n`);
    process.exit(1);
  } else {
    console.log(`${GREEN}All gates clean.${RESET}\n`);
    process.exit(0);
  }
}
