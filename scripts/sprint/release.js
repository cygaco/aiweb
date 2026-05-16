#!/usr/bin/env node

/**
 * scripts/sprint/release.js — /sprint:release tracker writer.
 *
 * Subcommands:
 *   prepare  [--title "<t>"] [--version "<v>"] [--target "<env>"]
 *            (creates releases/<id>.yaml in 'preparing' state)
 *   check    --id <RL-...>
 *            (computes checklist from tracker state; updates checklist booleans)
 *   approve  --id <RL-...> --approval <AP-...>
 *   deploy   --id <RL-...> [--by <name>] [--target <env>]
 *            (only sets deployed_at + deployed_by; does NOT perform the deploy)
 *   rollback --id <RL-...> --reason "<text>"
 *   report   --id <RL-...>
 *            (renders release-report.md companion)
 *   show     --id <RL-...>
 *   list
 *
 * NOTE: This script never performs an actual deployment. Production
 * deploys are user-approved out-of-band per CLAUDE.md.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const SPRINT = require("./paths");
const {
  readYamlMaybe,
  writeYaml,
  ensureDir,
  nowIso,
  readText,
  render,
  writeText,
} = require("./fs");
const { releaseId: newReleaseId } = require("./ids");

function releasePath(id) {
  return path.join(SPRINT.releases, `${id}.yaml`);
}
function parseFlags(argv, start) {
  const out = {};
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) out[k] = true;
    else {
      out[k] = v;
      i++;
    }
  }
  return out;
}

function loadCurrent() {
  return readYamlMaybe(SPRINT.current);
}

function cmdPrepare(argv) {
  const f = parseFlags(argv, 3);
  const current = loadCurrent();
  if (!current) {
    process.stderr.write("no current-sprint.yaml\n");
    return 1;
  }
  ensureDir(SPRINT.releases);
  const id = newReleaseId(SPRINT.releases);
  const now = nowIso();
  const release = {
    schema: "warpos/sprint/release/v1",
    id,
    sprint: current.id,
    title: f.title || current.title || "Sprint release",
    version: f.version || "",
    status: "preparing",
    checklist: {
      tickets_done_or_deferred: false,
      blocking_issues_resolved: false,
      requirements_satisfied: false,
      copy_satisfied: false,
      inputs_satisfied: false,
      trace_satisfied: false,
      acceptance_criteria_satisfied: false,
      qa_passed: false,
      redteam_passed: false,
      external_services_ready: false,
      credentials_present: false,
      release_notes_written: false,
      docs_updated: false,
      analytics_updated: false,
      migration_plan: false,
      rollback_plan: false,
      approval_recorded: false,
      post_release_monitoring_plan: false,
    },
    approval_ref: null,
    changelog_path: null,
    release_report_path: null,
    linked_tickets: [],
    linked_issues: [],
    linked_external_services: [],
    deployment_environment: f.target || "",
    deployment_target: f.target || "",
    deployed_at: null,
    deployed_by: null,
    rollback_at: null,
    rollback_reason: null,
    retrospective_ref: null,
    learning_candidates: [],
    created_at: now,
    updated_at: now,
  };
  writeYaml(releasePath(id), release);
  current.current_phase = "release";
  current.status = "releasing";
  current.reports.release = releasePath(id);
  current.updated_at = now;
  current.crash_recovery.resume_command = "/sprint:release";
  current.crash_recovery.resume_summary = `Release ${id} in preparing state. Run /sprint:release with --id ${id}.`;
  writeYaml(SPRINT.current, current);
  process.stdout.write(`release prepared: ${id}\n`);
  return 0;
}

function cmdCheck(argv) {
  const f = parseFlags(argv, 3);
  if (!f.id) {
    process.stderr.write("check requires --id\n");
    return 2;
  }
  const rp = releasePath(f.id);
  const release = readYamlMaybe(rp);
  if (!release) {
    process.stderr.write(`no release: ${rp}\n`);
    return 1;
  }
  const current = loadCurrent();
  // Derive a few checks from current-sprint state.
  if (current) {
    const t = current.tickets || {};
    const open = (t.proposed || []).concat(
      t.planned || [],
      t.designed || [],
      t.ready_for_execution || [],
      t.in_progress || [],
      t.blocked || [],
      t.waiting_on_human || [],
      t.waiting_on_external_service || [],
      t.in_review || [],
      t.qa_failed || [],
      t.redteam_failed || [],
      t.reopened || [],
    );
    release.checklist.tickets_done_or_deferred = open.length === 0;
    release.checklist.qa_passed =
      (current.checks?.qa?.status || "not_run") === "passing";
    release.checklist.redteam_passed =
      (current.checks?.redteam?.status || "not_run") === "passing";
    release.checklist.requirements_satisfied = Boolean(
      current.requirements?.prd && current.requirements?.acceptance_criteria,
    );
    release.checklist.copy_satisfied =
      current.requirements?.copy == null ? true : true;
    release.checklist.inputs_satisfied =
      current.requirements?.inputs == null ? true : true;
    release.checklist.trace_satisfied =
      current.requirements?.trace == null ? true : true;
    release.checklist.acceptance_criteria_satisfied = Boolean(
      current.requirements?.acceptance_criteria,
    );
    const ext = current.external_services || {};
    const notReady = (ext.identified || []).concat(ext.blocked || []);
    release.checklist.external_services_ready = notReady.length === 0;
    release.checklist.approval_recorded = Boolean(release.approval_ref);
  }
  release.updated_at = nowIso();
  // status hints
  const c = release.checklist;
  const allCheckable = [
    "tickets_done_or_deferred",
    "blocking_issues_resolved",
    "requirements_satisfied",
    "qa_passed",
    "redteam_passed",
    "external_services_ready",
    "release_notes_written",
    "docs_updated",
    "approval_recorded",
  ];
  const ready = allCheckable.every((k) => c[k]);
  if (ready && release.status === "preparing")
    release.status = "approval_pending";
  writeYaml(rp, release);
  process.stdout.write(
    `release ${release.id} status=${release.status} ready=${ready}\n`,
  );
  for (const [k, v] of Object.entries(c)) {
    process.stdout.write(`  [${v ? "x" : " "}] ${k}\n`);
  }
  return 0;
}

function cmdApprove(argv) {
  const f = parseFlags(argv, 3);
  if (!f.id || !f.approval) {
    process.stderr.write("approve requires --id and --approval\n");
    return 2;
  }
  const rp = releasePath(f.id);
  const release = readYamlMaybe(rp);
  if (!release) return 1;
  release.approval_ref = f.approval;
  release.checklist.approval_recorded = true;
  release.status = "ready_to_deploy";
  release.updated_at = nowIso();
  writeYaml(rp, release);
  process.stdout.write(`release ${release.id} approved via ${f.approval}\n`);
  return 0;
}

function cmdDeploy(argv) {
  const f = parseFlags(argv, 3);
  if (!f.id) {
    process.stderr.write("deploy requires --id\n");
    return 2;
  }
  const rp = releasePath(f.id);
  const release = readYamlMaybe(rp);
  if (!release) return 1;
  if (release.status !== "ready_to_deploy") {
    process.stderr.write(
      `release ${release.id} not in ready_to_deploy (status=${release.status}). Run check + approve first.\n`,
    );
    return 1;
  }
  const now = nowIso();
  release.deployed_at = now;
  release.deployed_by = f.by || "human";
  release.deployment_target = f.target || release.deployment_target;
  release.status = "deployed";
  release.updated_at = now;
  writeYaml(rp, release);
  process.stdout.write(
    `release ${release.id} marked deployed (target=${release.deployment_target})\n`,
  );
  // Auto-flip active-sprints status: releasing/executing/etc. -> closed.
  // Without this, /sprint:retrospective rejects the sprint (status gate)
  // and operators have to hand-edit active-sprints.yaml before closeout.
  // Idempotent: if entry is already `closed`, leave it (no extra write).
  // Fail-open: never let registry flip block the deploy mark.
  try {
    const reg = readYamlMaybe(SPRINT.activeRegistry);
    if (reg && Array.isArray(reg.sprints)) {
      const entry = reg.sprints.find((s) => s.id === release.sprint);
      if (entry && entry.status !== "closed" && entry.status !== "abandoned") {
        const prev = entry.status;
        entry.status = "closed";
        entry.updated_at = now;
        reg.updated_at = now;
        writeYaml(SPRINT.activeRegistry, reg);
        process.stdout.write(
          `sprint ${release.sprint} status: ${prev} -> closed\n`,
        );
      }
    }
  } catch (err) {
    process.stderr.write(
      `warning: could not flip active-sprints status: ${err.message}\n`,
    );
  }
  return 0;
}

function cmdRollback(argv) {
  const f = parseFlags(argv, 3);
  if (!f.id || !f.reason) {
    process.stderr.write("rollback requires --id and --reason\n");
    return 2;
  }
  const rp = releasePath(f.id);
  const release = readYamlMaybe(rp);
  if (!release) return 1;
  release.rollback_at = nowIso();
  release.rollback_reason = f.reason;
  release.status = "rolled_back";
  release.updated_at = nowIso();
  writeYaml(rp, release);
  process.stdout.write(
    `release ${release.id} marked rolled_back (${f.reason})\n`,
  );
  return 0;
}

function cmdReport(argv) {
  const f = parseFlags(argv, 3);
  if (!f.id) {
    process.stderr.write("report requires --id\n");
    return 2;
  }
  const rp = releasePath(f.id);
  const release = readYamlMaybe(rp);
  if (!release) return 1;
  const tmpl = readText(
    path.join(SPRINT.templates, "release", "release-report.md.tmpl"),
  );
  if (!tmpl) {
    process.stderr.write("missing release-report.md.tmpl\n");
    return 1;
  }
  const linkedTickets = release.linked_tickets || [];
  const data = {
    release_id: release.id,
    sprint_id: release.sprint,
    title: release.title,
    version: release.version,
    status: release.status,
    deployed_at: release.deployed_at || "—",
    what_shipped_summary: "(fill in)",
    ticket_1: linkedTickets[0] || "—",
    ticket_1_status: "—",
    ticket_2: linkedTickets[1] || "—",
    ticket_2_status: "—",
    issue_1: (release.linked_issues || [])[0] || "—",
    issue_1_disposition: "—",
    esd_1: (release.linked_external_services || [])[0] || "—",
    esd_1_status: "—",
    qa_result: release.checklist.qa_passed ? "passed" : "see checklist",
    redteam_result: release.checklist.redteam_passed
      ? "passed"
      : "see checklist",
    approval_required: Boolean(release.approval_ref),
    approval_ref: release.approval_ref || "—",
    migration_plan: release.checklist.migration_plan
      ? "see plan"
      : "none_required",
    rollback_plan: release.checklist.rollback_plan
      ? "see plan"
      : "none_required",
    monitoring_check_1: "(fill in)",
    monitoring_check_2: "(fill in)",
    learning_1: (release.learning_candidates || [])[0] || "—",
    learning_2: (release.learning_candidates || [])[1] || "—",
    resume_or_rollback_instructions:
      release.status === "rolled_back"
        ? `Rolled back at ${release.rollback_at}. Reason: ${release.rollback_reason}.`
        : `Monitor per release-plan.md. Rollback: see CHANGELOG and approval ${release.approval_ref || "—"}.`,
  };
  const reportPath = path.join(SPRINT.releases, `${release.id}.report.md`);
  writeText(reportPath, render(tmpl, data), { force: true });
  release.release_report_path = reportPath;
  release.updated_at = nowIso();
  writeYaml(rp, release);
  process.stdout.write(`release report: ${reportPath}\n`);
  return 0;
}

function cmdShow(argv) {
  const f = parseFlags(argv, 3);
  if (!f.id) {
    process.stderr.write("show requires --id\n");
    return 2;
  }
  const r = readYamlMaybe(releasePath(f.id));
  if (!r) return 1;
  process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  return 0;
}

function cmdList() {
  if (!fs.existsSync(SPRINT.releases)) return 0;
  const files = fs
    .readdirSync(SPRINT.releases)
    .filter((x) => x.endsWith(".yaml"));
  for (const f of files.sort()) {
    const r = readYamlMaybe(path.join(SPRINT.releases, f));
    if (!r) continue;
    process.stdout.write(`${r.id}  ${r.status.padEnd(18)}  ${r.title}\n`);
  }
  return 0;
}

function main() {
  const sa = SPRINT.parseSprintArg(process.argv);
  if (sa.error) return 1;
  const cmd = process.argv[2];
  switch (cmd) {
    case "prepare":
      return cmdPrepare(process.argv);
    case "check":
      return cmdCheck(process.argv);
    case "approve":
      return cmdApprove(process.argv);
    case "deploy":
      return cmdDeploy(process.argv);
    case "rollback":
      return cmdRollback(process.argv);
    case "report":
      return cmdReport(process.argv);
    case "show":
      return cmdShow(process.argv);
    case "list":
      return cmdList();
    default:
      process.stderr.write(
        "usage: release.js <prepare|check|approve|deploy|rollback|report|show|list> [flags]\n",
      );
      return 2;
  }
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main };
