#!/usr/bin/env node
// Format and log build/phase/run celebrations.
// Usage: node scripts/celebrate.js --type <build|phase|run> --feature <name> --points <N>

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function usage() {
  process.stderr.write(
    `${YELLOW}Usage: node scripts/celebrate.js --type <build|phase|run> --feature <name> --points <N>${RESET}\n`,
  );
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let type = null;
  let feature = null;
  let points = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--type" && args[i + 1]) {
      type = args[++i];
    } else if (args[i] === "--feature" && args[i + 1]) {
      feature = args[++i];
    } else if (args[i] === "--points" && args[i + 1]) {
      points = parseInt(args[++i], 10);
    }
  }

  if (!type || !["build", "phase", "run"].includes(type)) usage();
  if (points == null || isNaN(points)) points = 0;

  return { type, feature: feature || "unknown", points };
}

function celebrateBuild(feature, points) {
  const qualified = points >= 80;
  let message;
  let tier;

  if (points >= 100) {
    message = `${BOLD}${GREEN}PERFECT BUILD: ${feature} scored ${points} pts — flawless execution${RESET}`;
    tier = "perfect";
  } else if (points >= 80) {
    message = `${GREEN}SOLID BUILD: ${feature} scored ${points} pts — well done${RESET}`;
    tier = "solid";
  } else if (points >= 50) {
    message = `${YELLOW}BUILD COMPLETE: ${feature} scored ${points} pts — room for improvement${RESET}`;
    tier = "adequate";
  } else {
    message = `${RED}BUILD SCRAPED BY: ${feature} scored ${points} pts — needs attention${RESET}`;
    tier = "weak";
  }

  if (qualified) {
    process.stderr.write(message + "\n");
  }

  return { type: "build", feature, points, tier, celebrated: qualified };
}

function celebratePhase(feature, points) {
  // "feature" here is used as phase name
  const message = `${BOLD}${MAGENTA}=== PHASE COMPLETE: ${feature.toUpperCase()} — all features passed first try ===${RESET}`;
  process.stderr.write(message + "\n");

  return { type: "phase", phase: feature, points, celebrated: true };
}

function celebrateRun(feature, points) {
  const banner = [
    `${BOLD}${CYAN}================================================${RESET}`,
    `${BOLD}${CYAN}  RUN COMPLETE — Total: ${points} pts${RESET}`,
    `${BOLD}${CYAN}  All features built and evaluated${RESET}`,
    `${BOLD}${CYAN}================================================${RESET}`,
  ];

  for (const line of banner) {
    process.stderr.write(line + "\n");
  }

  return { type: "run", totalPoints: points, celebrated: true };
}

function main() {
  const { type, feature, points } = parseArgs();

  let result;

  switch (type) {
    case "build":
      result = celebrateBuild(feature, points);
      break;
    case "phase":
      result = celebratePhase(feature, points);
      break;
    case "run":
      result = celebrateRun(feature, points);
      break;
    default:
      usage();
  }

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main();
