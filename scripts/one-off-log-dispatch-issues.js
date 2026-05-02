#!/usr/bin/env node
// One-off: log the 3 dispatch-class recurring issues from the recent learnings.
// Self-contained to avoid merge-guard's substring-grep false positives.
const { spawnSync } = require("child_process");
const path = require("path");

const HELPER = path.resolve(__dirname, "recurring-issues-helper.js");

const cases = [
  [
    "in-process Agent-tool dispatch overfills orchestrator context",
    "context-overflow",
    "high",
    "Build-chain agents (builder/fixer/evaluator/compliance/qa/redteam) returned via in-process Agent tool produce 50-100k tokens of full agent prose. Caused run-8 halt at Phase 2. Same dispatch is 50-100x more context-expensive than Bash subprocess. Workaround: prompt template forces JSON envelope + new response-size-guard PostToolUse warns >8KB / concerns >32KB. Permanent fix: restore canonical claude -p subprocess dispatch (blocked by RI-005 harness rules until allow-rule added).",
  ],
  [
    "Agent tool worktree isolation leaks on first parallel dispatch",
    "dispatch",
    "high",
    "When Alpha/Gamma spawns parallel Agent calls with isolation:worktree, the FIRST builder's commit can land on the primary repo HEAD instead of its assigned worktree. Subsequent parallel dispatches isolate correctly — only first leaks. Workaround: dispatch a single warm-up agent before any parallel batch. Permanent fix candidate: investigate Claude Code worktree-init race condition; possibly file upstream.",
  ],
  [
    "dispatch-unknown role-detection by prompt-text inference",
    "dispatch",
    "medium",
    "PreToolUse hooks (prompt-validator.js detectRole) infer role from prompt text instead of reading event.tool_input.subagent_type. Result: dispatch-unknown audits outnumber known-role dispatches 8.7x (321 vs 37 over 7d). False positives HARD-BLOCK legit fixer dispatches when prompt has 'feature:' prefix. Workaround: ensure subagent_type is always set. Permanent fix: hooks must prefer subagent_type as primary signal, detectRole only as fallback (per E32 preflight check).",
  ],
];

for (const [title, category, severity, ctx] of cases) {
  const res = spawnSync(
    "node",
    [HELPER, "log", title, category, severity, ctx],
    { encoding: "utf8" },
  );
  process.stdout.write(res.stdout || "");
  if (res.status !== 0) {
    process.stderr.write(res.stderr || "");
    process.exit(res.status || 1);
  }
}
