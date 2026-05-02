#!/usr/bin/env node
/**
 * oneshot-halt.js — Mark Delta run as halted, save DELTA_RESULT envelope.
 *
 * Usage: node scripts/oneshot-halt.js "<halt-reason>"
 */
const fs = require("fs");
const path = require("path");

const haltReason = process.argv[2] || "context budget";

const storePath = path.resolve(
  __dirname,
  "..",
  ".claude",
  "agents",
  "02-oneshot",
  ".system",
  "store.json",
);

const s = JSON.parse(fs.readFileSync(storePath, "utf8"));

// Mark onboarding partial (built + fixed but re-verify incomplete)
if (s.features.onboarding) {
  s.features.onboarding.status = "partial";
  s.features.onboarding.finalScore = 62;
  s.features.onboarding.fixCycles = 1;
  s.features.onboarding.openFindings = [
    "RT-202",
    "RT-203",
    "RT-504",
    "RT-506",
    "RT-NEW-01",
  ];
  s.features.onboarding.completedAt = new Date().toISOString();
  s.features.onboarding.phase = 2;
}

s.runLog = s.runLog || {};
s.runLog.finalStatus = "halted";
s.runLog.haltReason = haltReason;
s.runLog.haltedAt = new Date().toISOString();

s.heartbeat = {
  cycle: s.cycle,
  phase: 2,
  feature: "onboarding",
  agent: "delta",
  status: "halted",
  cycleStep: "halted-for-context-budget",
  workstream: null,
  timestamp: new Date().toISOString(),
};

// Status snapshot for resume
const byStatus = {};
for (const [k, v] of Object.entries(s.features)) {
  const st = v.status || "unknown";
  byStatus[st] = byStatus[st] || [];
  byStatus[st].push(k);
}
s.runLog.statusSnapshot = byStatus;

fs.writeFileSync(storePath, JSON.stringify(s, null, 2));

// Emit DELTA_RESULT envelope to runtime
const envelope = {
  status: "halted",
  halt_reason: haltReason,
  features_completed: byStatus.done || [],
  features_partial: byStatus.partial || [],
  features_pending: byStatus.not_started || [],
  phases_completed: Object.keys(s.runLog.phases || {})
    .map(Number)
    .sort(),
  phases_pending: [2.5, 3, 4, 5, 6, 7],
  gate_checks: [
    {
      feature: "auth",
      evaluator: "pass (94)",
      compliance: "pass (94)",
      redteam: "pass (re-verify closed all P1 findings)",
      qa: "pass (clean personas)",
      auditor: "complete (Rules 62-64 proposed)",
    },
    {
      feature: "rockets",
      evaluator: "pass (92, initial 35 → fix cycle)",
      compliance: "pass (78, initial fail → fix cycle)",
      redteam:
        "pass (P1 closed: RT-203/901, RT-201, RT-202, RT-701, RT-801, RT-902, RT-1001)",
      qa: "pass (14 findings addressed in fix cycle)",
      auditor: "complete",
    },
    {
      feature: "onboarding",
      evaluator: "fail (62 — design violations, open-loop TODO)",
      compliance: "blocked by hook prompt-validator GAP-1101 over-firing",
      redteam:
        "partial (2 CRITICALs closed, 3 HIGH open: RT-202 text cap, RT-203/504/506 storedStep deadcode, RT-NEW-01 PARSE non-JSON)",
      qa: "pass (12 findings, all addressed in fix cycle)",
      auditor: "deferred",
    },
  ],
  points_summary: {
    total_earned: 94 + 92 + 62,
    rank_changes: [],
  },
  total_cycles: s.cycle,
  total_fix_attempts: 2,
  circuit_breaker: s.circuitBreaker,
  resume_plan: {
    next_action: "Phase 2 fix-cycle-2 (3 open HIGH findings)",
    next_phase: "2.5 (shell + profile, parallel)",
    store_state: ".claude/agents/02-oneshot/.system/store.json",
    notes: ".claude/runtime/notes.md section 'delta-oneshot-run-09-issues'",
    open_infra_issues: [
      "I1-I13 documented in notes.md",
      "I5 worktree isolation leak — mitigation: explicit pwd check in prompts is effective",
      "I7 src/lib/rockets.ts orphan foundation file — decide ownership",
      "I13 prompt-validator hook over-firing on non-builder subagents",
    ],
  },
};

const envelopePath = path.resolve(
  __dirname,
  "..",
  ".claude",
  "runtime",
  "DELTA_RESULT.json",
);
fs.writeFileSync(envelopePath, JSON.stringify(envelope, null, 2));
console.log(`Halted. DELTA_RESULT written to ${envelopePath}`);
console.log(`Status: ${envelope.status}`);
console.log(
  `Completed: ${envelope.features_completed.length} (${envelope.features_completed.join(", ")})`,
);
console.log(
  `Partial: ${envelope.features_partial.length} (${envelope.features_partial.join(", ")})`,
);
console.log(`Pending: ${envelope.features_pending.length} features`);
console.log(`Halt reason: ${envelope.halt_reason}`);
