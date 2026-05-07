#!/usr/bin/env node
/* One-off: append /fix:deep trace + learning for the Gamma codex-dispatch silent-death investigation. */
const fs = require("fs");
const path = require("path");
const { PATHS } = require("../hooks/lib/paths");

const ts = new Date().toISOString();

const trace = {
  id: "RT-004",
  ts,
  framework_selected: "agentic-system-protocol + trace-analysis",
  framework_rationale:
    "Symptoms (silent 0-byte deaths, stale lock files, no .err output) match the agentic-system signature exactly. Trace-analysis added because the failure had to be located along the dispatch chain (Gamma → bash → codex CLI → output file).",
  history_match:
    "LRN-2026-04-17-n + LRN-12 (2026-05-07) — claude/codex Windows-stdin silent-death class",
  problem:
    "All 7 of Gamma's openai dispatches died with 0-byte output and 0-byte .err on feat/menu-discovery gauntlet attempt; 7 stale locks held by dead PIDs.",
  root_cause:
    "Gamma's dispatches bypassed runProvider/dispatch-agent.js and invoked codex via raw bash/cmd.exe, re-triggering LRN-2026-04-17-n. Confirmed by direct probe: runProvider with the actual 191KB reviewer prompt completes successfully in 197s and returns a 6206-char real review. So the canonical path works; only Gamma's dispatch route was broken.",
  fix: "Alpha-driven gauntlet: scripts/one-off/run-gauntlet-alpha.js calls runProvider for reviewer+compliance+qa sequentially against the existing prompt files in .claude/runtime/dispatch/. Bypasses Gamma until Gamma's dispatch path is repaired.",
  quality_score: 3,
  source: "fix:deep",
  learning_id: "LRN-2026-05-07-gamma-dispatch-bypass",
  blast_radius: "low",
  notes:
    "Quality scored 3 (not 4): the fix is a workaround that gets the gauntlet running for this sprint, not a structural fix to Gamma's dispatcher. Score 4 would require a guard hook + agent-spec rule that PREVENTS the binding-gap from recurring (logged as warpos-flag).",
};

const learning = {
  ts: ts.slice(0, 10),
  intent: "agent-tooling",
  tip: "When build-chain dispatch from an orchestrator agent (Gamma/Delta) returns 0-byte output AND 0-byte .err on Windows, the orchestrator likely bypassed runProvider. Test the canonical path immediately with a direct runProvider call from a probe script (scripts/one-off/probe-codex-large-prompt.js pattern) — if it works for the same prompt, the orchestrator's invocation route is the bug, not the CLI/auth/quota. Recovery: Alpha-driven gauntlet via runProvider directly until orchestrator dispatch is fixed.",
  conditions: {
    related_lrn: ["LRN-2026-04-17-n", "LRN-2026-04-30", "LRN-12-2026-05-07"],
    pattern: "binding-gap-recurrence",
    hard_rule: true,
    evidence:
      "feat/menu-discovery gauntlet 2026-05-07: all 7 Gamma dispatches died silently; Alpha probe via runProvider with the same 191KB prompt returned a real 6206-char review in 197s; stale locks held by dead PIDs.",
    symptom: "silent 0-byte dispatch with 0-byte .err + stale lock files",
    fix_path:
      "scripts/one-off/run-gauntlet-alpha.js — uses runProvider directly; Alpha-side recovery when Gamma is broken",
  },
  effective: null,
  pending_validation: true,
  score: 0,
  source: "fix:deep",
  id: "LRN-2026-05-07-gamma-dispatch-bypass",
};

fs.appendFileSync(PATHS.tracesFile, JSON.stringify(trace) + "\n");
fs.appendFileSync(PATHS.learningsFile, JSON.stringify(learning) + "\n");

console.log("trace appended:", trace.id);
console.log("learning appended:", learning.id);
console.log("traces file:", PATHS.tracesFile);
console.log("learnings file:", PATHS.learningsFile);
