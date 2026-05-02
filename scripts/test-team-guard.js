#!/usr/bin/env node
// Synthetic test matrix for scripts/hooks/team-guard.js
// Run with: node scripts/test-team-guard.js

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const HOOK = path.resolve(__dirname, "hooks", "team-guard.js");
const MODE_PATH = path.resolve(
  __dirname,
  "..",
  ".claude",
  "runtime",
  "mode.json",
);

function setMode(mode) {
  fs.writeFileSync(
    MODE_PATH,
    JSON.stringify({ mode, setAt: new Date().toISOString() }, null, 2) + "\n",
  );
}

function runHook(event) {
  const res = spawnSync("node", [HOOK], {
    input: JSON.stringify(event),
    encoding: "utf8",
  });
  let decision = null;
  if (res.stdout) {
    try {
      decision = JSON.parse(res.stdout).decision;
    } catch {}
  }
  return { exitCode: res.status, decision, stdout: res.stdout.trim() };
}

const tests = [
  // === Adhoc mode ===
  {
    mode: "adhoc",
    name: "adhoc: builder → block",
    event: { tool_name: "Agent", tool_input: { subagent_type: "builder" } },
    expect: "block",
  },
  {
    mode: "adhoc",
    name: "adhoc: fixer → block",
    event: { tool_name: "Agent", tool_input: { subagent_type: "fixer" } },
    expect: "block",
  },
  {
    mode: "adhoc",
    name: "adhoc: evaluator → block",
    event: { tool_name: "Agent", tool_input: { subagent_type: "evaluator" } },
    expect: "block",
  },
  {
    mode: "adhoc",
    name: "adhoc: redteam → block",
    event: { tool_name: "Agent", tool_input: { subagent_type: "redteam" } },
    expect: "block",
  },
  {
    mode: "adhoc",
    name: "adhoc: beta teammate (type) → allow",
    event: { tool_name: "Agent", tool_input: { subagent_type: "beta" } },
    expect: "allow",
  },
  {
    mode: "adhoc",
    name: "adhoc: gamma teammate (type) → allow",
    event: { tool_name: "Agent", tool_input: { subagent_type: "gamma" } },
    expect: "allow",
  },
  {
    mode: "adhoc",
    name: "adhoc: Beta (β) by name → allow",
    event: { tool_name: "Agent", tool_input: { name: "Beta (β)" } },
    expect: "allow",
  },
  {
    mode: "adhoc",
    name: "adhoc: Explore → allow",
    event: { tool_name: "Agent", tool_input: { subagent_type: "Explore" } },
    expect: "allow",
  },
  {
    mode: "adhoc",
    name: "adhoc: Plan → allow",
    event: { tool_name: "Agent", tool_input: { subagent_type: "Plan" } },
    expect: "allow",
  },
  {
    mode: "adhoc",
    name: "adhoc: general-purpose → allow",
    event: {
      tool_name: "Agent",
      tool_input: { subagent_type: "general-purpose" },
    },
    expect: "allow",
  },
  {
    mode: "adhoc",
    name: "adhoc: BYPASS ATTEMPT — builder with name=beta-builder",
    event: {
      tool_name: "Agent",
      tool_input: { subagent_type: "builder", name: "beta-builder" },
    },
    expect: "block",
  },

  // === Oneshot mode ===
  {
    mode: "oneshot",
    name: "oneshot: builder → allow (Delta dispatches)",
    event: { tool_name: "Agent", tool_input: { subagent_type: "builder" } },
    expect: "allow",
  },
  {
    mode: "oneshot",
    name: "oneshot: delta → allow",
    event: { tool_name: "Agent", tool_input: { subagent_type: "delta" } },
    expect: "allow",
  },
  {
    mode: "oneshot",
    name: "oneshot: evaluator → allow",
    event: { tool_name: "Agent", tool_input: { subagent_type: "evaluator" } },
    expect: "allow",
  },

  // === Solo mode ===
  {
    mode: "solo",
    name: "solo: builder → allow",
    event: { tool_name: "Agent", tool_input: { subagent_type: "builder" } },
    expect: "allow",
  },

  // === Tool passthrough ===
  {
    mode: "adhoc",
    name: "adhoc: non-Agent tool (Bash) → allow",
    event: { tool_name: "Bash", tool_input: { command: "ls" } },
    expect: "allow",
  },
];

let passed = 0;
let failed = 0;
const originalMode = fs.existsSync(MODE_PATH)
  ? fs.readFileSync(MODE_PATH, "utf8")
  : null;

for (const t of tests) {
  setMode(t.mode);
  const { decision } = runHook(t.event);
  const got = decision === "block" ? "block" : "allow";
  const ok = got === t.expect;
  if (ok) {
    passed++;
    process.stdout.write(`  ✓ ${t.name}\n`);
  } else {
    failed++;
    process.stdout.write(`  ✗ ${t.name} — expected ${t.expect}, got ${got}\n`);
  }
}

// Restore original mode
if (originalMode !== null) {
  fs.writeFileSync(MODE_PATH, originalMode);
} else {
  try {
    fs.unlinkSync(MODE_PATH);
  } catch {}
}

process.stdout.write(
  `\n${passed}/${tests.length} passed${failed ? `, ${failed} failed` : ""}\n`,
);
process.exit(failed === 0 ? 0 : 1);
