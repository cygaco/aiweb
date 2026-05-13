const fs = require("fs");
const path = require("path");
const event = {
  id: "EVT-special-instructions-beta-002",
  ts: new Date().toISOString(),
  cat: "beta",
  actor: "beta",
  session: "yc-application-2026-05-04",
  data: {
    question:
      "Should I ask user 4 clarifying questions, or DECIDE some myself?",
    category: "process",
    answer:
      "Beta DECIDE class B 0.87: ask only Q1 (surfaces) ESCALATE-class. Q2 heuristic (only ask when non-residential), Q3 yes-readback, Q4 yes-bind",
    escalated: false,
    confidence: 0.87,
    overridden: false,
    user_answer: null,
    topic_tags: ["special-instructions", "ask-vs-decide", "scoping", "yc-demo"],
    alpha_alignment:
      "agree on Q1+Q3+Q4. DIVERGE on Q2: Alpha picked always-ask, Beta picked heuristic. Alpha overrides Beta on Q2 (demo reliability beats UX elegance — silent-skip failure mode + brittle classification + YC demo requires guaranteed prompt for parking-lot scenario).",
  },
};
const file = path.join(
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
fs.appendFileSync(file, JSON.stringify(event) + "\n", "utf8");
console.log("Beta event appended:", event.id);
