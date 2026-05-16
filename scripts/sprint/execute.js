#!/usr/bin/env node

/**
 * scripts/sprint/execute.js — Ralph loop progress helper.
 *
 * Subcommands:
 *   start    --ticket <T-...>          (initialize ralph/<sprint>/<ticket>.yaml in plan phase)
 *   phase    --ticket <T-...> --phase <plan|act|test|review|record|checkpoint>
 *            [--note "<text>"] [--add-passing <a;b>] [--add-failing <a;b>]
 *            [--add-failed-attempt "<approach>" --attempt-outcome <text>]
 *   stop     --ticket <T-...> --reason <stopped_*> [--notes "<text>"]
 *   show     --ticket <T-...>
 *
 * Writes:
 *   paths.sprintRalph/<sprint>/<ticket>.yaml
 *   updates current-sprint.ralph block
 *   updates sprint-progress (delegates to checkpoint.js's logic inline)
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

const VALID_PHASES = [
  "plan",
  "act",
  "test",
  "review",
  "record",
  "checkpoint",
  "stopped",
];
const STOP_REASONS = [
  "stopped_clean",
  "stopped_approval_required",
  "stopped_human_setup_required",
  "stopped_repeated_failure",
  "stopped_scope_expansion",
  "stopped_destructive_action_needed",
  "stopped_production_deploy_needed",
  "stopped_beta_warning",
  "stopped_unclear_intent",
];

function ralphPath(sprintId, ticketId) {
  return path.join(SPRINT.ralph, sprintId, `${ticketId}.yaml`);
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

function splitList(s) {
  if (!s || s === true) return [];
  return String(s)
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
}

function loadSprint() {
  const current = readYamlMaybe(SPRINT.current);
  if (!current) {
    process.stderr.write("no current-sprint.yaml\n");
    return null;
  }
  return current;
}

// T-20260512-010 + T-20260512-011 — lane-aware execute.
// Honors current.lane:
//   - default     → no chdir, no warm-up (no isolation needed)
//   - worktree    → validates lane.value, captures HEAD for drift,
//                   fires no-op warm-up (TR-3), chdir's into the lane
//   - branch      → light isolation (currently treated like default;
//                   v0.3 may add branch-switching semantics)
//
// The "warm-up" addresses LRN-2026-04-17 (parallel-dispatch first leak)
// by doing a single sequential read inside the worktree before any
// further activity. `git rev-parse HEAD` is the cheapest read that
// also captures the lane HEAD for drift detection (redteam probe A-4).
function prepareLane(current, opts = {}) {
  const lane = current.lane || { type: "default", value: null };
  if (lane.type === "default") {
    return { ok: true, lane, headSha: null, chdirTarget: null };
  }
  if (lane.type === "branch") {
    // v0.2: branch lanes share the working tree — no chdir, no warm-up.
    // v0.3 may introduce `git switch` here.
    return { ok: true, lane, headSha: null, chdirTarget: null };
  }
  if (lane.type === "worktree") {
    if (!lane.value) {
      return {
        ok: false,
        error: `/sprint:execute refused: lane.type=worktree but lane.value is null. Set lane.value to the worktree path.`,
      };
    }
    const worktreePath = path.isAbsolute(lane.value)
      ? lane.value
      : path.join(SPRINT.PROJECT, lane.value);
    if (!fs.existsSync(worktreePath)) {
      return {
        ok: false,
        error: `/sprint:execute refused: lane worktree missing at \`${lane.value}\`. Run \`git worktree add ${lane.value}\` then retry. (Worktree creation is intentionally manual — the helper does not create branches for you.)`,
      };
    }
    // Capture HEAD via git rev-parse — also primes the worktree process
    // (the LRN-2026-04-17 "first-dispatch-leak-workaround").
    let headSha = null;
    if (!opts.skipWarmup) {
      try {
        const { spawnSync } = require("child_process");
        const r = spawnSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], {
          encoding: "utf8",
        });
        if (r.status === 0) {
          headSha = (r.stdout || "").trim();
        }
      } catch {
        /* git missing or worktree not actually a repo — fail open */
      }
      // Log TR-3 — `sprint.warmup_dispatch` event.
      try {
        const { log } = require("../hooks/lib/logger");
        log(
          "audit",
          {
            type: "warmup",
            action: "sprint.warmup_dispatch",
            target: lane.value,
            detail: `first-dispatch-leak-workaround; head=${headSha || "?"}`,
          },
          { actor: "sprint", sprint_id: current.id },
        );
      } catch {
        /* logger missing — best-effort */
      }
    }
    return {
      ok: true,
      lane,
      headSha,
      chdirTarget: worktreePath,
    };
  }
  return {
    ok: false,
    error: `unknown lane.type: ${lane.type}`,
  };
}

