#!/usr/bin/env node

/**
 * scripts/sprint/checkpoint.js — Write a sprint-progress checkpoint.
 *
 * Updates paths.sprintProgress with the supplied fields. Also drops a
 * frozen copy under paths.sprintCheckpoints/<sprint>-<n>.yaml so a
 * resume agent has a history trail.
 *
 * Usage:
 *   node scripts/sprint/checkpoint.js --sprint <id> \
 *     --phase <plan|design|execute|release|retrospective|idle> \
 *     --command </sprint:plan|/sprint:design|/sprint:execute|/sprint:release|none> \
 *     --status <starting|running|paused|blocked|...> \
 *     --next-action "<text>" \
 *     [--ticket <id>] [--task <name>] [--loop <n>] \
 *     [--resume-command "<cmd>"] [--resume-notes "<text>"] \
 *     [--safe-to-continue true|false] [--stop-reason "<text>"] \
 *     [--blockers "<a;b>"] [--approvals "<a;b>"] [--esd "<a;b>"]
 *
 * Reads existing progress if present and merges. Exit 0 on success.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const SPRINT = require("./paths");
const { ensureDir, readYamlMaybe, writeYaml, nowIso } = require("./fs");

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
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

function frozenCheckpointPath(sprintId) {
  const dir = SPRINT.checkpoints;
  ensureDir(dir);
  // count existing for this sprint to derive next index
  let max = 0;
  try {
    const re = new RegExp(`^${sprintId}-(\\d{4})\\.yaml$`);
    for (const f of fs.readdirSync(dir)) {
      const m = re.exec(f);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
  } catch {}
  const n = String(max + 1).padStart(4, "0");
  return path.join(dir, `${sprintId}-${n}.yaml`);
}

function main() {
  const sa = SPRINT.parseSprintArg(process.argv);
  if (sa.error) return 1;
  const a = parseArgs(process.argv);
  if (!a.sprint) {
    process.stderr.write("required: --sprint <id>\n");
    return 2;
  }
  const existing = readYamlMaybe(SPRINT.progress) || {};
  const next = {
    schema: "warpos/sprint/sprint-progress/v1",
    sprint: a.sprint,
    updated_at: nowIso(),
    current_phase: a.phase || existing.current_phase || "idle",
    current_command: a.command || existing.current_command || "none",
    current_ticket: a.ticket || existing.current_ticket || null,
    current_task: a.task || existing.current_task || null,
    current_loop:
      a.loop !== undefined
        ? parseInt(a.loop, 10)
        : (existing.current_loop ?? null),
    status: a.status || existing.status || "running",
    last_completed_step:
      a["last-completed-step"] || existing.last_completed_step || "",
    next_action: a["next-action"] || existing.next_action || "",
    active_files: splitList(a["active-files"]).length
      ? splitList(a["active-files"])
      : existing.active_files || [],
    modified_files: splitList(a["modified-files"]).length
      ? splitList(a["modified-files"])
      : existing.modified_files || [],
    checks_last_run: a["checks-last-run"] || existing.checks_last_run || null,
    checks_passing: splitList(a["checks-passing"]).length
      ? splitList(a["checks-passing"])
      : existing.checks_passing || [],
    checks_failing: splitList(a["checks-failing"]).length
      ? splitList(a["checks-failing"])
      : existing.checks_failing || [],
    blockers: splitList(a.blockers).length
      ? splitList(a.blockers)
      : existing.blockers || [],
    approvals_needed: splitList(a.approvals).length
      ? splitList(a.approvals)
      : existing.approvals_needed || [],
    external_services_needed: splitList(a.esd).length
      ? splitList(a.esd)
      : existing.external_services_needed || [],
    issues_opened: splitList(a["issues-opened"]).length
      ? splitList(a["issues-opened"])
      : existing.issues_opened || [],
    tickets_updated: splitList(a["tickets-updated"]).length
      ? splitList(a["tickets-updated"])
      : existing.tickets_updated || [],
    ralph_checkpoint:
      a["ralph-checkpoint"] || existing.ralph_checkpoint || null,
    resume_command: a["resume-command"] || existing.resume_command || "",
    resume_notes: a["resume-notes"] || existing.resume_notes || "",
    safe_to_continue:
      a["safe-to-continue"] === "false"
        ? false
        : a["safe-to-continue"] === "true"
          ? true
          : (existing.safe_to_continue ?? true),
    stop_reason: a["stop-reason"] || existing.stop_reason || null,
  };
  writeYaml(SPRINT.progress, next);
  const frozen = frozenCheckpointPath(a.sprint);
  writeYaml(frozen, next);
  process.stdout.write(
    `checkpoint: ${SPRINT.progress}\nfrozen:    ${frozen}\n`,
  );
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main };
