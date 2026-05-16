#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * scripts/sprint/test-ticket-bucket-bleed.js — smoke test for the
 * --sprint disambiguation guard in ticket.js#cmdCreate.
 *
 * Builds a synthetic project with two active sprints and verifies:
 *   1. omit --sprint -> exit 2 + clear error mentioning both sprint ids
 *   2. pass --sprint <id>   -> exit 0 + output tagged "[sprint: <id>]"
 *   3. pass --sprint=<id>   -> exit 0 + output tagged "[sprint: <id>]"
 *
 * Also verifies the silent-fallback path is preserved when ≤1 sprint
 * is active (no ambiguity).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");

let passed = 0;
let failed = 0;

function ok(name) {
  passed++;
  process.stdout.write(`  ok    ${name}\n`);
}
function fail(name, detail) {
  failed++;
  process.stdout.write(`  FAIL  ${name}\n`);
  if (detail) process.stdout.write(`        ${detail}\n`);
}

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    const d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

function buildProject(activeStatuses) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "warpos-ticket-bleed-"));
  for (const rel of [
    ".claude/paths.json",
    "schemas/sprint",
    "framework/templates/sprint",
    ".claude/agents/00-alex/.system/policy/sprint-routing.json",
  ]) {
    const src = path.join(REPO, rel);
    const dst = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (fs.statSync(src).isDirectory()) copyDirSync(src, dst);
    else fs.copyFileSync(src, dst);
  }
  fs.mkdirSync(path.join(tmp, "scripts/hooks/lib"), { recursive: true });
  fs.copyFileSync(
    path.join(REPO, "scripts/hooks/lib/paths.generated.js"),
    path.join(tmp, "scripts/hooks/lib/paths.generated.js"),
  );

  const yaml = require(path.join(REPO, "scripts/sprint/fs.js"));
  const sprints = activeStatuses.map((status, i) => {
    const id = `SP-TEST-${String(i + 1).padStart(3, "0")}`;
    return {
      id,
      title: `Sprint ${id}`,
      status,
      layout: "per_sprint_subdir",
      pointer: `.claude/project/sprint/sprints/${id}`,
      created_at: "2026-05-13T00:00:00Z",
      updated_at: "2026-05-13T00:00:00Z",
      lane: { type: "default", value: null, isolation_notes: "" },
    };
  });
  const registry = {
    schema: "warpos/sprint/active-sprints/v1",
    primary: sprints[0].id,
    sprints,
    created_at: "2026-05-13T00:00:00Z",
    updated_at: "2026-05-13T00:00:00Z",
  };
  yaml.writeYaml(
    path.join(tmp, ".claude/project/sprint/active-sprints.yaml"),
    registry,
  );
  fs.mkdirSync(path.join(tmp, ".claude/project/sprint/tickets"), {
    recursive: true,
  });

  for (const s of sprints) {
    const dir = path.join(tmp, s.pointer);
    fs.mkdirSync(dir, { recursive: true });
    yaml.writeYaml(path.join(dir, "current.yaml"), {
      schema: "warpos/sprint/current-sprint/v1",
      id: s.id,
      title: s.title,
      status: s.status,
      current_phase: "execute",
      source_request: "",
      plan_contract: "",
      tickets: {
        proposed: [],
        planned: [],
        designed: [],
        ready_for_execution: [],
        in_progress: [],
        blocked: [],
        waiting_on_human: [],
        waiting_on_external_service: [],
        in_review: [],
        qa_failed: [],
        redteam_failed: [],
        done: [],
        released: [],
        deferred: [],
        abandoned: [],
        reopened: [],
        superseded: [],
      },
      created_at: "2026-05-13T00:00:00Z",
      updated_at: "2026-05-13T00:00:00Z",
    });
  }
  return { tmp, sprints };
}

function runTicket(tmp, args) {
  return spawnSync(
    process.execPath,
    [path.join(REPO, "scripts/sprint/ticket.js"), ...args],
    {
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmp },
      encoding: "utf8",
    },
  );
}

// ── Case A: two active sprints (ambiguous) ────────────────────────
{
  const { tmp, sprints } = buildProject(["executing", "designing"]);

  // 1. omit --sprint -> exit 2
  const r1 = runTicket(tmp, [
    "create",
    "--title",
    "smoke-no-sprint",
    "--type",
    "chore",
  ]);
  if (r1.status === 2 && /multiple active sprints/.test(r1.stderr)) {
    ok("ambiguous + no --sprint -> exit 2 with clear error");
  } else {
    fail(
      "ambiguous + no --sprint -> exit 2 with clear error",
      `got code=${r1.status} stderr=${r1.stderr.trim()}`,
    );
  }
  if (sprints.every((s) => r1.stderr.includes(s.id))) {
    ok("error names all available sprint ids");
  } else {
    fail("error names all available sprint ids", r1.stderr.trim());
  }

  // 2. --sprint <id>
  const r2 = runTicket(tmp, [
    "create",
    "--title",
    "smoke-with-sprint",
    "--type",
    "chore",
    "--sprint",
    sprints[1].id,
  ]);
  if (
    r2.status === 0 &&
    r2.stdout.includes(`[sprint: ${sprints[1].id}]`) &&
    r2.stdout.includes("created T-")
  ) {
    ok("explicit --sprint <id> -> exit 0 with sprint-tagged output");
  } else {
    fail(
      "explicit --sprint <id> -> exit 0 with sprint-tagged output",
      `code=${r2.status} stdout=${r2.stdout.trim()} stderr=${r2.stderr.trim()}`,
    );
  }

  // 3. --sprint=<id> form
  const r3 = runTicket(tmp, [
    "create",
    "--title",
    "smoke-eqform",
    "--type",
    "chore",
    `--sprint=${sprints[0].id}`,
  ]);
  if (r3.status === 0 && r3.stdout.includes(`[sprint: ${sprints[0].id}]`)) {
    ok("explicit --sprint=<id> -> exit 0 with sprint-tagged output");
  } else {
    fail(
      "explicit --sprint=<id> -> exit 0 with sprint-tagged output",
      `code=${r3.status} stdout=${r3.stdout.trim()} stderr=${r3.stderr.trim()}`,
    );
  }

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── Case B: only one active sprint (silent fallback preserved) ──
{
  const { tmp, sprints } = buildProject(["executing", "retrospected"]);
  const r = runTicket(tmp, [
    "create",
    "--title",
    "smoke-unambiguous",
    "--type",
    "chore",
  ]);
  if (r.status === 0 && r.stdout.includes(`[sprint: ${sprints[0].id}]`)) {
    ok("1 active + no --sprint -> silent fallback to that sprint");
  } else {
    fail(
      "1 active + no --sprint -> silent fallback to that sprint",
      `code=${r.status} stdout=${r.stdout.trim()} stderr=${r.stderr.trim()}`,
    );
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── Case C: zero active sprints (all closed/retrospected) ────────
{
  const { tmp, sprints } = buildProject(["retrospected", "closed"]);
  // Primary still resolves to first entry; loadCurrent reads its current.yaml.
  const r = runTicket(tmp, [
    "create",
    "--title",
    "smoke-zero-active",
    "--type",
    "chore",
  ]);
  if (r.status === 0 && r.stdout.includes(`[sprint: ${sprints[0].id}]`)) {
    ok(
      "0 active + no --sprint -> silent fallback (degenerate but unambiguous)",
    );
  } else {
    fail(
      "0 active + no --sprint -> silent fallback",
      `code=${r.status} stdout=${r.stdout.trim()} stderr=${r.stderr.trim()}`,
    );
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
