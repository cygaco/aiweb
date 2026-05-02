#!/usr/bin/env node
/**
 * emit-attestation-events.js — one-shot Batch D helper
 *
 * Emits an `attestation` event per learning with status=current|stale, giving
 * events.jsonl a provenance trail for learning→enforcement pointers.
 *
 * Called once per integrate pass. Future /learn:integrate should emit these
 * inline as part of Phase D attestation.
 *
 * Uses logger.js (appendFileSync — memory-guard allowlisted path).
 */

const { log } = require("../hooks/lib/logger");

// Known-stale (fabricated targets from 2026-04-17 Batch D session)
const STALE = [
  {
    id: 5,
    target: "reference:episodic/audit-pattern",
    reason: "target doc not created",
  },
  {
    id: 6,
    target: "reference:episodic/prompt-sanitization",
    reason: "target doc not created",
  },
  {
    id: 23,
    target: "reference:eval-pyramid",
    reason: "target doc not created",
  },
  {
    id: 30,
    target: "reference:episodic/skill-restructure",
    reason: "target doc not created",
  },
  {
    id: 34,
    target: "reference:episodic/react-session-prop",
    reason: "target doc not created",
  },
  {
    id: 35,
    target: "reference:episodic/prompt-schema",
    reason: "target doc not created",
  },
  {
    id: 36,
    target: "reference:episodic/react-conditional-render",
    reason: "target doc not created",
  },
  {
    id: 43,
    target: "batch-I:evaluator-cwd-check",
    reason:
      "synthetic batch tag; real target is agent:01-adhoc/evaluator+agent:02-oneshot/evaluator",
  },
  {
    id: 87,
    target: "reference:templates/spec-quality-rule",
    reason: "target doc not created",
  },
  { id: 88, target: "reference:naming-rule", reason: "target doc not created" },
];

// Known-current (real targets verified against disk)
const CURRENT = [
  { id: 1, target: "skill:redteam:full" },
  { id: 2, target: "skill:fix:deep" },
  { id: 3, target: "skill:check:requirements" },
  { id: 10, target: "agent:beta" },
  { id: 14, target: "reference:AGENTS.md" },
  { id: 22, target: "skill:skills:cleanup" },
  { id: 33, target: "skill:check:requirements" },
  { id: 39, target: "skill:research:deep" },
  { id: 40, target: "skill:session:write" },
  { id: 47, target: "hook:memory-guard" },
  { id: 49, target: "skill:check:requirements" },
  { id: 68, target: "hook:foundation-guard" },
  { id: 70, target: "skill:warp:check" },
  { id: 71, target: "file:.claude/manifest.json" },
  { id: 72, target: "reference:PROJECT.md" },
  { id: 84, target: "skill:warp:health" },
  { id: 86, target: "skill:check:references" },
  { id: 89, target: "skill:warp:check" },
  { id: 112, target: "code:scripts/hooks/lib/providers.js#runProvider" },
  { id: 113, target: "code:scripts/hooks/lib/providers.js#modelsMatch" },
  { id: 115, target: "hook:memory-guard#cmdForRedirectCheck" },
  { id: 118, target: "script:scripts/warp-setup.js#seedSystems" },
  { id: 120, target: "rule:PROJECT.md#Cross-repo parity with WarpOS" },
  { id: 121, target: "memory:feedback_save_plans" },
];

const verifiedAt = new Date().toISOString();
let staleCount = 0;
let currentCount = 0;

for (const { id, target, reason } of STALE) {
  log("attestation", {
    learning_id: id,
    target,
    status: "stale",
    verified_at: verifiedAt,
    reason,
  });
  staleCount++;
}

for (const { id, target } of CURRENT) {
  log("attestation", {
    learning_id: id,
    target,
    status: "current",
    verified_at: verifiedAt,
  });
  currentCount++;
}

console.log(
  `emitted: ${staleCount} stale + ${currentCount} current attestation events`,
);
