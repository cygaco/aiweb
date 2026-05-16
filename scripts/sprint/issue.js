#!/usr/bin/env node

/**
 * scripts/sprint/issue.js — Sprint issue helpers.
 *
 * Subcommands:
 *   create     --title "<t>" --severity <low|medium|high|critical>
 *              --source <manual_report|test_failure|...>
 *              --expected "<text>" --actual "<text>"
 *              [--related-ticket <T-...>] [--related-esd <ESD-...>]
 *   update     --id <I-...> [--status <s>] [--resolution "<text>"]
 *              [--add-fix-attempt "<approach>" --fix-outcome <passed|failed|partial|abandoned>]
 *   promote    --id <I-...> --to-ticket-type <type>  (creates a ticket linked to the issue)
 *   appendmd   --id <I-...>                          (re-emit issues.md block from yaml)
 *   list       [--status <s>]
 *
 * Writes:
 *   paths.sprintIssues/<id>.yaml
 *   paths.sprintIssuesLedger (issues.md at repo root) — appends a block
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
const { issueId: newIssueId } = require("./ids");

const VALID_STATUSES = [
  "open",
  "in_progress",
  "fixed",
  "verified",
  "deferred",
  "abandoned",
  "duplicate",
  "superseded",
  "waiting_on_human",
  "waiting_on_external_service",
];

const VALID_SOURCES = [
  "manual_report",
  "test_failure",
  "qa_finding",
  "redteam_finding",
  "release_finding",
  "telemetry",
  "user_report",
  "agent_observation",
  "other",
];

function issuePath(id) {
  return path.join(SPRINT.issues, `${id}.yaml`);
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

function appendIssuesMdBlock(issue) {
  const ledger = SPRINT.issuesLedger;
  ensureDir(path.dirname(ledger));
  const tmplPath = path.join(
    SPRINT.templates,
    "issue",
    "issues-md-block.md.tmpl",
  );
  const tmpl = readText(tmplPath);
  const data = {
    issue_id: issue.id,
    title: issue.title,
    status: issue.status,
    severity: issue.severity,
    discovered_at: issue.discovered_at,
    discovered_during: issue.discovered_during || "",
    sprint_id: issue.related_sprint || "",
    related_ticket_link: issue.related_ticket || "—",
    expected: issue.expected,
    actual: issue.actual,
    notes: issue.suspected_cause ? `> Suspected: ${issue.suspected_cause}` : "",
  };
  const block = tmpl
    ? render(tmpl, data)
    : `### ${issue.id} — ${issue.title}\n\nStatus: ${issue.status}\n`;
  // ensure ledger exists with a header
  if (!fs.existsSync(ledger)) {
    writeText(
      ledger,
      `# Issues\n\nHuman-readable companion to .claude/project/sprint/issues/*.yaml.\n\n`,
      { force: true },
    );
  }
  fs.appendFileSync(ledger, `\n${block}\n`, "utf8");
}

function cmdCreate(argv) {
  const f = parseFlags(argv, 3);
  if (!f.title || !f.severity || !f.source || !f.expected || !f.actual) {
    process.stderr.write(
      "create requires --title --severity --source --expected --actual\n",
    );
    return 2;
  }
  if (!VALID_SOURCES.includes(f.source)) {
    process.stderr.write(`invalid source ${f.source}\n`);
    return 2;
  }
  ensureDir(SPRINT.issues);
  const current = readYamlMaybe(SPRINT.current);
  const id = newIssueId(SPRINT.issues);
  const now = nowIso();
  const issue = {
    schema: "warpos/sprint/issue/v1",
    id,
    title: f.title,
    status: "open",
    severity: f.severity,
    source: f.source,
    discovered_at: now,
    discovered_during:
      f.during ||
      (current
        ? `${current.id}:${current.current_phase || "unknown"}`
        : "unknown"),
    related_feature: f["related-feature"] || null,
    related_ticket: f["related-ticket"] || null,
    related_sprint: current ? current.id : null,
    related_external_service: f["related-esd"] || null,
    steps_to_reproduce: [],
    expected: f.expected,
    actual: f.actual,
    suspected_cause: f["suspected-cause"] || "",
    fix_attempts: [],
    files_touched: [],
    current_recommendation: "",
    resolution: "",
    resolution_date: null,
    promoted_to_ticket: null,
    issues_md_block: null,
  };
  writeYaml(issuePath(id), issue);
  appendIssuesMdBlock(issue);
  issue.issues_md_block = `issues.md#${id.toLowerCase()}`;
  writeYaml(issuePath(id), issue);
  process.stdout.write(`created ${id} (open) — ${issue.title}\n`);
  return 0;
}

function cmdUpdate(argv) {
  const f = parseFlags(argv, 3);
  if (!f.id) {
    process.stderr.write("update requires --id\n");
    return 2;
  }
  const ip = issuePath(f.id);
  const issue = readYamlMaybe(ip);
  if (!issue) {
    process.stderr.write(`no issue: ${ip}\n`);
    return 1;
  }
  if (f.status) {
    if (!VALID_STATUSES.includes(f.status)) {
      process.stderr.write(`invalid status ${f.status}\n`);
      return 2;
    }
    issue.status = f.status;
    if (["fixed", "verified"].includes(f.status) && !issue.resolution_date) {
      issue.resolution_date = nowIso();
    }
  }
  if (f.resolution) issue.resolution = f.resolution;
  if (f.recommendation) issue.current_recommendation = f.recommendation;
  if (f["add-fix-attempt"]) {
    const n = issue.fix_attempts.length + 1;
    issue.fix_attempts.push({
      attempt: n,
      at: nowIso(),
      approach: f["add-fix-attempt"],
      outcome: f["fix-outcome"] || "failed",
      notes: f.note || "",
    });
  }
  writeYaml(ip, issue);
  process.stdout.write(`updated ${issue.id} status=${issue.status}\n`);
  if (
    issue.fix_attempts.length >= 3 &&
    issue.status !== "deferred" &&
    issue.status !== "abandoned"
  ) {
    process.stderr.write(
      `WARN: ${issue.id} has ${issue.fix_attempts.length} failed fix attempts. Per CLAUDE.md and the 3-attempt rule, consider /fix:deep or marking deferred/abandoned.\n`,
    );
  }
  return 0;
}

function cmdPromote(argv) {
  const f = parseFlags(argv, 3);
  if (!f.id || !f["to-ticket-type"]) {
    process.stderr.write("promote requires --id and --to-ticket-type\n");
    return 2;
  }
  const ip = issuePath(f.id);
  const issue = readYamlMaybe(ip);
  if (!issue) {
    process.stderr.write(`no issue: ${ip}\n`);
    return 1;
  }
  // Delegate to ticket.js create — emit a one-shot args string the caller can run.
  // We do NOT shell out here to keep this script pure.
  const printable = [
    "node",
    "scripts/sprint/ticket.js",
    "create",
    "--title",
    `"${issue.title}"`,
    "--type",
    f["to-ticket-type"],
    "--risk",
    issue.severity === "critical"
      ? "critical"
      : issue.severity === "high"
        ? "high"
        : "medium",
    "--linked-issues",
    issue.id,
    "--description",
    `"Promoted from issue ${issue.id}: ${issue.title}"`,
  ].join(" ");
  process.stdout.write(`Run this to mint the ticket:\n  ${printable}\n`);
  process.stdout.write(
    `Then run: node scripts/sprint/issue.js update --id ${issue.id} --status in_progress\n`,
  );
  return 0;
}

function cmdAppendMd(argv) {
  const f = parseFlags(argv, 3);
  if (!f.id) {
    process.stderr.write("appendmd requires --id\n");
    return 2;
  }
  const issue = readYamlMaybe(issuePath(f.id));
  if (!issue) {
    process.stderr.write(`no issue: ${f.id}\n`);
    return 1;
  }
  appendIssuesMdBlock(issue);
  process.stdout.write(`appended ${issue.id} to ${SPRINT.issuesLedger}\n`);
  return 0;
}

function cmdList(argv) {
  const f = parseFlags(argv, 3);
  if (!fs.existsSync(SPRINT.issues)) {
    process.stdout.write("no issues directory yet\n");
    return 0;
  }
  const files = fs
    .readdirSync(SPRINT.issues)
    .filter((x) => x.endsWith(".yaml"));
  let count = 0;
  for (const file of files.sort()) {
    const i = readYamlMaybe(path.join(SPRINT.issues, file));
    if (!i) continue;
    if (f.status && i.status !== f.status) continue;
    process.stdout.write(
      `${i.id}  ${i.status.padEnd(28)}  ${i.severity.padEnd(8)}  ${i.title}\n`,
    );
    count++;
  }
  process.stdout.write(`(${count} issue(s))\n`);
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
    case "promote":
      return cmdPromote(process.argv);
    case "appendmd":
      return cmdAppendMd(process.argv);
    case "list":
      return cmdList(process.argv);
    default:
      process.stderr.write(
        "usage: issue.js <create|update|promote|appendmd|list> [flags]\n",
      );
      return 2;
  }
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, VALID_STATUSES, VALID_SOURCES };
