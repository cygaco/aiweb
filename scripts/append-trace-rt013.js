#!/usr/bin/env node
// One-shot: append RT-013 trace + learning per /fix:deep Phase 5.
const { PATHS } = require("./hooks/lib/paths");
const { logEvent } = require("./hooks/lib/logger");
const fs = require("fs");

const trace = {
  id: "RT-013",
  ts: new Date().toISOString(),
  problem_type: "agentic",
  mode: "deep",
  framework_selected: "5-Whys",
  framework_rationale:
    "Regression (it-used-to-work) with clear behavioral symptom; 5-Whys cheaper than bisect because the offending code was obviously in team-guard.",
  history_match:
    "RT-010 claimed team-guard tiered allowlist was not yet implemented — RT-013 corrects: it IS implemented but was silently disabled.",
  problem:
    "Alpha freely dispatched builder/fixer/evaluator/compliance/qa/redteam build-chain agents in adhoc mode despite team-guard being registered as a PreToolUse hook.",
  root_cause:
    "team-guard.js wrote a debug log to .claude/logs/ (non-existent dir), threw ENOENT, was caught by the OUTER try/catch which exited 0 = allow. The debug line was placed inside the same try-block as the guard decision, so any I/O failure silently disabled the guard.",
  fix: "Wrapped debug-log write in its own try/catch with mkdirSync recursive, moved target dir to .claude/runtime/ (always exists). Guard decision path now isolated from logging failures.",
  quality_score: 3,
  source: "fix:deep",
  learning_id: "LN-team-guard-silent-fail",
};
fs.appendFileSync(PATHS.tracesFile, JSON.stringify(trace) + "\n");

const learning = {
  ts: new Date().toISOString().slice(0, 10),
  id: "LN-team-guard-silent-fail",
  intent: "bug_fix",
  tip: "Never place debug-logging I/O inside the same try-block as the core guard decision. A failed write will trigger the outer catch and silently disable the hook. Wrap debug writes in their own try/catch + mkdirSync.",
  effective: null,
  pending_validation: true,
  score: 0,
  source: "fix:deep",
  trace_id: "RT-013",
};
fs.appendFileSync(PATHS.learningsFile, JSON.stringify(learning) + "\n");

logEvent(
  "fix_applied",
  "alpha",
  "team-guard-silent-fail",
  "RT-013",
  "Wrapped team-guard debug log in its own try/catch to prevent ENOENT from disabling guard decision",
);

console.log("Logged RT-013 trace + LN-team-guard-silent-fail learning");
