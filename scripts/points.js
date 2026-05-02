#!/usr/bin/env node
// Calculate builder points after an eval cycle.
// Usage: node scripts/points.js --feature <name> --run <N>

const fs = require("fs");
const path = require("path");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

function usage() {
  process.stderr.write(
    `${YELLOW}Usage: node scripts/points.js --feature <name> --run <N>${RESET}\n`,
  );
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let feature = null;
  let run = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--feature" && args[i + 1]) {
      feature = args[++i];
    } else if (args[i] === "--run" && args[i + 1]) {
      run = parseInt(args[++i], 10);
    }
  }

  if (!feature || run == null || isNaN(run)) usage();
  return { feature, run };
}

function loadStore() {
  const storePath = path.resolve(
    __dirname,
    "..",
    ".claude",
    "agents",
    "store.json",
  );
  try {
    return JSON.parse(fs.readFileSync(storePath, "utf8"));
  } catch (err) {
    process.stderr.write(
      `${RED}[points] ERROR: Could not read store.json: ${err.message}${RESET}\n`,
    );
    process.exit(1);
  }
}

function calculatePoints(featureData) {
  const fixAttempts = featureData.fixAttempts || 0;
  const evalResult = featureData.evalResult || featureData.status;
  const securityResult = featureData.securityResult || null;
  const complianceResult = featureData.complianceResult || null;
  const hygieneViolations = featureData.hygieneViolations || 0;
  const durationMs = featureData.durationMs || null;
  const entryStates = featureData.entryStates || null;

  const breakdown = {};
  const achievements = [];

  // Base points based on fix attempts
  let base;
  if (fixAttempts === 0) {
    base = 100;
  } else if (fixAttempts === 1) {
    base = 75;
  } else if (fixAttempts === 2) {
    base = 50;
  } else {
    base = 25;
  }
  breakdown.base = base;

  // Bonus: security pass
  let bonus = 0;
  if (
    securityResult === "pass" ||
    securityResult === "security_pass" ||
    featureData.status === "security_pass" ||
    featureData.status === "done"
  ) {
    bonus += 20;
    breakdown.securityBonus = 20;
  }

  // Bonus: compliance pass
  if (complianceResult === "pass" || complianceResult === "compliance_pass") {
    bonus += 10;
    breakdown.complianceBonus = 10;
  }

  // Bonus: full coverage (all entry states handled)
  if (entryStates === "full" || featureData.fullCoverage) {
    bonus += 15;
    breakdown.coverageBonus = 15;
  }

  // Penalty: hygiene violations
  const penalty = hygieneViolations * 10;
  if (penalty > 0) {
    breakdown.hygienePenalty = -penalty;
  }

  const total = base + bonus - penalty;
  breakdown.total = total;

  // Achievements
  if (fixAttempts === 0) {
    achievements.push("First Try");
  }
  if (hygieneViolations === 0) {
    achievements.push("Clean Sheet");
  }
  if (durationMs != null && durationMs < 5 * 60 * 1000) {
    achievements.push("Speed Demon");
  }

  return { points: total, breakdown, achievements };
}

function main() {
  const { feature, run } = parseArgs();
  const store = loadStore();

  const featureData = store.features && store.features[feature];
  if (!featureData) {
    process.stderr.write(
      `${RED}[points] ERROR: Feature "${feature}" not found in store.json${RESET}\n`,
    );
    process.exit(1);
  }

  const { points, breakdown, achievements } = calculatePoints(featureData);

  process.stderr.write(
    `${CYAN}[points]${RESET} Feature: ${GREEN}${feature}${RESET} | Run: ${run} | Points: ${points >= 80 ? GREEN : YELLOW}${points}${RESET}\n`,
  );

  if (achievements.length > 0) {
    process.stderr.write(
      `${CYAN}[points]${RESET} Achievements: ${achievements.join(", ")}\n`,
    );
  }

  const result = {
    feature,
    run,
    points,
    breakdown,
    achievements,
  };

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main();
