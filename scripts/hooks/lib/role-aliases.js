/**
 * role-aliases.js — canonical-vs-legacy role-name mapping.
 *
 * The 2026-04-29 rename moved `evaluator` → `reviewer` and `auditor` → `learner`.
 * Historical event logs, retros, and old config snapshots still reference the
 * old names — we don't rewrite history. Anywhere we READ role names from data
 * we don't own (events.jsonl, retros, dispatch backups), pass through
 * `normalizeRole(name)` so historical and current data group together.
 *
 * Hooks must NEVER use substring matching to gate roles (`name.includes('eval')`
 * matches `evaluator`, `eval-utils`, anything containing `eval`). The bug class
 * is documented in RT-010. Always: `normalizeRole(role) === "reviewer"`.
 */

"use strict";

/** Map from legacy role name → canonical role name. */
const ROLE_ALIASES = Object.freeze({
  evaluator: "reviewer",
  auditor: "learner",
});

/** Reverse map: canonical → legacy (for env-var / store-key compatibility). */
const LEGACY_ROLE_NAMES = Object.freeze({
  reviewer: "evaluator",
  learner: "auditor",
});

/**
 * Map any role name (legacy or canonical) to its canonical form. Unknown
 * names pass through unchanged so this is safe to apply universally.
 */
function normalizeRole(name) {
  if (!name || typeof name !== "string") return name;
  return ROLE_ALIASES[name] || name;
}

/**
 * Returns the legacy name for a canonical role, or null. Used when we need
 * to read backward-compat env vars (e.g. REASONING_EVALUATOR for `reviewer`).
 */
function legacyRoleFor(canonical) {
  return LEGACY_ROLE_NAMES[canonical] || null;
}

/**
 * True when `name` (in any form) refers to `expected` (in canonical form).
 * Use this in hook gates instead of `.includes()` substring checks.
 */
function isRole(name, expected) {
  return normalizeRole(name) === expected;
}

module.exports = {
  ROLE_ALIASES,
  LEGACY_ROLE_NAMES,
  normalizeRole,
  legacyRoleFor,
  isRole,
};
