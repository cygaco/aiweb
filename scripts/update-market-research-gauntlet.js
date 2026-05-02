const fs = require("fs");
const path = require("path");

const storePath = path.join(
  __dirname,
  "../.claude/agents/02-oneshot/.system/store.json",
);
const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
const now = new Date().toISOString();

store.features["market-research"].reviews = {
  evaluator: {
    pass: false,
    score: 32,
    findingsCount: 12,
    reviewedAt: now,
    summaryPath: "score=32-fail",
  },
  redteam: {
    pass: true,
    findingsCount: 5,
    reviewedAt: now,
    summaryPath: "no-HIGH-3-MEDIUM-2-LOW",
  },
  compliance: {
    pass: false,
    findingsCount: 8,
    reviewedAt: now,
    summaryPath: "3-HIGH-COMP-001-002-003",
  },
  qa: {
    pass: false,
    findingsCount: 10,
    reviewedAt: now,
    summaryPath: "2-HIGH-QA-001-002",
  },
};

store.features["market-research"].fixAttempts = 0;
store.features["market-research"].openFindings = [
  "QA-001",
  "QA-002",
  "QA-003",
  "QA-006",
  "QA-007",
  "COMP-001",
  "COMP-002",
  "COMP-003",
  "COMP-004",
  "COMP-005",
  "COMP-006",
  "eval-BD-url-bug",
  "eval-job_apply_link",
  "eval-polling-interval",
  "eval-rgba-colors",
  "eval-raw-buttons",
  "eval-ticket-model-GS-MKT-29-39",
];

store.heartbeat = {
  cycle: 5,
  phase: 3,
  feature: "market-research",
  agent: "delta",
  status: "gauntlet-fix1",
  cycleStep: "dispatching-fixer",
  workstream: null,
  timestamp: now,
  note: "Gauntlet complete: eval=32/FAIL, redteam=PASS, compliance=FAIL, qa=FAIL — dispatching fix-1",
};

fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
console.log("store updated: market-research gauntlet results recorded");
