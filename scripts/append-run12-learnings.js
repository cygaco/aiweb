// Append run-12 learnings via canonical logger
const { logLearning } = require("./hooks/lib/logger");

const learnings = [
  {
    intent: "event-pattern",
    tip: "node -e with fs writes hits merge-guard ~9x/run; route mutations through scripts/<name>.js or Edit/Write tools",
    conditions: {
      run: "skeleton-test12",
      window: "2026-04-28..2026-04-29",
      events: 9,
      hook: "merge-guard",
      action: "merge-guard-blocked",
    },
    source: "learn:events",
  },
  {
    intent: "dispatch-failure",
    tip: "dispatch-unknown fired 9x with target=unknown; dispatcher must require explicit role+feature args before logging",
    conditions: {
      run: "skeleton-test12",
      events: 9,
      action: "dispatch-unknown",
      target: "unknown",
    },
    source: "learn:events",
  },
  {
    intent: "tool-churn",
    tip: "scripts/dispatch/gui.js edited 8x in 27min indicates iterate-on-error loop; require local syntax+smoke check before each Edit",
    conditions: {
      run: "skeleton-test12",
      file: "scripts/dispatch/gui.js",
      edits: 8,
      span_min: 27,
    },
    source: "learn:events",
  },
  {
    intent: "tool-churn",
    tip: "oneshot/.system/store.json rewritten 8x via Write across 9hr; treat as journaled state, prefer atomic Edit patches",
    conditions: {
      run: "skeleton-test12",
      file: ".claude/agents/02-oneshot/.system/store.json",
      edits: 8,
      span_hr: 9,
    },
    source: "learn:events",
  },
  {
    intent: "audit-pattern",
    tip: "merge-unknown logged with detail='[object Object]' 6x; logger callsite must stringify payload before passing to detail",
    conditions: {
      run: "skeleton-test12",
      events: 6,
      action: "merge-unknown",
      bug: "object-stringification",
    },
    source: "learn:events",
  },
  {
    intent: "event-pattern",
    tip: "no-retro-created fired 3x at 500-tool sessions; auto-trigger oneshot:retro skill at 400 tools to avoid silent skip",
    conditions: {
      run: "skeleton-test12",
      events: 3,
      action: "no-retro-created",
      threshold: 500,
    },
    source: "learn:events",
  },
];

for (const l of learnings) {
  try {
    logLearning(l);
    console.log("logged:", l.intent, "—", l.tip.slice(0, 70));
  } catch (e) {
    console.error("failed:", l.intent, e.message);
  }
}

console.log("\nDone. Appended", learnings.length, "learnings.");
