const fs = require("fs");
const path = require("path");
const trace = {
  id: "RT-2026-05-04-special-instructions-scoping",
  ts: new Date().toISOString(),
  problem_type: "ux+prioritization",
  mode: "deep",
  framework_selected: "JTBD + Eisenhower",
  hypotheses: [
    "fix all 5 gaps",
    "fix 2 (ASK+SAY) only",
    "fix 4 (ASK+SAY+SEE+TOKEN-BIND), skip profile",
  ],
  outcome:
    "fix 4, skip profile-persistence — JTBD reduces scope from hygiene to demo-critical: customer's job is asks/hears/sees, profile persistence doesn't help a parking-lot demo",
  quality_score: null,
  source: "reasoning:run",
};
const file = path.join(
  __dirname,
  "..",
  "..",
  ".claude",
  "project",
  "memory",
  "traces.jsonl",
);
fs.appendFileSync(file, JSON.stringify(trace) + "\n", "utf8");
console.log("Trace appended:", trace.id);
