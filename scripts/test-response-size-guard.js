#!/usr/bin/env node
// Synthetic test for scripts/hooks/response-size-guard.js

const { spawnSync } = require("child_process");
const path = require("path");

const HOOK = path.resolve(__dirname, "hooks", "response-size-guard.js");

function probe(label, event, expectedTier) {
  const res = spawnSync("node", [HOOK], {
    input: JSON.stringify(event),
    encoding: "utf8",
  });
  const stderr = (res.stderr || "").trim();
  const matched =
    expectedTier === "ok"
      ? stderr === ""
      : stderr.toUpperCase().includes(expectedTier.toUpperCase());
  process.stdout.write(
    `  ${matched ? "✓" : "✗"} ${label}${matched ? "" : ` — got: "${stderr.slice(0, 100)}"`}\n`,
  );
  return matched;
}

const tests = [
  // Non-build-chain: never flagged
  {
    label: "Explore w/ 50KB response → ignored",
    event: {
      tool_name: "Agent",
      tool_input: { subagent_type: "Explore" },
      tool_response: "x".repeat(50_000),
    },
    expected: "ok",
  },
  // Builder small: ok
  {
    label: "builder w/ 1KB response → ok",
    event: {
      tool_name: "Agent",
      tool_input: { subagent_type: "builder" },
      tool_response: "x".repeat(1_000),
    },
    expected: "ok",
  },
  // Builder warn tier
  {
    label: "builder w/ 12KB response → WARN",
    event: {
      tool_name: "Agent",
      tool_input: { subagent_type: "builder" },
      tool_response: "x".repeat(12_000),
    },
    expected: "warn",
  },
  // Evaluator concern tier
  {
    label: "evaluator w/ 64KB response → CONCERN",
    event: {
      tool_name: "Agent",
      tool_input: { subagent_type: "evaluator" },
      tool_response: "x".repeat(64_000),
    },
    expected: "concern",
  },
  // Object response with content field
  {
    label: "fixer w/ object response 100KB → CONCERN",
    event: {
      tool_name: "Agent",
      tool_input: { subagent_type: "fixer" },
      tool_response: { content: "y".repeat(100_000) },
    },
    expected: "concern",
  },
  // Bash tool: never affected
  {
    label: "Bash tool → ignored",
    event: {
      tool_name: "Bash",
      tool_input: { command: "ls" },
      tool_response: "x".repeat(50_000),
    },
    expected: "ok",
  },
];

let passed = 0;
let failed = 0;
for (const t of tests) {
  if (probe(t.label, t.event, t.expected)) passed++;
  else failed++;
}

process.stdout.write(
  `\n${passed}/${tests.length} passed${failed ? `, ${failed} failed` : ""}\n`,
);
process.exit(failed === 0 ? 0 : 1);
