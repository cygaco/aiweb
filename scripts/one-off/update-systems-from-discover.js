#!/usr/bin/env node
"use strict";

/**
 * Apply /discover:systems run-12 findings to .claude/project/memory/systems.jsonl
 *
 * - Removes 9 SYS-DRIFT entries pointing at missing files (commands moved
 *   into /oneshot:preflight, /oneshot:retro, /learn:deep, etc.)
 * - Adds 10 Emergent entries surfaced by codex GPT-5.5 across angles 2/3/6
 *
 * Source of findings:
 *   .claude/runtime/dispatch/run12/discover-systems-report.md
 *   .claude/runtime/dispatch/run12/check-all-report.md (SYS-DRIFT section)
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const FILE = path.join(REPO, ".claude", "project", "memory", "systems.jsonl");
const today = new Date().toISOString().slice(0, 10);

// IDs to remove (skill stubs that point at deleted command files).
const REMOVE_IDS = new Set([
  "skill-fav-clear",
  "skill-preflight-run",
  "skill-learn-conversation",
  "skill-learn-events",
  "skill-learn-combined",
  "skill-preflight-setup",
  "preflight-workflow",
  "skill-run-sync",
  "skill-retro-full",
]);

// Emergent additions surfaced by /discover:systems run-12.
const EMERGENT_ADDS = [
  {
    id: "warpos-release-tooling",
    category: "release-tooling",
    files: ["scripts/warpos/"],
    notes:
      "Engine scripts behind /warp:promote, /warp:release, /warp:update, /warp:doctor. Discovered by /discover:systems run-12 (angles 2,3,6). Class A: framework-owned.",
    added: today,
  },
  {
    id: "check-scripts",
    category: "quality",
    files: ["scripts/checks/"],
    notes:
      "Quality-gate helpers (contract-versioning, design-system, path-usage, production-baseline). Discovered by /discover:systems run-12 (angles 2,6).",
    added: today,
  },
  {
    id: "path-tooling",
    category: "infrastructure",
    files: ["scripts/paths/"],
    notes:
      "Backing scripts for /paths:* skills (registry, lint, doctor, coverage). Discovered by /discover:systems run-12 (angles 2,3,6).",
    added: today,
  },
  {
    id: "agent-tooling",
    category: "agents",
    files: ["scripts/agents/"],
    notes:
      "Agent infrastructure (output-validator, provider-trace). Discovered by /discover:systems run-12 (angles 2,6).",
    added: today,
  },
  {
    id: "dependency-governance",
    category: "quality",
    files: ["scripts/deps/"],
    notes:
      "Dependency policy + audit tooling. Discovered by /discover:systems run-12 (angles 2,6).",
    added: today,
  },
  {
    id: "runtime-governance",
    category: "orchestration",
    files: ["scripts/runtime/"],
    notes:
      "Runtime state helpers (handoffs, sessions, store sync). Discovered by /discover:systems run-12 (angles 2,6).",
    added: today,
  },
  {
    id: "security-permissions-tooling",
    category: "security",
    files: ["scripts/security/"],
    notes:
      "Permission scanners + secret guards. Discovered by /discover:systems run-12 (angles 2,6).",
    added: today,
  },
  {
    id: "hook-fixtures",
    category: "quality",
    files: ["fixtures/hooks/"],
    notes:
      "Test fixtures for hook regressions; gated by /warp:doctor hook_fixture_tests. Discovered by /discover:systems run-12 (angles 2,6).",
    added: today,
  },
  {
    id: "warpos-release-capsules",
    category: "release-tooling",
    files: ["warpos/releases/"],
    notes:
      "Per-version capsule directories (release.json, framework-manifest.json, checksums.json, changelog.md). Discovered by /discover:systems run-12 (angles 2,3,6).",
    added: today,
  },
  {
    id: "budget-tooling",
    category: "quality",
    files: ["scripts/budgets/"],
    notes:
      "Spend / token budgets. Discovered by /discover:systems run-12 (angles 2,6).",
    added: today,
  },
];

function main() {
  const raw = fs.readFileSync(FILE, "utf8");
  const lines = raw.split(/\r?\n/);

  const kept = [];
  const removed = [];
  const seenIds = new Set();

  for (const line of lines) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      kept.push(line);
      continue;
    }
    if (obj.id && REMOVE_IDS.has(obj.id)) {
      removed.push(obj.id);
      continue;
    }
    if (obj.id) seenIds.add(obj.id);
    kept.push(line);
  }

  // Append emergent additions, skipping any that somehow already exist.
  const added = [];
  for (const entry of EMERGENT_ADDS) {
    if (seenIds.has(entry.id)) continue;
    kept.push(JSON.stringify(entry));
    added.push(entry.id);
  }

  fs.writeFileSync(FILE, kept.join("\n") + "\n");

  console.log(`Removed ${removed.length} ghost entries:`);
  removed.forEach((id) => console.log(`  - ${id}`));
  console.log(`Added ${added.length} emergent entries:`);
  added.forEach((id) => console.log(`  + ${id}`));
  console.log(`Total entries now: ${kept.length}`);
}

main();
