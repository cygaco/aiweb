#!/usr/bin/env node
/**
 * flag.js — /warp:flag engine. Append framework-change flags to the repo-local
 * `warpos-to-update.md` ledger so `/warp:promote-flags` can drain them
 * upstream later.
 *
 * Usage:
 *   node scripts/warpos/flag.js --category <cat> --title "..." [--source "..."]
 *                               [--description "..."] [--status open|in_progress|...]
 *                               [--ledger path/to/warpos-to-update.md] [--json]
 *
 * Categories: provider, dispatch, agent, hook, skill, install, template,
 *             requirements, issue, release, docs, other.
 *
 * Default status: open. Default source: "manual".
 * Default ledger: repo-local `warpos-to-update.md` (paths.warposFlagLedger).
 *
 * The engine does NOT require network, external tools, or env vars. It is
 * safe in both downstream product repos and the canonical WarpOS clone.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const VALID_CATEGORIES = [
  "provider",
  "dispatch",
  "agent",
  "hook",
  "skill",
  "install",
  "template",
  "requirements",
  "issue",
  "release",
  "docs",
  "other",
];

const VALID_STATUSES = [
  "open",
  "in_progress",
  "promoted",
  "blocked",
  "deferred",
  "needs_decision",
  "duplicate",
  "abandoned",
];

function parseArgs(argv) {
  const args = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args.positional.push(a);
    }
  }
  return args;
}

function projectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

function resolveLedgerPath(flagOverride) {
  if (flagOverride) return path.resolve(flagOverride);
  try {
    const paths = JSON.parse(
      fs.readFileSync(
        path.join(projectRoot(), ".claude", "paths.json"),
        "utf8",
      ),
    );
    if (paths.warposFlagLedger) {
      return path.join(projectRoot(), paths.warposFlagLedger);
    }
  } catch {
    /* fall through to default */
  }
  return path.join(projectRoot(), "warpos-to-update.md");
}

function fmtDateUtc(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function ensureLedgerHeader(file) {
  if (fs.existsSync(file)) return;
  const header = [
    "# WarpOS Update Flags",
    "",
    "<!-- managed by /warp:flag and /warp:promote-flags. Add entries via /warp:flag. -->",
    "",
    "Each entry below is a framework-level improvement discovered while using",
    "WarpOS. Drain upstream with `/warp:promote-flags` (the engine reads this",
    "file, marks `Status: promoted` with a canonical SHA when applied, and",
    "writes a promotion report under `.warpos/promote-reports/`).",
    "",
  ].join("\n");
  fs.writeFileSync(file, header);
}

function formatEntry(opts) {
  const lines = [];
  lines.push(`### ${opts.category} — ${opts.title}`);
  lines.push("");
  lines.push(`- Date: ${opts.date}`);
  lines.push(`- Source: ${opts.source}`);
  lines.push(`- Status: ${opts.status}`);
  if (opts.description && opts.description.trim()) {
    lines.push(`- Description: ${opts.description.trim()}`);
  }
  if (opts.canonicalSha) lines.push(`- Canonical-SHA: ${opts.canonicalSha}`);
  lines.push("");
  return lines.join("\n");
}

function appendUnderDateHeading(file, date, entryBody) {
  const existing = fs.readFileSync(file, "utf8");
  const heading = `## ${date}`;
  if (
    existing.includes(`\n${heading}\n`) ||
    existing.startsWith(`${heading}\n`)
  ) {
    // Append entry below the existing date heading. Use a simple regex split.
    const lines = existing.split("\n");
    let insertAt = lines.length;
    let inMatchedDate = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === heading) {
        inMatchedDate = true;
        continue;
      }
      if (inMatchedDate && /^## /.test(lines[i])) {
        insertAt = i;
        break;
      }
    }
    const before = lines.slice(0, insertAt).join("\n");
    const after = lines.slice(insertAt).join("\n");
    const joined =
      before.replace(/\s+$/g, "") + "\n\n" + entryBody.trim() + "\n\n" + after;
    fs.writeFileSync(file, joined);
  } else {
    const append =
      (existing.endsWith("\n") ? "" : "\n") +
      `\n${heading}\n\n` +
      entryBody.trim() +
      "\n";
    fs.appendFileSync(file, append);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    process.stdout.write(
      [
        "Usage: node scripts/warpos/flag.js --category <cat> --title <text>",
        "                                   [--source <text>] [--description <text>]",
        "                                   [--status <open|in_progress|...>]",
        "                                   [--ledger <path>] [--json]",
        "",
        `Categories: ${VALID_CATEGORIES.join(", ")}`,
        `Statuses:   ${VALID_STATUSES.join(", ")}`,
      ].join("\n") + "\n",
    );
    process.exit(0);
  }

  const category = args.category || "other";
  const title = args.title || "";
  const source = args.source || "manual";
  const description = args.description || "";
  const status = args.status || "open";
  const ledgerPath = resolveLedgerPath(args.ledger);

  if (!title.trim()) {
    process.stderr.write("flag.js: --title is required\n");
    process.exit(2);
  }
  if (!VALID_CATEGORIES.includes(category)) {
    process.stderr.write(
      `flag.js: invalid --category "${category}". Valid: ${VALID_CATEGORIES.join(", ")}\n`,
    );
    process.exit(2);
  }
  if (!VALID_STATUSES.includes(status)) {
    process.stderr.write(
      `flag.js: invalid --status "${status}". Valid: ${VALID_STATUSES.join(", ")}\n`,
    );
    process.exit(2);
  }

  const date = fmtDateUtc();
  const entry = formatEntry({
    category,
    title,
    source,
    description,
    status,
    date,
  });

  ensureLedgerHeader(ledgerPath);
  appendUnderDateHeading(ledgerPath, date, entry);

  if (args.json) {
    process.stdout.write(
      JSON.stringify({
        ok: true,
        ledger: ledgerPath,
        date,
        category,
        title,
        status,
        source,
      }) + "\n",
    );
  } else {
    process.stdout.write(
      `[warp:flag] appended ${category}/${status} "${title}" to ${path.relative(projectRoot(), ledgerPath)}\n`,
    );
  }
}

if (require.main === module) {
  main();
}

module.exports = { VALID_CATEGORIES, VALID_STATUSES };
