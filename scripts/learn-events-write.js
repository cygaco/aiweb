#!/usr/bin/env node
/**
 * learn-events-write.js
 * Appends event-sourced learnings via canonical logLearning() helper.
 * Each entry cites evidence (counts, actions) from events.jsonl scan.
 * Source: /learn:events, 2026-04-21 (skeleton-test8 + prior 7d).
 */
const { logLearning } = require("./hooks/lib/logger");

const today = "2026-04-21";
const source = "learn:events";

const learnings = [
  {
    intent: "audit_anomaly",
    tip: "dispatch-unknown audits outnumber known-role dispatches ~8.7x across history (321 unknown vs 37 builder/evaluator/fixer/compliance/security; 121 vs 0 in last 7d). The dispatch audit hook is mis-classifying role taxonomy — likely defaulting to 'unknown' when actor/target parsing fails. Fix the classifier in the dispatch-audit hook (check agent slug against known role list before emitting 'unknown').",
    conditions: {
      source: "events.jsonl",
      category: "audit",
      action: "dispatch-unknown",
      evidence:
        "121 dispatch-unknown vs 0 dispatch-known in 7d; 321 vs 37 all-time",
    },
  },
  {
    intent: "hook_friction",
    tip: "merge-guard blocks `node -e` with fs writes 44x all-time (40x in 7d). Callers keep trying the same thing. Workaround pattern: write a `scripts/<name>.js` file and run it. Consider adding a clearer error message that suggests creating a script, and/or updating skill prompts so `/learn:events`, hooks docs, and examples stop modeling the forbidden `node -e` pattern.",
    conditions: {
      source: "events.jsonl",
      category: "audit",
      action: "merge-guard-blocked",
      evidence: "44 merge-guard-blocked all-time, 40 in last 7d",
    },
  },
  {
    intent: "spec_drift",
    tip: "1,351 spec events carry `propagation_status:pending` (415 in 7d). Propagation queue is not being drained. Either the propagation worker never runs, or hooks emit pending without a consumer. Investigate the propagation pipeline — either wire a drain step into the session loop, or downgrade pending-emission when no propagation is actually required.",
    conditions: {
      source: "events.jsonl",
      category: "spec",
      field: "propagation_status",
      evidence: "1351 pending all-time, 415 in last 7d",
    },
  },
  {
    intent: "tool_hotspot",
    tip: "Top edit hotspots in 7d: karpathy run worktrees (jobhunter-app-karpathy-*) were edited 132+ times across 6 directories. When a karpathy run is active, expect its worktree to dominate edit metrics — exclude or tag karpathy-worktree edits separately in future hotspot analyses so signal on the live project isn't swamped.",
    conditions: {
      source: "events.jsonl",
      category: "tool",
      tool: "Edit|Write",
      evidence:
        "jobhunter-app-karpathy-* appears in 6 of top 10 edit hotspots (53+23+23+22+21+18 = 160 edits)",
    },
  },
  {
    intent: "hotspot_churn",
    tip: "src/lib/auth.ts edited 12 times in 7d, read 99 times all-time. Auth is the most-churned product file — candidate for 'unstable skeleton surface' in Phase-1 isolation (matches the auth-leaked-to-main-repo worktree signal). Freeze auth.ts behind a spec-lock or move authoritative copy to a worktree-only path for the next skeleton run.",
    conditions: {
      source: "events.jsonl",
      category: "tool",
      file: "src/lib/auth.ts",
      evidence:
        "12 edits in 7d, 99 file-event references all-time; Phase-1 leak mentioned in prior context",
    },
  },
  {
    intent: "memory_pressure",
    tip: "learning-count-high warns fired 40x (21x in 7d) on the sequence 130→128 active learnings vs a 100 target. The warning is emitted on every learning write until the count drops below threshold, producing log spam. Either raise the threshold, throttle the warn, or actually prune — 40 duplicate warnings in events.jsonl is pure noise.",
    conditions: {
      source: "events.jsonl",
      category: "audit",
      action: "learning-count-high",
      evidence:
        "40 all-time, 21 in 7d; sample details: '130 active learnings exceeds 100 target'",
    },
  },
  {
    intent: "process_gap",
    tip: "no-retro-created fired 57x all-time (15x in 7d). Sessions routinely end without a retro — a 26% retro-miss rate given ~57 sessions tracked. Wire /retro:full into /session:stop (or the skeleton run finale) so retros are opt-out not opt-in.",
    conditions: {
      source: "events.jsonl",
      category: "audit",
      action: "no-retro-created",
      evidence: "57 all-time, 15 in 7d",
    },
  },
  {
    intent: "spec_direction_imbalance",
    tip: "Spec propagation direction is 4:1 downstream over upstream (1096 downstream vs 271 upstream). Upstream propagation is underused — spec-change flow is spec→code, but code→spec reverse-propagation is rare. Confirms the 'truth hierarchy: event-sourced, docs-first' discipline from memory; but also suggests reverse-detection hooks may be missing.",
    conditions: {
      source: "events.jsonl",
      category: "spec",
      field: "direction",
      evidence: "1096 downstream, 271 upstream (4:1)",
    },
  },
  {
    intent: "correction_pattern",
    tip: "In last 7d the 'stop' correction keyword fired 8x in user prompts — 57% of all correction-phrase prompts (14 total). 'stop' is a significant signal for runaway autonomous loops. Consider surfacing recent 'stop' events in session-start dashboard so Alex reviews what was halted and why before resuming.",
    conditions: {
      source: "events.jsonl",
      category: "prompt",
      keyword: "stop",
      evidence: "8/14 correction prompts in 7d were 'stop'",
    },
  },
];

let written = 0;
let failed = 0;
for (const l of learnings) {
  const ok = logLearning({
    ts: today,
    intent: l.intent,
    tip: l.tip,
    conditions: l.conditions,
    fix_quality: null,
    score: 0,
    source,
    status: "logged",
  });
  if (ok) {
    written++;
    console.log(`[ok] ${l.intent}: ${l.tip.slice(0, 80)}...`);
  } else {
    failed++;
    console.error(`[fail] ${l.intent}`);
  }
}
console.log(`\nWROTE ${written} learnings (${failed} failed)`);
