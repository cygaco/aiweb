#!/usr/bin/env node

/**
 * scripts/sprint/routing.js — Sprint routing policy loader.
 *
 * Loads paths.sprintRouting and answers:
 *   - which model_class is declared for a given phase
 *   - which providers fall into that class
 *   - whether diff_review is required
 *
 * Usage:
 *   node scripts/sprint/routing.js                    (print full policy)
 *   node scripts/sprint/routing.js phase <name>       (print policy for one phase)
 *   node scripts/sprint/routing.js validate           (self-test references)
 *
 * Exit codes:
 *   0 ok
 *   1 unknown phase or policy file missing
 *   2 bad usage
 */

"use strict";

const fs = require("fs");
const SPRINT = require("./paths");

function loadPolicy() {
  try {
    return JSON.parse(fs.readFileSync(SPRINT.routing, "utf8"));
  } catch (err) {
    return null;
  }
}

function cmdPhase(name) {
  const p = loadPolicy();
  if (!p) {
    process.stderr.write(`policy missing: ${SPRINT.routing}\n`);
    return 1;
  }
  const pol = p.policies && p.policies[name];
  if (!pol) {
    process.stderr.write(
      `unknown phase ${name}. valid: ${Object.keys(p.policies).join(", ")}\n`,
    );
    return 1;
  }
  const cls = pol.model_class;
  const providers = (p.model_classes && p.model_classes[cls]) || [];
  process.stdout.write(
    JSON.stringify(
      {
        phase: name,
        model_class: cls,
        diff_review: !!pol.diff_review,
        escalate_to: pol.escalate_to || null,
        providers,
        rationale: pol.rationale || "",
      },
      null,
      2,
    ) + "\n",
  );
  return 0;
}

function cmdValidate() {
  const p = loadPolicy();
  if (!p) {
    process.stderr.write("missing policy file\n");
    return 1;
  }
  const errors = [];
  for (const [phase, pol] of Object.entries(p.policies || {})) {
    if (!pol.model_class) {
      errors.push(`phase ${phase}: no model_class`);
      continue;
    }
    if (!p.model_classes || !p.model_classes[pol.model_class]) {
      errors.push(
        `phase ${phase}: model_class ${pol.model_class} not declared in model_classes`,
      );
    }
    if (
      pol.escalate_to &&
      p.model_classes &&
      !p.model_classes[pol.escalate_to]
    ) {
      errors.push(
        `phase ${phase}: escalate_to ${pol.escalate_to} not declared`,
      );
    }
  }
  if (errors.length) {
    for (const e of errors) process.stderr.write(`routing: ${e}\n`);
    return 1;
  }
  process.stdout.write(
    `sprint routing policy ok (${Object.keys(p.policies).length} phases)\n`,
  );
  return 0;
}

function main() {
  const cmd = process.argv[2];
  if (!cmd) {
    const p = loadPolicy();
    if (!p) return 1;
    process.stdout.write(JSON.stringify(p, null, 2) + "\n");
    return 0;
  }
  if (cmd === "phase") return cmdPhase(process.argv[3]);
  if (cmd === "validate") return cmdValidate();
  process.stderr.write("usage: routing.js [phase <name> | validate]\n");
  return 2;
}

if (require.main === module) {
  process.exit(main());
}

function concurrency() {
  const p = loadPolicy();
  if (!p) return null;
  return (
    p.concurrency || {
      max_lanes: 1,
      default_lane: "default",
      default_isolation: "worktree",
    }
  );
}

module.exports = { loadPolicy, cmdValidate, concurrency };
