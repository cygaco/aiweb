"use strict";
// One-off: append the SP-20260519-007 release pre-flight Beta event so the
// beta-gate hook recognizes the consultation when /sprint:release calls
// AskUserQuestion. The Beta agent's verdict text is recorded inline.
const fs = require("fs");
const path = require("path");

const eventsFile = path.join(
  __dirname,
  "..",
  "..",
  ".claude",
  "agents",
  "00-alex",
  ".system",
  "beta",
  "events.jsonl",
);

const evt = {
  id: "EVT-s-sp-20260519-007-beta-001",
  ts: new Date().toISOString(),
  cat: "beta",
  actor: "alpha",
  session: "sp-20260519-007",
  data: {
    question:
      "Release pre-flight for sprint SP-20260519-007 (deploy of RT-007 quick-win path). Verdict needed before AskUserQuestion for production deploy approval.",
    category: "release",
    answer:
      "DECIDE (Class B, 0.85). Ship 007 standalone, not bundled with 006. Pre-flight sound with one addition: before fly deploy, confirm VM kind supports suspend (fly machine list); if rejected, apply min_machines_running=1 fallback. Mid-execute corrections clear (caught-before-merge, none deferred). Production deploy is a red-line external action — formal user approval still required.",
    escalated: false,
    confidence: 0.85,
    overridden: null,
    user_answer: null,
    topic_tags: [
      "release",
      "ship",
      "deploy",
      "RL-pending",
      "SP-20260519-007",
      "class-b",
      "push-red-line",
    ],
    sprint_id: "SP-20260519-007",
    phase: "release",
    precedent: "EVT-s-sp-20260517-005-beta-003",
  },
};

fs.appendFileSync(eventsFile, JSON.stringify(evt) + "\n");
process.stdout.write("beta event appended: " + evt.id + "\n");
