#!/usr/bin/env node
// PreToolUse hook: enforces dependency-based gating for builder agents.
// Blocks builder dispatch if dependency features have not passed evaluation.

const fs = require("fs");
const path = require("path");
const { getDeps, getFeatureIds } = require("./lib/project-config");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

// Load dependency map from project config (no hardcoded feature names)
const DEPS = getDeps();
const FEATURE_NAMES = getFeatureIds();

// Non-builder role keywords — if present, skip gating.
// Matches adhoc agent names (Batch A rename 2026-04-17): security→redteam, fix→fixer.
const SKIP_ROLES = [
  "reviewer",
  "evaluator", // legacy alias
  "redteam",
  "fixer",
  "learner",
  "auditor", // legacy alias
  "compliance",
  "qa",
];

function loadStore() {
  let agentsDir;
  try {
    const { PATHS: _P } = require("./lib/paths");
    agentsDir = _P.agents;
  } catch {
    /* fallback */
  }
  const storePath = agentsDir
    ? path.join(agentsDir, "store.json")
    : path.resolve(__dirname, "..", "..", ".claude", "agents", "store.json");
  try {
    return JSON.parse(fs.readFileSync(storePath, "utf8"));
  } catch {
    return null;
  }
}

function isBuilderDispatch(prompt) {
  const lower = prompt.toLowerCase();

  // Check for non-builder roles first
  for (const role of SKIP_ROLES) {
    if (lower.includes(role)) return false;
  }

  // Must contain builder indicator
  if (!lower.includes("build-") && !lower.includes("builder")) return false;

  return true;
}

function identifyFeature(prompt) {
  // Primary: match explicit "feature: <name>" declaration (case-insensitive)
  // Boss MUST include this in every builder prompt. See HYGIENE Rule 13.
  const declMatch = prompt.match(/feature:\s*([a-z][a-z0-9-]*)/i);
  if (declMatch) {
    const declared = declMatch[1].toLowerCase();
    if (FEATURE_NAMES.includes(declared)) return declared;
  }

  // Fallback: match "build-<name>" task ID pattern (from TASK-MANIFEST)
  const taskMatch = prompt.match(/build-([a-z][a-z0-9-]*)/i);
  if (taskMatch) {
    const taskFeature = taskMatch[1].toLowerCase();
    if (FEATURE_NAMES.includes(taskFeature)) return taskFeature;
  }

  // No match — allow dispatch (don't block on unknown features)
  return null;
}

function checkFoundationDeps(store) {
  // All foundation-* features must be "done"
  const foundationFeatures = Object.keys(store.features).filter((k) =>
    k.startsWith("foundation-"),
  );
  const blockers = [];
  for (const f of foundationFeatures) {
    const status = store.features[f]?.status;
    if (status !== "done") {
      blockers.push(`${f} is "${status}" (needs "done")`);
    }
  }
  return blockers;
}

function checkDeps(feature, store) {
  const deps = DEPS[feature];
  if (!deps) return []; // No known deps, allow

  const blockers = [];

  for (const dep of deps) {
    if (dep === "foundation") {
      blockers.push(...checkFoundationDeps(store));
      continue;
    }

    const entry = store.features[dep];
    if (!entry) {
      blockers.push(`${dep} not found in store`);
      continue;
    }

    // Foundation deps (starting with "foundation-") always pass if "done"
    if (dep.startsWith("foundation-")) {
      if (entry.status !== "done") {
        blockers.push(`${dep} is "${entry.status}" (needs "done")`);
      }
      continue;
    }

    // Non-foundation deps need at least "eval_pass" or "done"
    const passing = ["eval_pass", "security_pass", "done"];
    if (!passing.includes(entry.status)) {
      blockers.push(`${dep} is "${entry.status}" (needs at least "eval_pass")`);
    }
  }

  return blockers;
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const prompt = event.tool_input?.prompt || "";

    // Only gate Agent tool calls with builder dispatches
    if (!prompt || !isBuilderDispatch(prompt)) process.exit(0);

    const feature = identifyFeature(prompt);
    if (!feature) process.exit(0); // Unknown feature, allow

    const store = loadStore();
    if (!store) {
      process.stderr.write(
        `${YELLOW}[gate-check] WARNING: Could not read store.json, allowing dispatch${RESET}\n`,
      );
      process.exit(0);
    }

    const blockers = checkDeps(feature, store);

    if (blockers.length > 0) {
      process.stderr.write(
        `${RED}[gate-check] BLOCKED: Builder for "${feature}" cannot start.${RESET}\n`,
      );
      process.stderr.write(`${RED}Unmet dependencies:${RESET}\n`);
      for (const b of blockers) {
        process.stderr.write(`${RED}  - ${b}${RESET}\n`);
      }
      process.stderr.write(
        `${YELLOW}Resolve dependency features before dispatching this builder.${RESET}\n`,
      );
      process.exit(2);
    }

    process.stderr.write(
      `${GREEN}[gate-check] OK: "${feature}" deps satisfied, builder allowed.${RESET}\n`,
    );
    process.exit(0);
  } catch {
    process.exit(0);
  }
});
