#!/usr/bin/env node
/**
 * sprint-approval-guard.js — PreToolUse Bash hook.
 *
 * Sprint Workflow v0.1. Refuses Bash commands that would advance a
 * sprint past an approval boundary without a recorded approval.
 *
 * Specifically:
 *
 *   1. node scripts/sprint/release.js deploy --id <RL-id>
 *      → BLOCK unless releases/<RL-id>.yaml has approval_ref set AND
 *        the referenced approvals/<AP-id>.yaml has state in
 *        {approved, waived}.
 *
 *   2. node scripts/sprint/external-service.js update --id <ESD-id> --status integrated
 *      → BLOCK if the ESD has approval_required:true and the linked
 *        approval is not approved/waived.
 *
 *   3. node scripts/sprint/external-service.js update --id <ESD-id> --status ready_for_terminal_work
 *      → Same check (entering ready_for_terminal_work crosses the gate).
 *
 * Both checks fail OPEN on parse error (missing yaml, malformed yaml) so
 * the hook never accidentally breaks unrelated Bash work.
 *
 * Kill switch:
 *   env: SPRINT_APPROVAL_GUARD=off
 */

"use strict";

const fs = require("fs");
const path = require("path");

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

if (process.env.SPRINT_APPROVAL_GUARD === "off") process.exit(0);

function readStdinSync() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function emitBlock(detail) {
  try {
    const { logEvent } = require("./lib/logger");
    logEvent(
      "block",
      "system",
      "sprint-approval-guard",
      "",
      detail.slice(0, 400),
    );
  } catch {
    /* logger optional */
  }
  console.log(JSON.stringify({ decision: "block", reason: detail }));
  process.exit(0);
}

function readYamlMaybe(file) {
  try {
    const sprintFs = require(
      path.join(PROJECT_DIR, "scripts", "sprint", "fs.js"),
    );
    return sprintFs.readYamlMaybe(file);
  } catch {
    return null;
  }
}

function loadSprintPaths() {
  try {
    const raw = fs.readFileSync(
      path.join(PROJECT_DIR, ".claude", "paths.json"),
      "utf8",
    );
    const j = JSON.parse(raw);
    return {
      releases: j.sprintReleases,
      approvals: j.sprintApprovals,
      externalServices: j.sprintExternalServices,
    };
  } catch {
    return {
      releases: ".claude/project/sprint/releases",
      approvals: ".claude/project/sprint/approvals",
      externalServices: ".claude/project/sprint/external-services",
    };
  }
}

function abs(rel) {
  return path.join(PROJECT_DIR, rel);
}

function parseFlag(cmd, name) {
  // Match --name value (value may be quoted)
  const m1 = new RegExp(`--${name}\\s+([^\\s"'][^\\s]*)`).exec(cmd);
  if (m1) return m1[1];
  const m2 = new RegExp(`--${name}\\s+"([^"]+)"`).exec(cmd);
  if (m2) return m2[1];
  const m3 = new RegExp(`--${name}\\s+'([^']+)'`).exec(cmd);
  if (m3) return m3[1];
  return null;
}

function isReleaseDeploy(cmd) {
  return /\bnode\s+scripts[\\/]sprint[\\/]release\.js\s+deploy\b/.test(cmd);
}

function isEsdReady(cmd) {
  if (
    !/\bnode\s+scripts[\\/]sprint[\\/]external-service\.js\s+update\b/.test(cmd)
  )
    return false;
  const status = parseFlag(cmd, "status");
  return status === "integrated" || status === "ready_for_terminal_work";
}

function checkReleaseDeploy(cmd, sp) {
  const id = parseFlag(cmd, "id");
  if (!id) {
    // No id flag — release.js will error itself. Don't block.
    return null;
  }
  const releaseYaml = abs(path.join(sp.releases, `${id}.yaml`));
  const release = readYamlMaybe(releaseYaml);
  if (!release) {
    return `cannot read release record ${releaseYaml}. Run node scripts/sprint/release.js prepare first.`;
  }
  if (!release.approval_ref) {
    return (
      `release ${id} has no approval_ref set. Production deploy requires a ` +
      `recorded approval. Run node scripts/sprint/release.js approve --id ${id} --approval <AP-id> ` +
      `after the approval YAML records state=approved.`
    );
  }
  // approval_ref is a pointer; could be "AP-id" or a path.
  const approvalCandidate = release.approval_ref.endsWith(".yaml")
    ? release.approval_ref
    : path.join(sp.approvals, `${release.approval_ref}.yaml`);
  const approvalAbs = path.isAbsolute(approvalCandidate)
    ? approvalCandidate
    : abs(approvalCandidate);
  const approval = readYamlMaybe(approvalAbs);
  if (!approval) {
    return (
      `release ${id}.approval_ref points at ${approvalAbs} but that file is missing. ` +
      `Write the approval YAML before deploy.`
    );
  }
  if (approval.state !== "approved" && approval.state !== "waived") {
    return (
      `release ${id} approval ${approval.id || release.approval_ref} is state=${approval.state}. ` +
      `Required: approved or waived. Update the approval YAML decided_by + decided_at + state=approved ` +
      `before retrying deploy.`
    );
  }
  return null;
}

function checkEsdReady(cmd, sp) {
  const id = parseFlag(cmd, "id");
  if (!id) return null;
  const esdYaml = abs(path.join(sp.externalServices, `${id}.yaml`));
  const esd = readYamlMaybe(esdYaml);
  if (!esd) return null; // unknown ESD — let external-service.js handle it
  if (!esd.approval_required) return null;
  if (esd.approval_state === "approved" || esd.approval_state === "waived") {
    return null;
  }
  return (
    `ESD ${id} has approval_required:true but approval_state=${esd.approval_state || "missing"}. ` +
    `Cannot advance to ready_for_terminal_work/integrated until the linked approval is ` +
    `approved or waived. Write/update the approval YAML referenced by ${id}.approval_ref first.`
  );
}

function main() {
  let event;
  try {
    event = JSON.parse(readStdinSync() || "{}");
  } catch {
    process.exit(0);
  }
  const cmd = (event.tool_input && event.tool_input.command) || "";
  if (!cmd) process.exit(0);

  const sp = loadSprintPaths();
  let reason = null;
  if (isReleaseDeploy(cmd)) {
    reason = checkReleaseDeploy(cmd, sp);
  } else if (isEsdReady(cmd)) {
    reason = checkEsdReady(cmd, sp);
  }
  if (reason) {
    emitBlock(
      reason +
        "\n\nTo override, set SPRINT_APPROVAL_GUARD=off in your environment.",
    );
  }
  process.exit(0);
}

main();
