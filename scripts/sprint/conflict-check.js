#!/usr/bin/env node

/**
 * scripts/sprint/conflict-check.js — Sprint v0.2 affected-surface
 * overlap detector.
 *
 * Reads paths.sprintActiveRegistry + every live sprint's Plan Contract
 * (current.yaml#plan_contract pointer). Computes set-intersection of
 * affected_surfaces.surface strings between the candidate sprint and
 * every OTHER active sprint. Returns the conflicts in a structured
 * shape and emits TRACE TR-4 (`sprint.conflict_check.run`) to
 * paths.eventsFile.
 *
 * Usage:
 *   node scripts/sprint/conflict-check.js --sprint <SP-id> [--json]
 *                                          [--phase plan|execute]
 *                                          [--allow-overlap]
 *
 * Exit codes:
 *   0  no conflicts
 *   1  conflicts detected (and --allow-overlap NOT passed)
 *   2  bad usage / missing inputs
 *
 * When --allow-overlap is passed, exit 0 even with conflicts. The
 * override is logged to paths.decisionLedger by the calling helper
 * (not here — this script is observe-only with respect to overrides).
 *
 * Programmatic API:
 *   const cc = require("./conflict-check");
 *   cc.checkSprint("SP-X", { phase: "execute" })
 *   → { sprint: "SP-X", conflicts: [...], severity: "clean"|"warn"|"block",
 *       phase, surfaces_checked, total_active_sprints }
 */

"use strict";

const fs = require("fs");
const path = require("path");
const SPRINT = require("./paths");
const { readYamlMaybe } = require("./fs");

function loadPlanContract(currentYaml) {
  if (!currentYaml || !currentYaml.plan_contract) return null;
  const pcPath = path.isAbsolute(currentYaml.plan_contract)
    ? currentYaml.plan_contract
    : path.join(SPRINT.PROJECT, currentYaml.plan_contract);
  return readYamlMaybe(pcPath);
}

function loadSurfacesForSprint(sprintId) {
  const sprintPaths = SPRINT.forSprint(sprintId);
  const current = readYamlMaybe(sprintPaths.current);
  if (!current) return { id: sprintId, surfaces: [], status: null };
  const pc = loadPlanContract(current);
  const list =
    pc && Array.isArray(pc.affected_surfaces) ? pc.affected_surfaces : [];
  const surfaces = list
    .map((s) => (s && typeof s.surface === "string" ? s.surface : null))
    .filter(Boolean);
  return { id: sprintId, surfaces, status: current.status || null };
}

// A sprint is "in flight" iff its status indicates active work in
// progress. Closed/abandoned/not_started sprints are excluded from
// the check.
const IN_FLIGHT_STATUSES = new Set([
  "planning",
  "designing",
  "ready_for_execution",
  "executing",
  "waiting_on_human",
  "waiting_on_external_service",
  "in_review",
  "blocked",
  "releasing",
]);

function activeSprintsExcept(sprintId) {
  const registry = readYamlMaybe(SPRINT.activeRegistry);
  if (!registry || !Array.isArray(registry.sprints)) return [];
  return registry.sprints.filter((s) => s.id !== sprintId).map((s) => s.id);
}

function logTraceEvent(record) {
  try {
    const { log } = require("../hooks/lib/logger");
    log("audit", record, { actor: "sprint", sprint_id: record.sprint_id });
  } catch {
    /* logger missing — best-effort */
  }
}

function checkSprint(sprintId, opts = {}) {
  const candidate = loadSurfacesForSprint(sprintId);
  const candidateSet = new Set(candidate.surfaces);
  const others = activeSprintsExcept(sprintId);
  const conflicts = [];
  for (const otherId of others) {
    const other = loadSurfacesForSprint(otherId);
    // Skip sprints not actively making changes.
    if (
      other.status &&
      !IN_FLIGHT_STATUSES.has(other.status) &&
      opts.phase !== "plan"
    ) {
      continue;
    }
    for (const surface of other.surfaces) {
      if (candidateSet.has(surface)) {
        conflicts.push({ surface, other_sprint_id: otherId });
      }
    }
  }
  // Severity:
  //   clean: no conflicts
  //   warn:  conflicts but phase === "plan" (warn-only)
  //   block: conflicts and phase !== "plan" (execute blocks unless override)
  const phase = opts.phase || "plan";
  const severity =
    conflicts.length === 0 ? "clean" : phase === "plan" ? "warn" : "block";

  const result = {
    sprint: sprintId,
    conflicts,
    severity,
    phase,
    surfaces_checked: candidate.surfaces.length,
    total_active_sprints: others.length + 1,
  };

  logTraceEvent({
    type: "sprint.conflict_check.run",
    sprint_id: sprintId,
    phase,
    result: severity,
    conflicts: conflicts.length,
    allow_overlap: !!opts.allowOverlap,
  });

  return result;
}

function formatReport(result, opts) {
  if (result.severity === "clean") {
    return `no conflicts (checked ${result.surfaces_checked} surface(s) against ${result.total_active_sprints - 1} other sprint(s)).`;
  }
  const lines = [];
  if (result.severity === "warn") {
    lines.push(`Affected-surface overlap detected for ${result.sprint}:`);
  } else {
    lines.push(
      `/sprint:execute refused: ${result.sprint} overlaps with ${new Set(result.conflicts.map((c) => c.other_sprint_id)).size} other sprint(s) on ${result.conflicts.length} surface(s).`,
    );
  }
  for (const c of result.conflicts) {
    lines.push(`  - ${c.surface}  (vs ${c.other_sprint_id})`);
  }
  if (result.severity === "warn") {
    lines.push(
      "Pass --allow-overlap on /sprint:execute to proceed anyway; the override will be logged to the decision ledger.",
    );
  } else if (!opts.allowOverlap) {
    lines.push(
      "Re-run with --allow-overlap to proceed, or rescope this sprint's affected_surfaces.",
    );
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  const out = { sprint: null, json: false, phase: "plan", allowOverlap: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sprint") out.sprint = argv[++i] || null;
    else if (a === "--json") out.json = true;
    else if (a === "--phase") out.phase = argv[++i] || "plan";
    else if (a === "--allow-overlap") out.allowOverlap = true;
  }
  return out;
}

function main() {
  const sa = SPRINT.parseSprintArg(process.argv);
  if (sa.error) return 1;
  const args = parseArgs(process.argv);
  const sprintId = args.sprint || SPRINT.active();
  if (!sprintId) {
    process.stderr.write(
      "no sprint to check (no --sprint, no active-sprints.yaml primary)\n",
    );
    return 2;
  }
  const result = checkSprint(sprintId, {
    phase: args.phase,
    allowOverlap: args.allowOverlap,
  });
  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(
      formatReport(result, { allowOverlap: args.allowOverlap }) + "\n",
    );
  }
  if (result.severity === "clean") return 0;
  if (args.allowOverlap) return 0;
  if (result.severity === "warn") return 0; // warn does not fail the gate at plan-time
  return 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { checkSprint, formatReport, IN_FLIGHT_STATUSES };
