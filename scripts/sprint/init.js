#!/usr/bin/env node

/**
 * scripts/sprint/init.js — Sprint Workflow v0.1 downstream init.
 *
 * Creates the .claude/project/sprint/ tracker tree from templates
 * in framework/templates/sprint/init/. Safe to run multiple times —
 * refuses to overwrite existing files unless --force.
 *
 * Usage:
 *   node scripts/sprint/init.js                 (initialize if missing)
 *   node scripts/sprint/init.js --force         (recreate from templates)
 *   node scripts/sprint/init.js --status        (report what exists)
 *   node scripts/sprint/init.js --project "<name>"  (project_name placeholder)
 *
 * Exit codes:
 *   0  init done or already exists
 *   1  template load failed
 *   2  bad args
 *
 * SCHEMA FIELD REMINDER (2026-05-13 — see LRN row 28):
 *   Every sprint yaml under paths.sprintRoot MUST emit a `schema:` header
 *   matching `warpos/sprint/<kind>/v1`. The sprint-tracker-guard hook
 *   fires a warn on every Write that omits it (21x warns in 3d). The
 *   init.js templates + ensureActiveRegistry() below already include the
 *   field — DO NOT remove it from a template "to simplify" it. If you
 *   add a new yaml writer (release.js, plan.js, checkpoint.js, etc.) or
 *   a fresh template under framework/templates/sprint/<kind>/, schema:
 *   is the FIRST key. Schemas live in schemas/sprint/*.schema.json.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const SPRINT = require("./paths");
const {
  ensureDir,
  readText,
  writeText,
  writeYaml,
  readYamlMaybe,
  render,
  nowIso,
} = require("./fs");
const { sprintId } = require("./ids");

function parseArgs(argv) {
  const out = { force: false, status: false, project: "your project" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") out.force = true;
    else if (a === "--status") out.status = true;
    else if (a === "--project") out.project = argv[++i] || "your project";
  }
  return out;
}

function status() {
  const dirs = [
    ["root", SPRINT.root],
    ["plan-contracts", SPRINT.planContracts],
    ["tickets", SPRINT.tickets],
    ["issues", SPRINT.issues],
    ["external-services", SPRINT.externalServices],
    ["releases", SPRINT.releases],
    ["approvals", SPRINT.approvals],
    ["decisions", SPRINT.decisions],
    ["ralph", SPRINT.ralph],
    ["checkpoints", SPRINT.checkpoints],
    ["requirements", SPRINT.requirements],
    ["history", SPRINT.history],
    ["sprints (v0.2 per-sprint subdirs)", SPRINT.sprints],
  ];
  const files = [
    ["current-sprint.yaml (legacy v0.1)", SPRINT.current],
    ["sprint-progress.yaml (legacy v0.1)", SPRINT.progress],
    ["active-sprints.yaml (v0.2 registry)", SPRINT.activeRegistry],
    ["issues.md (repo root)", SPRINT.issuesLedger],
  ];
  let total = 0,
    present = 0;
  process.stdout.write("scripts/sprint/init.js — tracker status\n");
  for (const [label, d] of dirs) {
    total++;
    const ok = fs.existsSync(d);
    if (ok) present++;
    process.stdout.write(`  [${ok ? "x" : " "}] dir ${label}: ${d}\n`);
  }
  for (const [label, f] of files) {
    total++;
    const ok = fs.existsSync(f);
    if (ok) present++;
    process.stdout.write(`  [${ok ? "x" : " "}] file ${label}: ${f}\n`);
  }
  process.stdout.write(`  ${present}/${total} present\n`);
  return 0;
}

function init(args) {
  const tmplDir = path.join(SPRINT.templates, "init");
  if (!fs.existsSync(tmplDir)) {
    process.stderr.write(`init templates missing: ${tmplDir}\n`);
    return 1;
  }
  // mkdir tree
  for (const d of [
    SPRINT.root,
    SPRINT.planContracts,
    SPRINT.tickets,
    SPRINT.issues,
    SPRINT.externalServices,
    SPRINT.releases,
    SPRINT.approvals,
    SPRINT.decisions,
    SPRINT.ralph,
    SPRINT.checkpoints,
    SPRINT.requirements,
    SPRINT.history,
    SPRINT.sprints,
  ]) {
    ensureDir(d);
  }
  // v0.2 — if an existing registry already lists primary, treat the
  // install as upgraded and reuse the primary id. Otherwise bootstrap
  // a new id and seed the registry in per_sprint_subdir layout.
  const existingRegistry = readYamlMaybe(SPRINT.activeRegistry);
  let sid;
  let layout;
  let pointer;
  if (existingRegistry && existingRegistry.primary) {
    sid = existingRegistry.primary;
    const e = (existingRegistry.sprints || []).find((s) => s.id === sid);
    layout = (e && e.layout) || "per_sprint_subdir";
    pointer = (e && e.pointer) || `.claude/project/sprint/sprints/${sid}`;
  } else {
    sid = sprintId(SPRINT.history);
    layout = "per_sprint_subdir";
    pointer = `.claude/project/sprint/sprints/${sid}`;
    // Seed the registry BEFORE writing the templates so SPRINT.current /
    // SPRINT.progress getters resolve to the per_sprint_subdir layout.
    const registryRes = ensureActiveRegistry(sid, args.force, layout, pointer);
    if (!registryRes.wrote) {
      // Should not happen — we just checked it doesn't exist.
      process.stderr.write("could not write active-sprints registry\n");
      return 1;
    }
    process.stdout.write(`  wrote  ${SPRINT.activeRegistry}\n`);
  }
  const now = nowIso();
  const data = {
    sprint_id: sid,
    sprint_title: "Initial sprint placeholder",
    sprint_objective: "Run /sprint:plan to set this.",
    created_at: now,
    updated_at: now,
    project_name: args.project,
  };
  // For per_sprint_subdir, ensure the sprint's pointer dir exists.
  if (layout === "per_sprint_subdir") {
    ensureDir(path.join(SPRINT.PROJECT, pointer));
  }
  const targets = [
    {
      tmpl: path.join(tmplDir, "current-sprint.yaml.tmpl"),
      out: SPRINT.current,
    },
    {
      tmpl: path.join(tmplDir, "sprint-progress.yaml.tmpl"),
      out: SPRINT.progress,
    },
    {
      tmpl: path.join(tmplDir, "README.md.tmpl"),
      out: path.join(SPRINT.root, "README.md"),
    },
    {
      tmpl: path.join(tmplDir, "issues.md.tmpl"),
      out: SPRINT.issuesLedger,
    },
  ];
  let wrote = 0,
    skipped = 0;
  for (const t of targets) {
    const text = readText(t.tmpl);
    if (text === null) {
      process.stderr.write(`missing template: ${t.tmpl}\n`);
      continue;
    }
    const rendered = render(text, data);
    const res = writeText(t.out, rendered, { force: args.force });
    if (res.wrote) wrote++;
    else skipped++;
    process.stdout.write(`  ${res.wrote ? "wrote " : "skip  "} ${t.out}\n`);
  }
  process.stdout.write(
    `init: ${wrote} written, ${skipped} skipped (existing). Sprint id = ${sid} (layout=${layout}).\n`,
  );
  return 0;
}

// v0.2 — seed paths.sprintActiveRegistry with the bootstrap sprint.
// Layout is `per_sprint_subdir` for fresh installs (T-20260512-001/002).
// Existing legacy_root installs stay legacy until migrate-v0.2.js runs.
function ensureActiveRegistry(
  sid,
  force,
  layout = "per_sprint_subdir",
  pointer = null,
) {
  if (fs.existsSync(SPRINT.activeRegistry) && !force) {
    return { wrote: false, reason: "exists" };
  }
  const now = nowIso();
  const resolvedPointer =
    pointer ||
    (layout === "legacy_root"
      ? ".claude/project/sprint"
      : `.claude/project/sprint/sprints/${sid}`);
  const registry = {
    schema: "warpos/sprint/active-sprints/v1",
    primary: sid,
    sprints: [
      {
        id: sid,
        title: "Initial sprint placeholder",
        status: "not_started",
        lane: { type: "default", value: null, isolation_notes: "" },
        layout,
        pointer: resolvedPointer,
        created_at: now,
        updated_at: now,
      },
    ],
    created_at: now,
    updated_at: now,
  };
  writeYaml(SPRINT.activeRegistry, registry);
  return { wrote: true, reason: "ok" };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.status) return status();
  return init(args);
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { init, status, ensureActiveRegistry };
