// Append /learn:events 7-day learnings via canonical helper.
// Run once: `node scripts/learn/append-events-7d-learnings.js`
const path = require("path");
const { logLearning } = require(
  path.join(__dirname, "..", "hooks", "lib", "logger"),
);

const learnings = [
  {
    intent: "audit_log_noise",
    tip: "WHEN reasoning about audit-log signal-to-noise: `bash-allowed` is 3053/4129 audit events in 7d (74%). Every Bash call emits one. Either downgrade to a counter (single rollup event per session) or filter from `cat:audit` consumers — current ratio drowns real guard activity (merge-guard:57, memory-guard:6) in allow-spam.",
    conditions: {
      scope: "events.jsonl audit category",
      trigger: "audit log analysis or hook telemetry tuning",
      evidence:
        "bash-allowed=3053 vs all blocked-actions=66 in 7d (46:1 noise ratio)",
    },
    source: "learn:events",
    pending_validation: true,
    score: 0,
    status: "logged",
    importance: "low",
  },
  {
    intent: "context_thrash",
    tip: "WHEN context-loading the same files repeatedly: `.claude/paths.json` was Read 42×, `.claude/manifest.json` 34×, `.claude/agents/00-alex/.system/beta/` 65× in 7d. These are session-stable identity files. Cache them in smart-context's preamble (load once per session, inject as text) instead of re-reading on every prompt — 141 redundant disk reads/week of pure repetition.",
    conditions: {
      scope: "smart-context / session loading",
      trigger:
        "Read tool targeting paths.json, manifest.json, beta/* repeatedly within a session",
      evidence:
        "Read counts in 7d: paths.json=42, manifest.json=34, beta dir=65",
    },
    source: "learn:events",
    pending_validation: true,
    score: 0,
    status: "logged",
    importance: "medium",
  },
  {
    intent: "spec_hotspot",
    tip: "WHEN deciding which spec to lock or freeze: `requirements/05-features/backend/PRD.md` is the single most-edited file in 7d — 37 spec events, 35 Edits, all marked `propagated:false`. That's both the most-churned spec AND the worst propagation backlog. Either freeze the PRD pending Phase-1 backend stabilization, or split it into smaller per-subsystem PRDs so churn doesn't fan into one giant pending-propagation queue.",
    conditions: {
      scope: "spec governance",
      trigger:
        "single-file dominates spec-event and edit metrics simultaneously",
      evidence:
        "backend/PRD.md: 37 spec events + 35 Edits + 37 propagated:false in 7d",
    },
    source: "learn:events",
    pending_validation: true,
    score: 0,
    status: "logged",
    importance: "medium",
  },
  {
    intent: "step_registry_friction",
    tip: "WHEN seeing repeated `step-hardcode-suggest` audits: hook fired 108× in 7d advising the step-registry pattern. Either devs (or Alex) keep hardcoding steps and ignoring the suggestion, or the suggester misclassifies safe literals as violations. Sample 5 of those events to decide: tighten the heuristic, or escalate from `suggest` to `block` so the pattern actually changes.",
    conditions: {
      scope: "step-registry-guard hook",
      trigger: "step-hardcode-suggest firing >100x per week",
      evidence:
        "108 step-hardcode-suggest events in 7d, 0 corresponding fixes logged",
    },
    source: "learn:events",
    pending_validation: true,
    score: 0,
    status: "logged",
    importance: "low",
  },
  {
    intent: "cross_project_edit_pollution",
    tip: "WHEN running inside jobhunter-app: WarpOS/scripts/warp-setup.js was Read 39× and Edited 35× via this project's Alex session. Cross-repo editing from the wrong working tree pollutes the source-of-truth (LRN-2026-04-16-g requires explicit sync). Add a guard: any Edit/Write whose absolute path resolves outside `$CLAUDE_PROJECT_DIR` requires confirmation, or auto-tags the event with `cross_project:true` for filtering.",
    conditions: {
      scope: "tool guards / cross-repo work",
      trigger: "Edit or Write with target path outside the project root",
      evidence:
        "warp-setup.js (in WarpOS/) — 39 reads + 35 edits from jobhunter-app session in 7d",
    },
    source: "learn:events",
    pending_validation: true,
    score: 0,
    status: "logged",
    importance: "medium",
  },
  {
    intent: "agent_messaging_imbalance",
    tip: "WHEN reasoning about α/β/γ collaboration: 7d events show 227 Agent dispatches, 313 TaskUpdate events, but only 40 SendMessage and 156 inbox events. Inter-agent messaging is ~6x rarer than agent dispatches — implies α is dispatching γ but not consulting β nearly as often as the team-mode rules expect. Either the consultation rule is over-stated, or β is being skipped in adhoc runs.",
    conditions: {
      scope: "agent team coordination",
      trigger: "ratio of Agent/TaskUpdate vs SendMessage/inbox over a session",
      evidence: "7d: Agent=227, TaskUpdate=313, SendMessage=40, inbox=156",
    },
    source: "learn:events",
    pending_validation: true,
    score: 0,
    status: "logged",
    importance: "medium",
  },
];

let ok = 0;
for (const l of learnings) {
  const wrote = logLearning(l);
  if (wrote) ok++;
  console.log(
    (wrote ? "OK  " : "SKIP") + " " + l.intent + " — " + l.tip.slice(0, 70),
  );
}
console.log(`\nappended ${ok}/${learnings.length} learnings via logLearning()`);
