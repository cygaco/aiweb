#!/usr/bin/env node

/**
 * scripts/sprint/external-service.js — External Service Dependency lifecycle.
 *
 * Subcommands:
 *   create   --name "<service>" --category <cat> --purpose "<text>" [--phase plan|design|execute|release|any]
 *            [--signup] [--billing] [--credentials] [--oauth] [--dns] [--compliance]
 *            [--approval-required] [--related-ticket <T-...>]
 *   update   --id <ESD-...> [--status <s>] [--owner <name>] [--mock-strategy "<text>"]
 *            [--add-env "<NAME>" [--env-secret true|false] [--env-description "<text>"]]
 *            [--add-human-step "<text>" [--step-owner <name>] [--step-status <s>]]
 *            [--add-terminal-step "<text>" [--terminal-status <s>]]
 *   list     [--status <s>]
 *   show     --id <ESD-...>
 *   gate     [--phase <p>]        (exits non-zero if any required ESD for phase is blocked)
 *
 * Statuses: identified, needs_human_signup, needs_credentials, needs_billing,
 *   needs_configuration, ready_for_terminal_work, mocked, integrated, blocked,
 *   deferred, abandoned.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const SPRINT = require("./paths");
const { readYamlMaybe, writeYaml, ensureDir, nowIso } = require("./fs");
const { esdId: newEsdId } = require("./ids");

const VALID_STATUSES = [
  "identified",
  "needs_human_signup",
  "needs_credentials",
  "needs_billing",
  "needs_configuration",
  "ready_for_terminal_work",
  "mocked",
  "integrated",
  "blocked",
  "deferred",
  "abandoned",
];
const READY_STATES = new Set([
  "ready_for_terminal_work",
  "mocked",
  "integrated",
  "deferred",
]);

function esdPath(id) {
  return path.join(SPRINT.externalServices, `${id}.yaml`);
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

function cmdCreate(argv) {
  const f = parseFlags(argv, 3);
  if (!f.name || !f.category || !f.purpose) {
    process.stderr.write("create requires --name --category --purpose\n");
    return 2;
  }
  const current = readYamlMaybe(SPRINT.current);
  if (!current) {
    process.stderr.write("no current-sprint.yaml — run /sprint:plan first\n");
    return 1;
  }
  ensureDir(SPRINT.externalServices);
  const id = newEsdId(SPRINT.externalServices);
  const now = nowIso();
  const esd = {
    schema: "warpos/sprint/external-service-dependency/v1",
    id,
    sprint: current.id,
    related_ticket: f["related-ticket"] || null,
    service_name: f.name,
    service_category: f.category,
    purpose: f.purpose,
    required_for: [],
    required_phase: f.phase || "any",
    status: "identified",
    signup_required: f.signup === true,
    billing_required: f.billing === true,
    credentials_required: f.credentials === true,
    oauth_required: f.oauth === true,
    domain_dns_required: f.dns === true,
    compliance_review_required: f.compliance === true,
    human_owner: f.owner || null,
    terminal_implementable_after_setup: true,
    can_mock: f["can-mock"] !== "false",
    mock_strategy: f["mock-strategy"] || "",
    sandbox_available: f.sandbox !== "false",
    production_required: f.production === true,
    approval_required: f["approval-required"] === true,
    approval_state:
      f["approval-required"] === true ? "pending" : "not_required",
    approval_ref: null,
    required_env_vars: [],
    human_setup_steps: [],
    terminal_setup_steps: [],
    risks: [],
    blockers: [],
    notes: f.notes || "",
    created_at: now,
    updated_at: now,
  };
  writeYaml(esdPath(id), esd);
  // surface in current.external_services.identified
  if (!current.external_services) {
    current.external_services = {
      identified: [],
      blocked: [],
      ready: [],
      mocked: [],
      deferred: [],
    };
  }
  if (!current.external_services.identified.includes(id)) {
    current.external_services.identified.push(id);
  }
  current.updated_at = now;
  writeYaml(SPRINT.current, current);
  process.stdout.write(
    `created ${id} (${esd.service_category}) — ${esd.service_name}\n`,
  );
  return 0;
}

function moveCurrentBucket(current, id, fromKey, toKey) {
  if (!current.external_services) return;
  for (const k of Object.keys(current.external_services)) {
    current.external_services[k] = (current.external_services[k] || []).filter(
      (x) => x !== id,
    );
  }
  if (toKey && current.external_services[toKey]) {
    if (!current.external_services[toKey].includes(id)) {
      current.external_services[toKey].push(id);
    }
  }
}

function cmdUpdate(argv) {
  const f = parseFlags(argv, 3);
  if (!f.id) {
    process.stderr.write("update requires --id\n");
    return 2;
  }
  const ep = esdPath(f.id);
  const esd = readYamlMaybe(ep);
  if (!esd) {
    process.stderr.write(`no ESD: ${ep}\n`);
    return 1;
  }
  const previousStatus = esd.status;
  if (f.status) {
    if (!VALID_STATUSES.includes(f.status)) {
      process.stderr.write(`invalid status ${f.status}\n`);
      return 2;
    }
    esd.status = f.status;
  }
  if (f.owner) esd.human_owner = f.owner;
  if (f["mock-strategy"]) esd.mock_strategy = f["mock-strategy"];
  if (f["approval-ref"]) esd.approval_ref = f["approval-ref"];
  if (f["add-env"]) {
    esd.required_env_vars.push({
      name: f["add-env"],
      description: f["env-description"] || "",
      required_for: f["env-required-for"] || "",
      secret: f["env-secret"] !== "false",
    });
  }
  if (f["add-human-step"]) {
    esd.human_setup_steps.push({
      step: f["add-human-step"],
      owner: f["step-owner"] || "",
      status: f["step-status"] || "not_started",
      evidence_required: f["step-evidence"] || "",
    });
  }
  if (f["add-terminal-step"]) {
    esd.terminal_setup_steps.push({
      step: f["add-terminal-step"],
      command_or_file: f["step-cmd"] || "",
      status: f["terminal-status"] || "not_started",
    });
  }
  esd.updated_at = nowIso();
  writeYaml(ep, esd);

  // Mirror status into current-sprint buckets.
  const current = readYamlMaybe(SPRINT.current);
  if (current) {
    let bucket = "identified";
    if (esd.status === "ready_for_terminal_work" || esd.status === "integrated")
      bucket = "ready";
    else if (esd.status === "mocked") bucket = "mocked";
    else if (esd.status === "deferred") bucket = "deferred";
    else if (esd.status === "blocked") bucket = "blocked";
    moveCurrentBucket(current, esd.id, previousStatus, bucket);
    current.updated_at = nowIso();
    writeYaml(SPRINT.current, current);
  }
  process.stdout.write(`updated ${esd.id} status=${esd.status}\n`);
  return 0;
}

function cmdList(argv) {
  const f = parseFlags(argv, 3);
  if (!fs.existsSync(SPRINT.externalServices)) {
    process.stdout.write("no external-services directory yet\n");
    return 0;
  }
  const files = fs
    .readdirSync(SPRINT.externalServices)
    .filter((x) => x.endsWith(".yaml"));
  let count = 0;
  for (const file of files.sort()) {
    const e = readYamlMaybe(path.join(SPRINT.externalServices, file));
    if (!e) continue;
    if (f.status && e.status !== f.status) continue;
    process.stdout.write(
      `${e.id}  ${e.status.padEnd(28)}  ${e.service_category.padEnd(16)}  ${e.service_name}\n`,
    );
    count++;
  }
  process.stdout.write(`(${count} ESD)\n`);
  return 0;
}

function cmdShow(argv) {
  const f = parseFlags(argv, 3);
  if (!f.id) {
    process.stderr.write("show requires --id\n");
    return 2;
  }
  const e = readYamlMaybe(esdPath(f.id));
  if (!e) {
    process.stderr.write(`no ESD: ${f.id}\n`);
    return 1;
  }
  process.stdout.write(JSON.stringify(e, null, 2) + "\n");
  return 0;
}

function cmdGate(argv) {
  const f = parseFlags(argv, 3);
  const phase = f.phase || "execute";
  if (!fs.existsSync(SPRINT.externalServices)) return 0;
  const files = fs
    .readdirSync(SPRINT.externalServices)
    .filter((x) => x.endsWith(".yaml"));
  const offenders = [];
  for (const file of files) {
    const e = readYamlMaybe(path.join(SPRINT.externalServices, file));
    if (!e) continue;
    if (e.required_phase !== "any" && e.required_phase !== phase) continue;
    if (!READY_STATES.has(e.status)) {
      offenders.push(`${e.id} (${e.status}) — ${e.service_name}`);
    }
    if (
      e.approval_required &&
      e.approval_state !== "approved" &&
      e.approval_state !== "waived"
    ) {
      offenders.push(
        `${e.id} approval ${e.approval_state} — ${e.service_name}`,
      );
    }
  }
  if (offenders.length) {
    process.stderr.write(`ESD gate (${phase}) FAILED:\n`);
    for (const o of offenders) process.stderr.write(`  ${o}\n`);
    return 1;
  }
  process.stdout.write(`ESD gate (${phase}) ok\n`);
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
    case "list":
      return cmdList(process.argv);
    case "show":
      return cmdShow(process.argv);
    case "gate":
      return cmdGate(process.argv);
    default:
      process.stderr.write(
        "usage: external-service.js <create|update|list|show|gate> [flags]\n",
      );
      return 2;
  }
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, VALID_STATUSES, READY_STATES };
