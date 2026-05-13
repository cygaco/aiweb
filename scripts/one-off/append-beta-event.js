const fs = require("fs");
const path = require("path");
const event = {
  id: "EVT-special-instructions-beta-001",
  ts: new Date().toISOString(),
  cat: "beta",
  actor: "beta",
  session: "yc-application-2026-05-04",
  data: {
    question:
      "Should I ask the user 4 clarifying questions on special-instructions feature, or DECIDE some myself?",
    category: "process",
    answer:
      "DIRECTIVE: write PRD at _requirements/04-features/special-instructions/PRD.md before dispatching Gamma. (β did not directly answer the 4-vs-fewer question, but implied approval-with-constraint by issuing forward directive)",
    escalated: false,
    confidence: 0.85,
    overridden: null,
    user_answer: null,
    topic_tags: [
      "special-instructions",
      "PRD",
      "gamma-dispatch",
      "yc-demo",
      "specs-before-code",
    ],
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
