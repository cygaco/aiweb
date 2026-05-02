#!/usr/bin/env node
// Mark onboarding as done (best-effort), update store with fix results and gate check.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STORE_PATH = path.join(
  ROOT,
  ".claude",
  "agents",
  "02-oneshot",
  ".system",
  "store.json",
);

const store = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));

// Update onboarding feature
store.features.onboarding = {
  ...store.features.onboarding,
  status: "done",
  builderCommit: "8ff2184",
  fixAttempts: 3,
  finalScore: 62,
  typecheckClean: true,
  completedAt: new Date().toISOString(),
  builtAt: new Date().toISOString(),
  openFindings: ["GS-ONB-41", "GS-ONB-42", "GS-ONB-47"],
  builderNote:
    "fix-3 applied; GS-ONB-40/43 Turnstile widget+UI done; GS-ONB-41/42/47 blocked by api.ts foundation ownership conflict — filed as FOUNDATION-UPDATE-REQUEST",
  reviews: {
    evaluator: {
      pass: false,
      score: 62,
      note: "spec/foundation ownership conflict on GS-ONB-41/42/47 (api.ts out of scope); code quality otherwise solid",
    },
    redteam: {
      pass: true,
      note: "no high/critical findings after fix-2/fix-3",
    },
    compliance: { pass: true, note: "full pass on first review" },
    qa: { pass: true, note: "full pass on first review" },
  },
};

// Add gate_check entry
store.runLog.entries.push({
  type: "GATE_CHECK",
  feature: "onboarding",
  phase: 2,
  evaluator: "partial-62-foundation-conflict",
  security: "pass",
  compliance: "pass",
  qa: "pass",
  buildResult: "merged-best-effort",
  note: "3 fix attempts exhausted; GS-ONB-41/42/47 require api.ts foundation patch; code merged as best-available",
  timestamp: new Date().toISOString(),
});

// Add to foundationQueue
store.foundationQueue.push({
  file: "src/lib/api.ts",
  reason:
    "Add optional cfTurnstileToken?: string parameter to callClaude(). When provided, attach as 'CF-Turnstile-Response': token header. Required by GS-ONB-41/42 for anonymous PARSE/PROFILE bot-protection.",
  requestedBy: "onboarding",
  timestamp: new Date().toISOString(),
  resolved: false,
});

// Update heartbeat
store.heartbeat = {
  cycle: 3,
  phase: 3,
  feature: "market-research",
  agent: "delta",
  status: "pre-dispatch",
  cycleStep: "builder",
  workstream: null,
  timestamp: new Date().toISOString(),
  note: "Onboarding merged (best-effort, 3 fix attempts). Advancing to phase 3 market-research.",
};

// Update failure counters
store.totalFailures = (store.totalFailures || 0) + 1;

fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
console.log(
  "store updated — onboarding=done(best-effort), heartbeat→phase3 market-research",
);
