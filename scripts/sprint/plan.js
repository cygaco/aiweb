#!/usr/bin/env node

/**
 * scripts/sprint/plan.js — /sprint:plan tracker writer.
 *
 * Given a brief plain-language request (and optional flags supplied by
 * the /sprint:plan skill body after Alpha has done its reasoning), this
 * helper:
 *
 *   1. Generates a Plan Contract id and a fresh Plan Contract YAML
 *      under paths.sprintPlanContracts/.
 *   2. Generates a companion plan-report.md.
 *   3. Updates paths.sprintCurrent so the sprint references this Plan
 *      Contract.
 *   4. Writes a checkpoint via scripts/sprint/checkpoint.js.
 *
 * The skill body produces the structured fields (request_type,
 * evidence levels, assumptions, etc.) — this script is dumb plumbing
 * that turns the structured payload into tracker files. It does NOT
 * try to interpret the request on its own.
 *
 * Usage:
 *   node scripts/sprint/plan.js --payload <json-file>
 *
 *   Where <json-file> contains the Plan Contract body (everything that
 *   isn't id/created_at/sprint/tracker_paths/reports/timestamps; those
 *   fields this script fills in).
 *
 * Exit codes:
 *   0  Plan Contract written
 *   1  payload load/validation failed
 *   2  bad usage
 */

"use strict";

const fs = require("fs");
const path = require("path");
const SPRINT = require("./paths");
const {
  ensureDir,
  readText,
  writeYaml,
  readYamlMaybe,
  nowIso,
  writeText,
  render,
} = require("./fs");
const { planContractId, sprintId: nextSprintId } = require("./ids");

function parseArgs(argv) {
  const out = { payload: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--payload") out.payload = argv[++i];
    else if (argv[i] === "--dry-run") out.dryRun = true;
  }
  return out;
}

function loadPayload(file) {
  if (!file) return null;
  try {
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`cannot load payload: ${err.message}\n`);
    return null;
  }
}

function ensureCurrentSprint() {
  let current = readYamlMaybe(SPRINT.current);
  if (current && current.id) return current;
  // Bootstrap: create a fresh sprint id if not initialized.
  const sid = nextSprintId(SPRINT.history);
  const now = nowIso();
  current = {
    schema: "warpos/sprint/current-sprint/v1",
    id: sid,
    title: "Unnamed sprint",
    objective: "(set by /sprint:plan)",
    status: "planning",
    created_at: now,
    updated_at: now,
    source_request: "",
    interpreted_intent: "",
    plan_contract: null,
    risk_level: "low",
    approval_state: "none_required",
    current_phase: "plan",
    recommended_mode: "no_recommendation",
    mode_invocation_required_by_user: true,
    lane: { type: "default", value: null, isolation_notes: "" },
    external_services: {
      identified: [],
      blocked: [],
      ready: [],
      mocked: [],
      deferred: [],
    },
    tickets: emptyTicketBuckets(),
    requirements: emptyRequirementSlots(),
    checks: emptyChecks(),
    approvals: emptyApprovals(),
    reports: { plan: null, design: null, execution: null, release: null },
    ralph: {
      active: false,
      current_ticket: null,
      current_loop: null,
      status: "idle",
      last_checkpoint: null,
      next_action: null,
    },
    crash_recovery: {
      last_checkpoint: null,
      resume_command: "/sprint:plan",
      resume_summary: "",
      active_files: [],
      dirty_state: false,
      blockers: [],
      safe_to_continue: true,
    },
  };
  ensureDir(SPRINT.root);
  writeYaml(SPRINT.current, current);
  return current;
}

function emptyTicketBuckets() {
  const keys = [
    "proposed",
    "planned",
    "designed",
    "ready_for_execution",
    "in_progress",
    "blocked",
    "waiting_on_human",
    "waiting_on_external_service",
    "in_review",
    "qa_failed",
    "redteam_failed",
    "done",
    "released",
    "deferred",
    "abandoned",
    "reopened",
    "superseded",
  ];
  const out = {};
  for (const k of keys) out[k] = [];
  return out;
}
function emptyRequirementSlots() {
  return {
    prd: null,
    high_level_stories: null,
    granular_stories: null,
    copy: null,
    inputs: null,
    trace: null,
    acceptance_criteria: null,
    qa_plan: null,
    redteam_plan: null,
    release_plan: null,
  };
}
function emptyChecks() {
  return {
    lint: { status: "not_run", last_run: null, evidence: "" },
    typecheck: { status: "not_run", last_run: null, evidence: "" },
    tests: { status: "not_run", last_run: null, evidence: "" },
    build: { status: "not_run", last_run: null, evidence: "" },
    qa: { status: "not_run", last_run: null, evidence: "" },
    redteam: { status: "not_run", last_run: null, evidence: "" },
  };
}
function emptyApprovals() {
  return {
    plan: { required: false, state: "not_required", ref: null },
    design: { required: false, state: "not_required", ref: null },
    execution: { required: false, state: "not_required", ref: null },
    release: { required: false, state: "not_required", ref: null },
    external_services: { required: false, state: "not_required", ref: null },
  };
}

