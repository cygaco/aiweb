#!/usr/bin/env node

/**
 * scripts/sprint/status.js — Sprint v0.2 status reporter.
 *
 * Reads paths.sprintActiveRegistry and per-sprint current.yaml files,
 * prints a one-line-per-sprint table with id, lane, status, phase,
 * last checkpoint, and resume command. In `executing` state, the row
 * also shows current_ticket + current_loop.
 *
 * Also flags drift between the registry and the sprints/ directory:
 *   - orphan subdir: sprints/SP-X/ exists, no registry entry → STATUS=orphaned
 *   - missing subdir: registry entry has pointer but no files → STATUS=missing-subdir
 *
 * Usage:
 *   node scripts/sprint/status.js              (pretty table)
 *   node scripts/sprint/status.js --json       (machine output)
 *
 * Read-only. Exit codes:
 *   0  printed successfully (regardless of drift)
 *   2  bad usage
 */

"use strict";

const fs = require("fs");
const path = require("path");
const SPRINT = require("./paths");
const { readYamlMaybe } = require("./fs");

function parseArgs(argv) {
  return { json: argv.includes("--json") };
}

function laneLabel(lane) {
  if (!lane) return "default";
  if (lane.type === "default") return "default";
  if (lane.value) return `${lane.type}:${lane.value}`;
  return lane.type;
}

function relPath(p) {
  if (!p) return "";
  if (path.isAbsolute(p)) {
    return path.relative(SPRINT.PROJECT, p).replace(/\\/g, "/");
  }
  return p.replace(/\\/g, "/");
}

function gatherRows() {
  const registry = readYamlMaybe(SPRINT.activeRegistry);
  const rows = [];
  const seenIds = new Set();

  if (registry && Array.isArray(registry.sprints)) {
    for (const entry of registry.sprints) {
      seenIds.add(entry.id);
      const paths = SPRINT.forSprint(entry.id);
      const currentExists = fs.existsSync(paths.current);
      const progressExists = fs.existsSync(paths.progress);

      let title = entry.title || "";
      let status = entry.status || "—";
      let phase = "—";
      let currentTicket = null;
      let currentLoop = null;
      let lastCheckpoint = "";
      let resumeCommand = "";

      if (currentExists) {
        const current = readYamlMaybe(paths.current);
        if (current) {
          title = current.title || title;
          status = current.status || status;
          phase = current.current_phase || phase;
          currentTicket =
            (current.ralph && current.ralph.current_ticket) || null;
          currentLoop = (current.ralph && current.ralph.current_loop) || null;
          resumeCommand =
            (current.crash_recovery && current.crash_recovery.resume_command) ||
            "";
        }
      }
      if (progressExists) {
        const progress = readYamlMaybe(paths.progress);
        if (progress) {
          lastCheckpoint = relPath(paths.progress);
          if (!resumeCommand && progress.resume_command) {
            resumeCommand = progress.resume_command;
          }
        }
      }

      let displayStatus = status;
      if (!currentExists && !progressExists) {
        displayStatus = "missing-subdir";
      }

      rows.push({
        id: entry.id,
        title,
        lane: laneLabel(entry.lane),
        layout: entry.layout || "per_sprint_subdir",
        status: displayStatus,
        phase,
        current_ticket: currentTicket,
        current_loop: currentLoop,
        last_checkpoint: lastCheckpoint,
        resume_command: resumeCommand,
        primary: registry && registry.primary === entry.id,
      });
    }
  }

  // Orphan subdirs: directories under sprints/ that aren't in the registry.
  if (fs.existsSync(SPRINT.sprints)) {
    for (const f of fs.readdirSync(SPRINT.sprints)) {
      const dir = path.join(SPRINT.sprints, f);
      if (!fs.statSync(dir).isDirectory()) continue;
      if (seenIds.has(f)) continue;
      rows.push({
        id: f,
        title: "(orphan)",
        lane: "—",
        layout: "per_sprint_subdir",
        status: "orphaned",
        phase: "—",
        current_ticket: null,
        current_loop: null,
        last_checkpoint: relPath(path.join(dir, "progress.yaml")),
        resume_command: "",
        primary: false,
      });
    }
  }

  return rows;
}

function pad(s, n) {
  s = String(s == null ? "" : s);
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}

function renderTable(rows) {
  if (rows.length === 0) {
    process.stdout.write(
      'No active sprints. Run `/sprint:plan "<request>"` to create one.\n',
    );
    return;
  }

  const header = `${pad("SPRINT_ID", 17)} ${pad("LANE", 19)} ${pad(
    "STATUS",
    16,
  )} ${pad("PHASE", 14)} ${pad("LAST_CHECKPOINT", 44)} ${pad(
    "RESUME_COMMAND",
    18,
  )}`;
  process.stdout.write(header + "\n");
  process.stdout.write("-".repeat(header.length) + "\n");
  for (const r of rows) {
    const id = r.primary ? `* ${r.id}` : `  ${r.id}`;
    process.stdout.write(
      `${pad(id, 17)} ${pad(r.lane, 19)} ${pad(r.status, 16)} ${pad(
        r.phase,
        14,
      )} ${pad(r.last_checkpoint, 44)} ${pad(r.resume_command, 18)}\n`,
    );
    if (r.status === "executing" || r.current_ticket) {
      process.stdout.write(
        `                  ↳ ticket=${r.current_ticket || "—"} loop=${
          r.current_loop == null ? "—" : r.current_loop
        }\n`,
      );
    }
  }
  process.stdout.write(
    "\n(* = primary; row marked `orphaned` exists on disk but not in registry; `missing-subdir` is registry entry without files.)\n",
  );
}

function main() {
  const sa = SPRINT.parseSprintArg(process.argv);
  if (sa.error) return 1;
  const args = parseArgs(process.argv);
  const rows = gatherRows();
  if (args.json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    return 0;
  }
  renderTable(rows);
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, gatherRows };
