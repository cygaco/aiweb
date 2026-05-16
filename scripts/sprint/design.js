#!/usr/bin/env node

/**
 * scripts/sprint/design.js — /sprint:design scaffolder.
 *
 * Renders the requirements bundle (PRD, stories, COPY, INPUTS, TRACE,
 * AC, QA, redteam, release plan) for a sprint under
 * paths.sprintRequirements/<sprint-id>/ and updates current-sprint.yaml
 * to reference them.
 *
 * Tickets are NOT minted here — that's a separate call to
 * scripts/sprint/ticket.js#create. /sprint:design's skill body invokes
 * both: first this scaffolder, then ticket creation per granular story.
 *
 * Usage:
 *   node scripts/sprint/design.js [--documentation-scale xs|s|m|l|xl]
 *
 * Reads:
 *   paths.sprintCurrent
 *   paths.sprintPlanContracts/<current.plan_contract basename>.yaml
 *
 * Writes:
 *   paths.sprintRequirements/<sprint-id>/{prd,high-level-stories,
 *     granular-stories,copy,inputs,trace,acceptance-criteria,
 *     qa-plan,redteam-plan,release-plan}.md
 *   Updates paths.sprintCurrent.requirements.*
 */

"use strict";

const fs = require("fs");
const path = require("path");
const SPRINT = require("./paths");
const {
  ensureDir,
  readText,
  writeText,
  render,
  readYamlMaybe,
  writeYaml,
  nowIso,
} = require("./fs");

function parseArgs(argv) {
  const out = { docScale: "m", force: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--documentation-scale") out.docScale = argv[++i] || "m";
    else if (argv[i] === "--force") out.force = true;
  }
  return out;
}

function loadPlanContract(current) {
  if (!current.plan_contract) return null;
  const resolved = path.resolve(SPRINT.PROJECT, current.plan_contract);
  return readYamlMaybe(resolved);
}

