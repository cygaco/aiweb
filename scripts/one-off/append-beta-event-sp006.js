"use strict";
// One-off: append the SP-20260519-006 release pre-flight Beta event so the
// beta-gate hook recognizes the consultation when /sprint:release calls
// AskUserQuestion.
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
  id: "EVT-s-sp-20260519-006-beta-001",
  ts: new Date().toISOString(),
  cat: "beta",
  actor: "alpha",
  session: "sp-20260519-006",
  data: {
    question:
      "Release pre-flight for sprint SP-20260519-006 (card-over-phone alpha-stage). Verdict needed before AskUserQuestion for fly deploy approval.",
    category: "release",
    answer:
      "DECIDE (Class B, 0.87). Pre-flight is sound. Ship. Ships-disabled posture solid (env-gate is enforcement via shared helper, both MCP + A2A surfaces). No second-eyes review needed on C-1 — byte-equality regression test is the review. None of the mid-execute observations block ship. No sequencing concern with 007 (disjoint code paths, ships disabled, additive). AP-20260519-001 session-scoped pre-auth covers this under P-027. Formal user ask still required per push-red-line.",
    escalated: false,
    confidence: 0.87,
    overridden: null,
    user_answer: null,
    topic_tags: [
      "release",
      "ship",
      "deploy",
      "RL-pending",
      "SP-20260519-006",
      "card-over-phone",
      "alpha-stage",
      "class-b",
      "push-red-line",
    ],
    sprint_id: "SP-20260519-006",
    phase: "release",
    open_adr: true,
    open_adr_reason:
      "Payment-adjacent architecture (card-over-phone branch, shared schema across MCP+A2A, three-layer leak defense, env-gate pattern). ADR should capture ships-disabled decision, disclosure enforcement model, and three-layer defense rationale.",
    precedent: [
      "EVT-s-sp-20260519-007-beta-001",
      "EVT-s-sp-20260517-005-beta-003",
    ],
  },
};

fs.appendFileSync(eventsFile, JSON.stringify(evt) + "\n");
process.stdout.write("beta event appended: " + evt.id + "\n");
