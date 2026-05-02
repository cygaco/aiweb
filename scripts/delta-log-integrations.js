#!/usr/bin/env node
/**
 * delta-log-integrations.js — log /learn:integrate attestation events for
 * run-12 integrations applied in this session.
 */
const { log } = require("./hooks/lib/logger");

const integrations = [
  {
    learning_id: "lrn-2026-04-29-smoke-real-model",
    target: "script:delta-canonical-dispatch-smoke.js",
    tip: "Smoke tests must use the same -m model that real dispatch will use, not CLI default",
    intent: "preflight",
  },
  {
    learning_id: "lrn-2026-04-29-pre-clean-worktrees",
    target: "script:delta-pre-clean-worktrees.js",
    tip: "Pre-clean stale agent/<feature> worktrees at run start (cross-session leak)",
    intent: "worktree-hygiene",
  },
  {
    learning_id: "lrn-2026-04-29-reviewer-scope-filter",
    target: "script:delta-build-reviewer-prompt.js",
    tip: "Reviewer prompts must scope-filter findings to features[<this>].files (eval + comp)",
    intent: "gauntlet",
  },
  {
    learning_id: "lrn-2026-04-28-builder-maxTurns-200",
    target: "agent-spec:builder.md, agent-spec:fixer.md",
    tip: "maxTurns scaling for build-chain agents — committed earlier in run-12",
    intent: "agent-tooling",
  },
  {
    learning_id: "lrn-2026-04-28-providers-timeouts",
    target: "lib:providers.js",
    tip: "runProvider 900s + cliAvailable 30s — committed earlier in run-12",
    intent: "provider-routing",
  },
  {
    learning_id: "lrn-2026-04-28-builder-default-sonnet",
    target: "script:delta-dispatch-builder.js",
    tip: "Builder default opus-4-7 → sonnet-4-6 — committed earlier in run-12",
    intent: "orchestrator-budget",
  },
  {
    learning_id: "lrn-2026-04-28-dispatch-guide",
    target:
      "guide:.claude/agents/.system/guides/agent-dispatch-guide.md, guide:.claude/agents/.system/guides/oneshot-token-guide.md",
    tip: "Bash subprocess dispatch + token-budget tactics — committed earlier in run-12",
    intent: "agent-tooling",
  },
];

for (const i of integrations) {
  log({
    cat: "integration",
    source: "learn:integrate",
    learning_id: i.learning_id,
    target: i.target,
    tip: i.tip.slice(0, 100),
    intent: i.intent,
  });
}

console.log(`logged ${integrations.length} integration events`);