function writePlanContract(payload, current) {
  ensureDir(SPRINT.planContracts);
  const pcId = planContractId(SPRINT.planContracts);
  const now = nowIso();
  const planContract = {
    schema: "warpos/sprint/plan-contract/v1",
    id: pcId,
    created_at: now,
    updated_at: now,
    sprint: current.id,
    source_request: payload.source_request || "",
    source_request_verbatim:
      payload.source_request_verbatim || payload.source_request || "",
    request_type: payload.request_type || "feature_add",
    interpreted_intent: payload.interpreted_intent || "",
    user_or_business_outcome: payload.user_or_business_outcome || "",
    affected_surfaces: payload.affected_surfaces || [],
    current_behavior: payload.current_behavior || {
      evidence_level: "unknown",
      notes: "",
    },
    desired_behavior: payload.desired_behavior || "",
    scope: payload.scope || {
      size: "s",
      risk_level: "low",
      complexity_drivers: [],
    },
    scope_variants: payload.scope_variants || {
      minimal_safe: { summary: "", tradeoffs: [] },
      recommended: { summary: "", tradeoffs: [] },
      expanded: { summary: "", tradeoffs: [] },
    },
    assumptions: payload.assumptions || {
      safe: [],
      unsafe: [],
      needs_user_or_beta_review: [],
    },
    open_questions: payload.open_questions || {
      blocking: [],
      non_blocking: [],
    },
    non_goals: payload.non_goals || [],
    requirement_areas: payload.requirement_areas || [],
    high_level_story_candidates: payload.high_level_story_candidates || [],
    granular_story_candidates: payload.granular_story_candidates || [],
    workstream_candidates: payload.workstream_candidates || [],
    preliminary_ticket_candidates: payload.preliminary_ticket_candidates || {
      allowed: false,
      candidates: [],
      notes:
        "Tickets are minted during /sprint:design unless this is documentation_scale=xs.",
    },
    external_service_dependencies: payload.external_service_dependencies || {
      status: "none_expected",
      required: [],
      possible: [],
      notes: "",
    },
    approval_boundaries: payload.approval_boundaries || [],
    design_required:
      payload.design_required !== undefined ? payload.design_required : true,
    execution_allowed_without_design:
      payload.execution_allowed_without_design || false,
    recommended_mode: payload.recommended_mode || "no_recommendation",
    mode_invocation_required_by_user: true,
    lane: payload.lane || {
      type: "default",
      value: null,
      isolation_notes: "",
    },
    beta_review: payload.beta_review || {
      required: false,
      likely_founder_rejection_risks: [],
      overbuild_risks: [],
      missing_context_risks: [],
    },
    plan_quality: payload.plan_quality || {
      status: "needs_design",
      confidence: "medium",
      evidence_gaps: [],
      fail_reasons: [],
    },
    next_recommended_command:
      payload.next_recommended_command || "/sprint:design",
    resume_instructions:
      payload.resume_instructions ||
      `Sprint ${current.id} has Plan Contract ${pcId}. Run the next_recommended_command. If interrupted, read .claude/project/sprint/sprint-progress.yaml#resume_command.`,
    tracker_paths: {
      current_sprint: ".claude/project/sprint/current-sprint.yaml",
      sprint_progress: ".claude/project/sprint/sprint-progress.yaml",
      plan_contract: `.claude/project/sprint/plan-contracts/${pcId}.yaml`,
    },
    reports: {
      plan: `.claude/project/sprint/plan-contracts/${pcId}.report.md`,
    },
    created_by: payload.created_by || "alpha",
    updated_by: payload.updated_by || "alpha",
  };
  const pcPath = path.join(SPRINT.planContracts, `${pcId}.yaml`);
  writeYaml(pcPath, planContract);

  // Companion report.
  const tmplPath = path.join(
    SPRINT.templates,
    "plan-contract",
    "plan-report.md.tmpl",
  );
  const tmpl = readText(tmplPath);
  if (tmpl) {
    const reportData = {
      sprint_id: current.id,
      plan_contract_id: pcId,
      created_at: now,
      plan_quality_status: planContract.plan_quality.status,
      plan_quality_confidence: planContract.plan_quality.confidence,
      next_recommended_command: planContract.next_recommended_command,
      source_request_verbatim: planContract.source_request_verbatim,
      interpreted_intent: planContract.interpreted_intent,
      user_or_business_outcome: planContract.user_or_business_outcome,
      surface_1: (planContract.affected_surfaces[0] || {}).surface || "—",
      surface_1_evidence:
        (planContract.affected_surfaces[0] || {}).evidence_level || "—",
      surface_1_notes: (planContract.affected_surfaces[0] || {}).notes || "—",
      current_behavior_evidence: planContract.current_behavior.evidence_level,
      current_behavior_notes: planContract.current_behavior.notes,
      desired_behavior: planContract.desired_behavior,
      scope_size: planContract.scope.size,
      scope_risk: planContract.scope.risk_level,
      minimal_safe_summary: planContract.scope_variants.minimal_safe.summary,
      recommended_summary: planContract.scope_variants.recommended.summary,
      expanded_summary: planContract.scope_variants.expanded.summary,
      esd_status: planContract.external_service_dependencies.status,
      beta_review_required: planContract.beta_review.required,
      resume_instructions: planContract.resume_instructions,
    };
    const reportPath = path.join(SPRINT.planContracts, `${pcId}.report.md`);
    writeText(reportPath, render(tmpl, reportData), { force: true });
  }
  return { pcId, pcPath, planContract };
}

