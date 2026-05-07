// One-off: append /fix:deep trace + learning for the dispatch-guide + gemini-cli fix cycle.
// Per A-006 anti-pattern: node -e with fs writes is blocked; use a script.
const { PATHS } = require("../hooks/lib/paths");
const { logLearning } = require("../hooks/lib/logger");
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
  framework_selected: "Differential Diagnosis (Issue 1) + RCA (Issue 2)",
  framework_rationale:
    "Issue 1 (gemini-3.1-pro 404) is a Tool/CLI environment mismatch with multiple plausible causes (CLI version, account entitlement, ID format) — DD enumerates and tests. Issue 2 (dispatch-guide auto-load gap) is a recurring agentic-system failure — RCA finds the root cause behind a third recurrence after LRN-2026-04-17-n + LRN-2026-04-30.",
  history_match: null,
  problem:
    "Two infrastructure gaps post-build: (1) gemini-3.1-pro 404 on gemini-cli 0.35.3 stale registry; (2) agent-dispatch-guide.md not auto-loaded into agent contexts.",
  root_cause:
    "(1) gemini-cli ships model registry with the binary; v0.35.3 predates the 3.1 family. (2) No mandatory-read directive nor SessionStart inject for agent-dispatch-guide.md — orchestrators (Gamma/Delta/Alpha) had no signal forcing them to consult it before build-chain dispatch.",
  fix: "Sharpened providers.js strict-failure error to point at upgrade path + ISS-003. Added MANDATORY READ for agent-dispatch-guide.md to gamma.md and delta.md startup lists. Added always-inject MANDATORY REFERENCE block to session-start.js so every session surfaces the guide path.",
  quality_score: 3,
  source: "fix:deep",
  learning_id: "LRN-2026-05-07-dispatch-guide-and-gemini-cli",
};

fs.appendFileSync(PATHS.tracesFile, JSON.stringify(trace) + "\n");
console.log("trace_appended:" + next);

logLearning({
  intent: "agent-tooling",
  tip: "Auto-load agent-dispatch-guide.md at session start. Gamma/Delta list it in their startup-read sequence; SessionStart hook injects MANDATORY REFERENCE block pointing to it. Without this, orchestrators bypass the canonical dispatch path and re-hit LRN-2026-04-17-n class bugs (claude -p Windows stdin) and wrong output dirs.",
  conditions: {
    related_lrn: [
      "LRN-2026-04-17-n",
      "LRN-2026-04-30",
      "LRN-2026-05-07-dispatch-guide-and-gemini-cli",
    ],
    fix_files: [
      ".claude/agents/00-alex/gamma.md",
      ".claude/agents/00-alex/delta.md",
      "scripts/hooks/session-start.js",
      "scripts/hooks/lib/providers.js",
    ],
    evidence:
      "2026-05-06 Gamma session: didn't consult guide → claude -p builder died (LRN-2026-04-17-n recurrence), wrote gauntlet outputs to wrong dir, hand-assembled GAMMA_RESULT instead of delta-aggregate-reviews.js",
  },
  source: "fix:deep",
});
console.log("learning_appended");

logLearning({
  intent: "external_learning",
  tip: "gemini-cli ships its model registry baked into the binary. Stale CLI = ModelNotFoundError on new model IDs even when ai.google.dev/gemini-api/docs/models lists them. Probe path: `npm i -g @google/gemini-cli@latest` first, then re-test. If still 404 after upgrade, it's account entitlement, not code/manifest.",
  conditions: {
    related_iss: ["ISS-003"],
    cli_version_observed: "0.35.3",
    probed_variants_404: [
      "gemini-3.1-pro",
      "gemini-3-pro",
      "models/gemini-3.1-pro",
      "gemini-3-1-pro",
    ],
    default_model_works: true,
  },
  source: "fix:deep",
});
console.log("gemini_learning_appended");
