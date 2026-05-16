#!/usr/bin/env node

/**
 * scripts/sprint/ticket.js — Ticket lifecycle helpers.
 *
 * Subcommands:
 *   create   --title "<t>" --type <type> --risk <level> [--linked-story <id>] [--linked-issues <a;b>] [--esd <a;b>]
 *   update   --id <T-...> [--status <s>] [--owner <o>] [--add-issue <I-...>] [--add-commit <sha>] [--add-pr <#>] [--note "<text>"]
 *   reopen   --id <T-...> --reason <code> --new-required-outcome "<text>"
 *   show     --id <T-...>
 *   list     [--status <s>]
 *
 * Status enum: see schemas/sprint/ticket.schema.json.
 *
 * Writes:
 *   paths.sprintTickets/<id>.yaml
 *   paths.sprintCurrent (move id between bucket arrays on status change)
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
const { ticketId: newTicketId } = require("./ids");

const VALID_STATUSES = [
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
  "reopened",
  "deferred",
  "abandoned",
  "superseded",
];

const VALID_TYPES = [
  "feature",
  "bug",
  "research",
  "design",
  "qa",
  "redteam",
  "refactor",
  "docs",
  "release",
  "decision",
  "chore",
  "trace",
  "copy",
  "input",
  "integration",
  "external_service_setup",
  "approval",
  "checkpoint",
];

const VALID_REOPEN_REASONS = [
  "regression_found",
  "acceptance_criteria_missed",
  "requirement_changed",
  "copy_changed",
  "input_changed",
  "trace_mismatch",
  "test_failed_after_merge",
  "release_revealed_issue",
  "user_rejected",
  "beta_rejected",
  "dependency_changed",
  "external_service_changed",
  "supersede_was_wrong",
  "spec_drift",
  "telemetry_failure",
  "other",
];

function ticketPath(id) {
  return path.join(SPRINT.tickets, `${id}.yaml`);
}

function loadCurrent() {
  return readYamlMaybe(SPRINT.current);
}

function moveStatus(current, ticketId, fromStatus, toStatus) {
  if (!current.tickets) return;
  if (fromStatus && Array.isArray(current.tickets[fromStatus])) {
    current.tickets[fromStatus] = current.tickets[fromStatus].filter(
      (x) => x !== ticketId,
    );
  }
  if (toStatus && Array.isArray(current.tickets[toStatus])) {
    if (!current.tickets[toStatus].includes(ticketId)) {
      current.tickets[toStatus].push(ticketId);
    }
  } else if (toStatus) {
    current.tickets[toStatus] = [ticketId];
  }
}

// Full bucket re-sync: defensively remove the ticket id from EVERY bucket,
// then push to the bucket matching the new status. Closes the drift bug
// where a ticket's stale entry in `proposed` survived after `update --status`
// flipped it to `done`/`in_review` (SP-002 redispatch).
const ALL_BUCKETS = [
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

function resyncBuckets(current, ticketId, toStatus) {
  if (!current.tickets) current.tickets = {};
  for (const b of ALL_BUCKETS) {
    if (Array.isArray(current.tickets[b])) {
      current.tickets[b] = current.tickets[b].filter((x) => x !== ticketId);
    }
  }
  if (toStatus) {
    if (!Array.isArray(current.tickets[toStatus])) {
      current.tickets[toStatus] = [];
    }
    if (!current.tickets[toStatus].includes(ticketId)) {
      current.tickets[toStatus].push(ticketId);
    }
  }
}

// Resolve the per-sprint current.yaml for the ticket's own sprint, not the
// active-sprints primary. This matters when /sprint:ticket update --id <id>
// is invoked from a session whose primary is a different sprint than the
// ticket's home.
function currentForTicket(t) {
  if (t && t.sprint) {
    try {
      const per = SPRINT.forSprint(t.sprint);
      if (per && per.current) return per.current;
    } catch {
      // fall through to global
    }
  }
  return SPRINT.current;
}

function parseFlags(argv, start) {
  const out = {};
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) {
      out[k] = true;
    } else {
      out[k] = v;
      i++;
    }
  }
  return out;
}

function splitList(s) {
  if (!s || s === true) return [];
  return String(s)
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
}

// Bucket-bleed guard: if the caller omits --sprint while multiple sprints
// are active (not closed/abandoned/retrospected), refuse to mint the ticket.
// The fallback-to-primary behavior is silent and lands tickets in the wrong
// bucket (origin of T-039, T-062). When ambiguous, force the caller to be
// explicit. When unambiguous (≤1 active), the silent default is fine.
const CLOSED_SPRINT_STATUSES = ["closed", "abandoned", "retrospected"];

function activeSprintEntries() {
  try {
    const reg = readYamlMaybe(SPRINT.activeRegistry);
    if (!reg || !Array.isArray(reg.sprints)) return [];
    return reg.sprints.filter(
      (s) => s && !CLOSED_SPRINT_STATUSES.includes(s.status),
    );
  } catch {
    return [];
  }
}

function callerProvidedSprintFlag(argv) {
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--sprint") return true;
    if (typeof argv[i] === "string" && argv[i].startsWith("--sprint=")) {
      return true;
    }
  }
  return false;
}

function cmdCreate(argv) {
  const f = parseFlags(argv, 3);
  if (!f.title || !f.type) {
    process.stderr.write("create requires --title and --type\n");
    return 2;
  }
  if (!VALID_TYPES.includes(f.type)) {
    process.stderr.write(
      `invalid type ${f.type} (valid: ${VALID_TYPES.join(", ")})\n`,
    );
    return 2;
  }
  // Bucket-bleed guard: refuse silent fallback when multiple sprints active.
  if (!callerProvidedSprintFlag(argv)) {
    const active = activeSprintEntries();
    if (active.length > 1) {
      const ids = active.map((s) => s.id).join(", ");
      process.stderr.write(
        `ticket.js create requires --sprint <SP-id> when multiple active sprints exist (currently ${active.length} active). Available sprints: ${ids}. Specify --sprint to disambiguate.\n`,
      );
      return 2;
    }
  }
  const current = loadCurrent();
  if (!current) {
    process.stderr.write("no current-sprint.yaml — run /sprint:plan first\n");
    return 1;
  }
  ensureDir(SPRINT.tickets);
  const id = newTicketId(SPRINT.tickets);
  const now = nowIso();
  const ticket = {
    schema: "warpos/sprint/ticket/v1",
    id,
    title: f.title,
    type: f.type,
    status: f.status || "proposed",
    sprint: current.id,
    created_at: now,
    updated_at: now,
    owner: f.owner || null,
    owner_agent: f["owner-agent"] || null,
    risk_level: f.risk || "low",
    approval_required: f["approval-required"] === "true",
    approval_state:
      f["approval-required"] === "true" ? "pending" : "not_required",
    source_request: current.source_request || "",
    plan_contract: current.plan_contract || "",
    linked_requirements: splitList(f["linked-requirements"]),
    linked_high_level_story: f["linked-hl"] || null,
    linked_granular_story: f["linked-story"] || null,
    linked_prd: f["linked-prd"] || null,
    linked_copy: splitList(f["linked-copy"]),
    linked_inputs: splitList(f["linked-inputs"]),
    linked_trace: splitList(f["linked-trace"]),
    linked_acceptance_criteria: splitList(f["linked-ac"]),
    linked_issues: splitList(f["linked-issues"]),
    linked_decisions: splitList(f["linked-decisions"]),
    linked_external_services: splitList(f.esd),
    linked_files: [],
    linked_tests: [],
    linked_commits: [],
    linked_prs: [],
    linked_release: null,
    description: f.description || "",
    user_value: f["user-value"] || "",
    business_value: f["business-value"] || "",
    acceptance_criteria: splitList(f.ac),
    non_goals: splitList(f["non-goals"]),
    implementation_notes: f["implementation-notes"] || "",
    qa_notes: f["qa-notes"] || "",
    redteam_notes: f["redteam-notes"] || "",
    trace_notes: f["trace-notes"] || "",
    blocked_by: splitList(f["blocked-by"]),
    blocks: splitList(f.blocks),
    fix_attempts: [],
    ralph_progress: null,
    completion_evidence: [],
    reopen_history: [],
  };
  writeYaml(ticketPath(id), ticket);
  moveStatus(current, id, null, ticket.status);
  current.updated_at = now;
  writeYaml(SPRINT.current, current);
  process.stdout.write(
    `created ${id} (${ticket.status}) [sprint: ${ticket.sprint}] — ${ticket.title}\n`,
  );
  return 0;
}

function cmdUpdate(argv) {
  const f = parseFlags(argv, 3);
  if (!f.id) {
    process.stderr.write("update requires --id\n");
    return 2;
  }
  const tp = ticketPath(f.id);
  const t = readYamlMaybe(tp);
  if (!t) {
    process.stderr.write(`no ticket: ${tp}\n`);
    return 1;
  }
  const previousStatus = t.status;
  let statusChanged = false;
  if (f.status) {
    if (!VALID_STATUSES.includes(f.status)) {
      process.stderr.write(`invalid status ${f.status}\n`);
      return 2;
    }
    t.status = f.status;
    statusChanged = previousStatus !== f.status;
  }
  if (f.owner) t.owner = f.owner;
  if (f["owner-agent"]) t.owner_agent = f["owner-agent"];
  if (f["add-issue"]) {
    if (!t.linked_issues.includes(f["add-issue"]))
      t.linked_issues.push(f["add-issue"]);
  }
  if (f["add-commit"]) t.linked_commits.push(f["add-commit"]);
  if (f["add-pr"]) t.linked_prs.push(f["add-pr"]);
  if (f["add-file"]) t.linked_files.push(f["add-file"]);
  if (f["add-test"]) t.linked_tests.push(f["add-test"]);
  if (f["add-evidence"]) t.completion_evidence.push(f["add-evidence"]);
  if (f["add-fix-attempt"]) {
    const n = t.fix_attempts.length + 1;
    t.fix_attempts.push({
      attempt: n,
      at: nowIso(),
      approach: f["add-fix-attempt"],
      outcome: f["fix-outcome"] || "failed",
      notes: f.note || "",
    });
  }
  if (f.note) {
    t.implementation_notes =
      (t.implementation_notes ? t.implementation_notes + "\n" : "") + f.note;
  }
  t.updated_at = nowIso();
  writeYaml(tp, t);

  if (statusChanged) {
    // Resolve the ticket's own sprint current.yaml — not necessarily the
    // active-sprints primary. Then do a FULL bucket resync (defensive against
    // prior drift where a stale id sat in `proposed` after status flipped).
    const currentPath = currentForTicket(t);
    const current = readYamlMaybe(currentPath);
    if (current) {
      resyncBuckets(current, t.id, t.status);
      current.updated_at = nowIso();
      writeYaml(currentPath, current);
    }
  }
  process.stdout.write(`updated ${t.id} status=${t.status}\n`);
  return 0;
}

function cmdReopen(argv) {
  const f = parseFlags(argv, 3);
  if (!f.id || !f.reason) {
    process.stderr.write("reopen requires --id and --reason\n");
    return 2;
  }
  if (!VALID_REOPEN_REASONS.includes(f.reason)) {
    process.stderr.write(`invalid reason ${f.reason}\n`);
    return 2;
  }
  const tp = ticketPath(f.id);
  const t = readYamlMaybe(tp);
  if (!t) {
    process.stderr.write(`no ticket: ${tp}\n`);
    return 1;
  }
  const previousStatus = t.status;
  t.reopen_history.push({
    reopened_at: nowIso(),
    reopened_by: f.by || "alpha",
    reason: f.reason,
    previous_status: previousStatus,
    previous_resolution: t.completion_evidence.join("; "),
    new_required_outcome: f["new-required-outcome"] || "",
    linked_issue: f["linked-issue"] || null,
  });
  t.status = "reopened";
  t.updated_at = nowIso();
  writeYaml(tp, t);
  const current = loadCurrent();
  if (current) {
    moveStatus(current, t.id, previousStatus, "reopened");
    current.updated_at = nowIso();
    writeYaml(SPRINT.current, current);
  }
  process.stdout.write(`reopened ${t.id} (reason=${f.reason})\n`);
  return 0;
}

function cmdShow(argv) {
  const f = parseFlags(argv, 3);
  if (!f.id) {
    process.stderr.write("show requires --id\n");
    return 2;
  }
  const t = readYamlMaybe(ticketPath(f.id));
  if (!t) {
    process.stderr.write(`no ticket: ${f.id}\n`);
    return 1;
  }
  process.stdout.write(JSON.stringify(t, null, 2) + "\n");
  return 0;
}

function cmdList(argv) {
  const f = parseFlags(argv, 3);
  const dir = SPRINT.tickets;
  if (!fs.existsSync(dir)) {
    process.stdout.write("no tickets directory yet\n");
    return 0;
  }
  const files = fs.readdirSync(dir).filter((x) => x.endsWith(".yaml"));
  let count = 0;
  for (const file of files.sort()) {
    const t = readYamlMaybe(path.join(dir, file));
    if (!t) continue;
    if (f.status && t.status !== f.status) continue;
    process.stdout.write(
      `${t.id}  ${t.status.padEnd(28)}  ${t.type.padEnd(20)}  ${t.title}\n`,
    );
    count++;
  }
  process.stdout.write(`(${count} ticket(s))\n`);
  return 0;
}

function main() {
  const sa = SPRINT.parseSprintArg(process.argv);
  if (sa.error) return 1;
  const cmd = process.argv[2];
  switch (cmd) {
    case "create":
      return cmdCreate(process.argv);
    case "update":
      return cmdUpdate(process.argv);
    case "reopen":
      return cmdReopen(process.argv);
    case "show":
      return cmdShow(process.argv);
    case "list":
      return cmdList(process.argv);
    default:
      process.stderr.write(
        "usage: ticket.js <create|update|reopen|show|list> [flags]\n",
      );
      return 2;
  }
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, VALID_STATUSES, VALID_TYPES, VALID_REOPEN_REASONS };