function scaffold(args) {
  const current = readYamlMaybe(SPRINT.current);
  if (!current) {
    process.stderr.write(
      "no current-sprint.yaml — run scripts/sprint/init.js first\n",
    );
    return 1;
  }
  const plan = loadPlanContract(current);
  if (!plan) {
    process.stderr.write(
      "current-sprint has no plan_contract — run /sprint:plan first\n",
    );
    return 1;
  }
  const outDir = path.join(SPRINT.requirements, current.id);
  ensureDir(outDir);

  const data = {
    sprint_id: current.id,
    sprint_title: current.title,
    plan_contract_id: plan.id,
    plan_contract_path: current.plan_contract,
    prd_path: path.join(outDir, "prd.md"),
    high_level_stories_path: path.join(outDir, "high-level-stories.md"),
    granular_stories_path: path.join(outDir, "granular-stories.md"),
    copy_path: path.join(outDir, "copy.md"),
    inputs_path: path.join(outDir, "inputs.md"),
    trace_path: path.join(outDir, "trace.md"),
    acceptance_criteria_path: path.join(outDir, "acceptance-criteria.md"),
    qa_plan_path: path.join(outDir, "qa-plan.md"),
    redteam_plan_path: path.join(outDir, "redteam-plan.md"),
    release_plan_path: path.join(outDir, "release-plan.md"),
    documentation_scale: args.docScale,
    user_or_business_outcome: plan.user_or_business_outcome,
    source_request_verbatim: plan.source_request_verbatim,
    interpreted_intent: plan.interpreted_intent,
    current_behavior_notes: (plan.current_behavior || {}).notes || "",
    desired_behavior: plan.desired_behavior,
    surface_1: (plan.affected_surfaces[0] || {}).surface || "—",
    surface_1_evidence: (plan.affected_surfaces[0] || {}).evidence_level || "—",
    requirement_1: plan.requirement_areas[0] || "—",
    requirement_2: plan.requirement_areas[1] || "—",
    requirement_3: plan.requirement_areas[2] || "—",
    non_goal_1: plan.non_goals[0] || "—",
    hl_story_1_title: plan.high_level_story_candidates[0] || "—",
    hl_story_1_persona: "the user",
    hl_story_1_want: plan.high_level_story_candidates[0] || "—",
    hl_story_1_outcome: plan.user_or_business_outcome || "—",
    hl_story_2_title: plan.high_level_story_candidates[1] || "—",
    hl_story_2_persona: "the user",
    hl_story_2_want: plan.high_level_story_candidates[1] || "—",
    hl_story_2_outcome: plan.user_or_business_outcome || "—",
    story_1_title: plan.granular_story_candidates[0] || "—",
    story_1_persona: "the user",
    story_1_want: plan.granular_story_candidates[0] || "—",
    story_1_outcome: plan.user_or_business_outcome || "—",
    story_1_ac_1: "(set by design step)",
    story_1_ac_2: "(set by design step)",
    story_2_title: plan.granular_story_candidates[1] || "—",
    story_2_persona: "the user",
    story_2_want: plan.granular_story_candidates[1] || "—",
    story_2_outcome: plan.user_or_business_outcome || "—",
    story_2_ac_1: "(set by design step)",
  };

  const targets = [
    ["prd.md.tmpl", "prd.md"],
    ["high-level-stories.md.tmpl", "high-level-stories.md"],
    ["granular-stories.md.tmpl", "granular-stories.md"],
    ["copy.md.tmpl", "copy.md"],
    ["inputs.md.tmpl", "inputs.md"],
    ["trace.md.tmpl", "trace.md"],
    ["acceptance-criteria.md.tmpl", "acceptance-criteria.md"],
    ["qa-plan.md.tmpl", "qa-plan.md"],
    ["redteam-plan.md.tmpl", "redteam-plan.md"],
    ["release-plan.md.tmpl", "release-plan.md"],
  ];
  // documentation scaling — for xs/s, skip redteam and release-plan.
  const skip = new Set();
  if (args.docScale === "xs" || args.docScale === "s") {
    skip.add("redteam-plan.md");
    skip.add("release-plan.md");
  }
  if (args.docScale === "xs") {
    skip.add("copy.md");
    skip.add("inputs.md");
    skip.add("trace.md");
  }

  let wrote = 0,
    skipped = 0;
  for (const [tmplName, outName] of targets) {
    if (skip.has(outName)) {
      process.stdout.write(`  skip-by-scale ${outName}\n`);
      continue;
    }
    const tmpl = readText(
      path.join(SPRINT.templates, "requirements", tmplName),
    );
    if (!tmpl) {
      process.stderr.write(`missing template: ${tmplName}\n`);
      continue;
    }
    const rendered = render(tmpl, data);
    const res = writeText(path.join(outDir, outName), rendered, {
      force: args.force,
    });
    if (res.wrote) wrote++;
    else skipped++;
    process.stdout.write(`  ${res.wrote ? "wrote" : "skip "} ${outName}\n`);
  }

  // Update current-sprint.requirements.
  current.requirements.prd = path.join(
    SPRINT.requirements,
    current.id,
    "prd.md",
  );
  current.requirements.high_level_stories = path.join(
    SPRINT.requirements,
    current.id,
    "high-level-stories.md",
  );
  current.requirements.granular_stories = path.join(
    SPRINT.requirements,
    current.id,
    "granular-stories.md",
  );
  current.requirements.copy = skip.has("copy.md")
    ? null
    : path.join(SPRINT.requirements, current.id, "copy.md");
  current.requirements.inputs = skip.has("inputs.md")
    ? null
    : path.join(SPRINT.requirements, current.id, "inputs.md");
  current.requirements.trace = skip.has("trace.md")
    ? null
    : path.join(SPRINT.requirements, current.id, "trace.md");
  current.requirements.acceptance_criteria = path.join(
    SPRINT.requirements,
    current.id,
    "acceptance-criteria.md",
  );
  current.requirements.qa_plan = path.join(
    SPRINT.requirements,
    current.id,
    "qa-plan.md",
  );
  current.requirements.redteam_plan = skip.has("redteam-plan.md")
    ? null
    : path.join(SPRINT.requirements, current.id, "redteam-plan.md");
  current.requirements.release_plan = skip.has("release-plan.md")
    ? null
    : path.join(SPRINT.requirements, current.id, "release-plan.md");
  current.current_phase = "design";
  current.status = "designing";
  current.updated_at = nowIso();
  current.crash_recovery.resume_command = "/sprint:design";
  current.crash_recovery.resume_summary = `Sprint ${current.id} design scaffolded (scale=${args.docScale}). Next: mint tickets from granular-stories, then run /sprint:execute.`;
  writeYaml(SPRINT.current, current);

  process.stdout.write(
    `design: ${wrote} written, ${skipped} skipped at scale=${args.docScale}.\n`,
  );
  return 0;
}

function main() {
  const sa = SPRINT.parseSprintArg(process.argv);
  if (sa.error) return 1;
  const args = parseArgs(process.argv);
  return scaffold(args);
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, scaffold };