function cmdStart(argv) {
  const f = parseFlags(argv, 3);
  if (!f.ticket) {
    process.stderr.write("start requires --ticket\n");
    return 2;
  }
  const current = loadSprint();
  if (!current) return 1;
  // T-20260512-010 + T-20260512-011 — lane awareness + warm-up.
  const laneRes = prepareLane(current, {
    skipWarmup: f["skip-warmup"] === true || f["skip-warmup"] === "true",
  });
  if (!laneRes.ok) {
    process.stderr.write(laneRes.error + "\n");
    return 1;
  }
  // T-20260512-013 conflict-check at execute-time: blocks unless
  // --allow-overlap, in which case the override is logged to
  // paths.decisionLedger as `manual_allow_overlap`.
  try {
    const { checkSprint, formatReport } = require("./conflict-check");
    const cc = checkSprint(current.id, {
      phase: "execute",
      allowOverlap: !!f["allow-overlap"],
    });
    if (cc.severity === "block" && !f["allow-overlap"]) {
      process.stderr.write(formatReport(cc, { allowOverlap: false }) + "\n");
      return 1;
    }
    if (cc.severity === "block" && f["allow-overlap"]) {
      try {
        const { appendDecision } = require("../decisions/ledger");
        appendDecision({
          class: "B",
          owner: "alpha",
          topic: "sprint-execute-overlap",
          decision: `Proceed despite overlap (sprint=${current.id})`,
          why: `--allow-overlap passed; ${cc.conflicts.length} surface conflict(s) with ${new Set(cc.conflicts.map((c) => c.other_sprint_id)).size} other sprint(s)`,
          reversible: true,
          reversalPlan: "Stop /sprint:execute and rescope affected_surfaces",
          tags: "manual_allow_overlap,sprint,conflict-check",
          source: "scripts/sprint/execute.js",
          sprint_id: current.id,
        });
      } catch {
        /* decision-ledger missing — best-effort */
      }
    }
  } catch {
    /* conflict-check missing — fail open */
  }
  const rp = ralphPath(current.id, f.ticket);
  ensureDir(path.dirname(rp));
  const now = nowIso();
  const ralph = {
    schema: "warpos/sprint/ralph-progress/v1",
    sprint: current.id,
    ticket: f.ticket,
    current_loop: 1,
    phase: "plan",
    started_at: now,
    updated_at: now,
    status: "running",
    completed_tasks: [],
    remaining_tasks: splitList(f.tasks),
    blockers: [],
    failed_attempts: [],
    last_checks: { ran_at: null, passing: [], failing: [] },
    next_action:
      f["next-action"] || "Plan the smallest next change for this ticket.",
    external_dependency_status: [],
    stop_reason: null,
    resume_instructions:
      "Read this file. Resume at the phase listed. If status is stopped_*, investigate the stop_reason first.",
    checkpoint_pointers: [],
  };
  // T-010 lane-HEAD capture lands on the Ralph file so subsequent phases
  // can detect drift (redteam A-4). Lane info is informational here;
  // fully-fledged drift detection ships in v0.3.
  if (laneRes.lane && laneRes.lane.type === "worktree") {
    ralph.lane = {
      type: "worktree",
      value: laneRes.lane.value,
      head_sha_on_entry: laneRes.headSha || null,
    };
  }
  writeYaml(rp, ralph);
  // update current.ralph
  current.ralph = {
    active: true,
    current_ticket: f.ticket,
    current_loop: 1,
    status: "plan",
    last_checkpoint: rp,
    next_action: ralph.next_action,
  };
  current.current_phase = "execute";
  current.status = "executing";
  current.updated_at = now;
  current.crash_recovery.resume_command = "/sprint:execute";
  current.crash_recovery.resume_summary = `Ralph loop active on ${f.ticket}, loop 1, phase plan. Next: ${ralph.next_action}`;
  current.crash_recovery.last_checkpoint = rp;
  writeYaml(SPRINT.current, current);
  process.stdout.write(`ralph started: ${rp}\n`);
  return 0;
}