function updateCurrent(current, planContract, payload) {
  current.plan_contract = planContract.tracker_paths.plan_contract;
  current.source_request = planContract.source_request;
  current.interpreted_intent = planContract.interpreted_intent;
  current.current_phase = "plan";
  current.status =
    planContract.plan_quality.status === "pass"
      ? planContract.design_required
        ? "designing"
        : "ready_for_execution"
      : "planning";
  current.recommended_mode = planContract.recommended_mode;
  current.risk_level = planContract.scope.risk_level;
  // Inherit lane from the Plan Contract.
  current.lane = planContract.lane || {
    type: "default",
    value: null,
    isolation_notes: "",
  };
  current.title =
    payload.sprint_title ||
    current.title ||
    planContract.interpreted_intent ||
    "Unnamed sprint";
  current.objective =
    payload.sprint_objective ||
    current.objective ||
    planContract.user_or_business_outcome ||
    "(set by /sprint:plan)";
  current.updated_at = nowIso();
  current.reports.plan = planContract.reports.plan;
  current.crash_recovery.resume_command = planContract.next_recommended_command;
  current.crash_recovery.resume_summary = `Plan Contract ${planContract.id} created. Next: ${planContract.next_recommended_command}.`;
  current.crash_recovery.last_checkpoint =
    ".claude/project/sprint/sprint-progress.yaml";
  current.crash_recovery.safe_to_continue = true;
  // ESDs into current.external_services.identified
  const esdReq = planContract.external_service_dependencies.required || [];
  const esdPos = planContract.external_service_dependencies.possible || [];
  current.external_services.identified = Array.from(
    new Set([...current.external_services.identified, ...esdReq, ...esdPos]),
  );
  writeYaml(SPRINT.current, current);
}

function main() {
  const sa = SPRINT.parseSprintArg(process.argv);
  if (sa.error) return 1;
  const args = parseArgs(process.argv);
  if (!args.payload) {
    process.stderr.write("required: --payload <json-file>\n");
    return 2;
  }
  const payload = loadPayload(args.payload);
  if (!payload) return 1;
  const current = ensureCurrentSprint();
  const { pcId, pcPath, planContract } = writePlanContract(payload, current);
  updateCurrent(current, planContract, payload);
  process.stdout.write(`plan-contract: ${pcPath}\n`);
  process.stdout.write(
    `current-sprint: ${SPRINT.current} (sprint=${current.id})\n`,
  );
  // T-20260512-013 conflict-check at plan-time: warn-only, never blocks.
  try {
    const { checkSprint, formatReport } = require("./conflict-check");
    const cc = checkSprint(current.id, { phase: "plan" });
    if (cc.severity === "warn") {
      process.stderr.write(formatReport(cc, {}) + "\n");
    }
  } catch {
    /* conflict-check missing — fail open */
  }
  process.stdout.write(`next: ${planContract.next_recommended_command}\n`);
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, writePlanContract, ensureCurrentSprint };
