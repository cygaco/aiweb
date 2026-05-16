#!/usr/bin/env node
/**
 * provider-rca.js — pure-function Root Cause Analysis for provider-smoke.
 *
 * Sprint:  SP-20260513-002
 * Ticket:  T-20260513-022
 * Story:   S-4
 * AC:      AC-4.1, AC-4.2, AC-4.3
 * TRACE:   TR-3
 *
 * Pure, deterministic, no I/O. Given a list of probe results and the
 * parsed failure-mode catalog, returns one RCA entry per NON-GREEN result.
 *
 * Consumed by scripts/warpos/provider-smoke.js (T-019 orchestrator) which
 * replaces its `const rca = []` stub with `rcaFor(results, catalog)`.
 *
 * Contract (DO NOT change shape without bumping the parent smoke schema
 * `warpos/provider-smoke/v1`):
 *
 *   rcaFor(results, catalog) ->
 *     Array<{
 *       provider:         string,
 *       status:           string,   // the OBSERVED status (preserved)
 *       root_cause:       string,   // from catalog entry
 *       safe_to_autofix:  boolean,
 *       fix_recipe:       object|null,
 *       remediation:      string,
 *       fallback_allowed: boolean
 *     }>
 *
 * Semantics:
 *   - Green results (status === "ok") are EXCLUDED from output (AC-4.3).
 *   - Known status (catalog.entries[status] exists) -> map to that entry.
 *   - Unknown status -> use catalog.entries.unknown_error as the source of
 *     root_cause/etc., BUT preserve the actual observed `status` field on
 *     the rca entry (do NOT rewrite to "unknown_error"). This matters for
 *     downstream events (TR-3) and recurring-issue mining.
 *   - Catalog missing / catalog.entries missing / catalog.entries.unknown_error
 *     missing -> use a hard-coded safe fallback object. Never throw.
 *   - results null/undefined/non-array -> return [].
 *   - Result with no `status` field -> treated as unknown (uses fallback).
 *
 * Cross-platform Windows stdin-bug guard (PRD R-8, AC-8.1): this module
 * performs ZERO subprocess invocations. It cannot re-introduce the
 * LRN-2026-04-17-n / LRN-2026-04-30 binding-gap bug class.
 */

"use strict";

// Hard-coded last-resort fallback used only when the catalog is corrupt /
// missing / lacks an `unknown_error` entry. Matches the shape of a catalog
// entry so downstream consumers (TR-3 events, renderHuman) don't need to
// branch on it.
const HARDCODED_UNKNOWN_FALLBACK = Object.freeze({
  root_cause: "Unclassified provider error — catalog unavailable.",
  safe_to_autofix: false,
  fix_recipe: null,
  remediation:
    "Inspect events.jsonl for the smoke event with full stderr. " +
    "If recurring, add a catalog entry under .claude/agents/00-alex/.system/policy/provider-failure-modes.json.",
  fallback_allowed: true,
});

/**
 * @param {Array<{provider:string, status:string, reason?:string}>} results
 * @param {{entries: {[status:string]: object}}|null|undefined} catalog
 * @returns {Array<object>}
 */
function rcaFor(results, catalog) {
  // Defensive: non-array (null/undefined/object) -> [].
  if (!Array.isArray(results)) return [];

  const entries =
    catalog &&
    typeof catalog === "object" &&
    catalog.entries &&
    typeof catalog.entries === "object"
      ? catalog.entries
      : null;

  const unknownEntry =
    entries &&
    entries.unknown_error &&
    typeof entries.unknown_error === "object"
      ? entries.unknown_error
      : HARDCODED_UNKNOWN_FALLBACK;

  const out = [];

  for (const r of results) {
    if (!r || typeof r !== "object") continue;

    const status = typeof r.status === "string" ? r.status : undefined;

    // AC-4.3: green results excluded.
    if (status === "ok") continue;

    // AC-4.1 / AC-4.2: lookup status in catalog; fall back to unknown_error
    // for missing statuses or missing-entries map. The observed `status`
    // string is preserved on the output even when we use the fallback entry
    // (so downstream events keep the actual signal).
    let entry;
    if (
      status &&
      entries &&
      Object.prototype.hasOwnProperty.call(entries, status) &&
      entries[status] &&
      typeof entries[status] === "object"
    ) {
      entry = entries[status];
    } else {
      entry = unknownEntry;
    }

    out.push({
      provider: r.provider,
      status: status, // preserve OBSERVED status (may be undefined for malformed input)
      root_cause: entry.root_cause,
      safe_to_autofix: !!entry.safe_to_autofix,
      fix_recipe: entry.fix_recipe == null ? null : entry.fix_recipe,
      remediation: entry.remediation,
      fallback_allowed:
        entry.fallback_allowed === undefined ? true : !!entry.fallback_allowed,
    });
  }

  return out;
}

module.exports = {
  rcaFor: rcaFor,
  HARDCODED_UNKNOWN_FALLBACK: HARDCODED_UNKNOWN_FALLBACK,
};
