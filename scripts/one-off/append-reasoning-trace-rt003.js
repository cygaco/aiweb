// One-off: append /reasoning:run trace for the gemini-3.1 entitlement deliberation.
const { PATHS } = require("../hooks/lib/paths");
const fs = require("fs");

const lines = fs.existsSync(PATHS.tracesFile)
  ? fs
      .readFileSync(PATHS.tracesFile, "utf8")
      .split("\n")
      .filter((l) => l.trim())
  : [];
const next = "RT-" + (lines.length + 1).toString().padStart(3, "0");

const trace = {
  id: next,
  ts: new Date().toISOString(),
  problem_type: "strategy",
  mode: "deep",
  framework_selected:
    "JTBD + Eisenhower (lens), steelman + first-impulse + zoom",
  framework_rationale:
    "Decision-shape: user directive (stay on 3.1) collides with constraint surfaced after directive (API key project lacks 3.1 entitlement, v1beta ModelNotFoundError). JTBD revealed the actual job (3.1-class adversarial reasoning, not literal model id); Eisenhower placed it as important-but-not-urgent (build ships at 3/4 already).",
  hypotheses: [
    "(1) tell user to enable 3.1 preview at aistudio.google.com",
    "(2) check for second API key with 3.1 access",
    "(3) accept temporary downgrade to 2.5-flash",
    "(4) leave redteam infra_blocked",
  ],
  outcome:
    "(1) — escalate to user with specific 1-minute action. Steelman test (dispatch-script path with --skip-trust patch) confirmed 3.1 404 is not a CLI/auth/transport issue; it's API-level entitlement on the project tied to the API key. Refused silent downgrade per user directive.",
  evidence_path:
    "providers.js patched twice (--skip-trust + sharpened error msg); raw probe + dispatch probe both yield ModelNotFoundError with v1beta API; 2.5-flash works on same key",
  quality_score: null,
  source: "reasoning:run",
};

fs.appendFileSync(PATHS.tracesFile, JSON.stringify(trace) + "\n");
console.log("trace_appended:" + next);