function cmdPhase(argv) {
  const f = parseFlags(argv, 3);
  if (!f.ticket || !f.phase) {
    process.stderr.write("phase requires --ticket and --phase\n");
    return 2;
  }
  if (!VALID_PHASES.includes(f.phase)) {
    process.stderr.write(`invalid phase ${f.phase}\n`);
    return 2;
  }
  const current = loadSprint();
  if (!current) return 1;
  const rp = ralphPath(current.id, f.ticket);
  const ralph = readYamlMaybe(rp);
  if (!ralph) {
    process.stderr.write(`no ralph file: ${rp}\n`);
    return 1;
  }
  const previousPhase = ralph.phase;
  ralph.phase = f.phase;
  ralph.updated_at = nowIso();
  if (f.phase === "plan" && previousPhase === "checkpoint") {
    ralph.current_loop = (ralph.current_loop || 0) + 1;
  }
  if (f.note) {
    ralph.completed_tasks.push(`${previousPhase}: ${f.note}`);
  }
  if (f["add-passing"]) {
    ralph.last_checks.passing = Array.from(
      new Set([...ralph.last_checks.passing, ...splitList(f["add-passing"])]),
    );
    ralph.last_checks.ran_at = nowIso();
  }
  if (f["add-failing"]) {
    ralph.last_checks.failing = Array.from(
      new Set([...ralph.last_checks.failing, ...splitList(f["add-failing"])]),
    );
    ralph.last_checks.ran_at = nowIso();
  }
  if (f["add-failed-attempt"]) {
    const n = ralph.failed_attempts.length + 1;
    ralph.failed_attempts.push({
      attempt: n,
      at: nowIso(),
      approach: f["add-failed-attempt"],
      outcome: f["attempt-outcome"] || "failed",
      notes: f.note || "",
    });
  }
  if (f["next-action"]) ralph.next_action = f["next-action"];
  if (f.phase === "checkpoint") {
    ralph.checkpoint_pointers.push(rp);
  }
  writeYaml(rp, ralph);
  // mirror to current
  current.ralph.status = f.phase;
  current.ralph.current_loop = ralph.current_loop;
  current.ralph.next_action = ralph.next_action;
  current.crash_recovery.resume_summary = `Ralph ${f.ticket} loop=${ralph.current_loop} phase=${f.phase}. Next: ${ralph.next_action}`;
  current.updated_at = nowIso();
  writeYaml(SPRINT.current, current);

  // 3-failed-attempt rule
  if (ralph.failed_attempts.length >= 3 && ralph.status === "running") {
    process.stderr.write(
      `WARN: ${f.ticket} has ${ralph.failed_attempts.length} failed attempts. Per CLAUDE.md and the Ralph stop conditions, halt and escalate via /fix:deep or mark deferred.\n`,
    );
  }
  process.stdout.write(
    `ralph ${f.ticket} loop=${ralph.current_loop} phase=${f.phase}\n`,
  );
  return 0;
}

function cmdStop(argv) {
  const f = parseFlags(argv, 3);
  if (!f.ticket || !f.reason) {
    process.stderr.write("stop requires --ticket and --reason\n");
    return 2;
  }
  if (!STOP_REASONS.includes(f.reason) && f.reason !== "completed") {
    process.stderr.write(`invalid reason ${f.reason}\n`);
    return 2;
  }
  const current = loadSprint();
  if (!current) return 1;
  const rp = ralphPath(current.id, f.ticket);
  const ralph = readYamlMaybe(rp);
  if (!ralph) {
    process.stderr.write(`no ralph file: ${rp}\n`);
    return 1;
  }
  ralph.phase = "stopped";
  ralph.status = f.reason === "completed" ? "completed" : f.reason;
  ralph.stop_reason = f.reason;
  if (f.notes) ralph.next_action = f.notes;
  ralph.updated_at = nowIso();
  writeYaml(rp, ralph);
  current.ralph.active = false;
  current.ralph.status = "stopped";
  current.ralph.next_action = ralph.next_action;
  current.crash_recovery.resume_summary =
    `Ralph ${f.ticket} stopped (${f.reason}). ${f.notes || ""}`.trim();
  current.updated_at = nowIso();
  writeYaml(SPRINT.current, current);
  process.stdout.write(`ralph ${f.ticket} stopped (${f.reason})\n`);
  return 0;
}

function cmdShow(argv) {
  const f = parseFlags(argv, 3);
  if (!f.ticket) {
    process.stderr.write("show requires --ticket\n");
    return 2;
  }
  const current = loadSprint();
  if (!current) return 1;
  const rp = ralphPath(current.id, f.ticket);
  const ralph = readYamlMaybe(rp);
  if (!ralph) {
    process.stderr.write(`no ralph file: ${rp}\n`);
    return 1;
  }
  process.stdout.write(JSON.stringify(ralph, null, 2) + "\n");
  return 0;
}

function main() {
  const sa = SPRINT.parseSprintArg(process.argv);
  if (sa.error) return 1;
  const cmd = process.argv[2];
  switch (cmd) {
    case "start":
      return cmdStart(process.argv);
    case "phase":
      return cmdPhase(process.argv);
    case "stop":
      return cmdStop(process.argv);
    case "show":
      return cmdShow(process.argv);
    default:
      process.stderr.write(
        "usage: execute.js <start|phase|stop|show> [flags]\n",
      );
      return 2;
  }
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, VALID_PHASES, STOP_REASONS };
