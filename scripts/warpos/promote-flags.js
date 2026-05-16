#!/usr/bin/env node
/**
 * promote-flags.js — /warp:promote-flags engine.
 *
 * Drains the `warpos-to-update.md` ledger written by /warp:flag. The default
 * is a dry-run grouped summary. `--apply` marks entries as `promoted` /
 * `blocked` / `deferred` per the supplied decisions, optionally archives
 * promoted entries to `warpos-promoted-archive.md`, and writes a promotion
 * report under `.warpos/promote-reports/`.
 *
 * This is intentionally NOT the same engine as scripts/warpos/promote.js
 * (the source→canonical framework-file propagator). The two share a name
 * but not a contract; coupling them produced confusion in earlier sketches.
 *
 * Usage:
 *   node scripts/warpos/promote-flags.js                            # dry-run summary
 *   node scripts/warpos/promote-flags.js --json                     # machine output
 *   node scripts/warpos/promote-flags.js --mark <title-substr> --to promoted \
 *        --canonical-sha <sha> --apply                              # mark one entry
 *   node scripts/warpos/promote-flags.js --archive-promoted --apply # move promoted entries
 *
 * No network. No external tools. Safe in canonical and product repos.
 */

"use strict";

const fs = require("fs");
const path = require("path");

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

function paths() {
  try {
    return JSON.parse(
      fs.readFileSync(
        path.join(projectRoot(), ".claude", "paths.json"),
        "utf8",
      ),
    );
  } catch {
    return {};
  }
}

function resolveLedgerPath(flagOverride) {
  if (flagOverride) return path.resolve(flagOverride);
  const p = paths();
  if (p.warposFlagLedger) return path.join(projectRoot(), p.warposFlagLedger);
  return path.join(projectRoot(), "warpos-to-update.md");
}

function resolveArchivePath() {
  const p = paths();
  if (p.warposPromotedArchive) {
    return path.join(projectRoot(), p.warposPromotedArchive);
  }
  return path.join(projectRoot(), "warpos-promoted-archive.md");
}

function resolveReportsDir() {
  const p = paths();
  if (p.warposPromoteReports) {
    return path.join(projectRoot(), p.warposPromoteReports);
  }
  return path.join(projectRoot(), ".warpos", "promote-reports");
}

/**
 * Parse the ledger. Returns an array of { category, title, fields, lineStart,
 * lineEnd, date }. Each entry starts at `### ` and ends before the next
 * `### ` / `## ` heading or EOF.
 */
function parseLedger(file) {
  if (!fs.existsSync(file)) return { entries: [], lines: [] };
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const entries = [];
  let currentDate = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dateMatch = line.match(/^##\s+(\d{4}-\d{2}-\d{2})\s*$/);
    if (dateMatch) {
      currentDate = dateMatch[1];
      continue;
    }
    const entryMatch = line.match(/^###\s+([^—-]+?)\s+[—-]+\s+(.+?)\s*$/);
    if (entryMatch) {
      const [, category, title] = entryMatch;
      const entry = {
        category: category.trim().toLowerCase(),
        title: title.trim(),
        date: currentDate,
        lineStart: i,
        lineEnd: lines.length,
        fields: {},
      };
      // Walk forward until the next heading or EOF
      let j = i + 1;
      while (j < lines.length) {
        if (/^###\s+/.test(lines[j]) || /^##\s+/.test(lines[j])) break;
        const fieldMatch = lines[j].match(/^-\s+([A-Za-z][\w-]*):\s*(.+?)\s*$/);
        if (fieldMatch) {
          entry.fields[fieldMatch[1]] = fieldMatch[2].trim();
        }
        j++;
      }
      entry.lineEnd = j;
      entries.push(entry);
    }
  }
  return { entries, lines };
}

function statusOf(entry) {
  return (entry.fields.Status || "open").toLowerCase();
}

function summarize(entries) {
  const byStatus = {};
  const byCategory = {};
  for (const e of entries) {
    const s = statusOf(e);
    byStatus[s] = (byStatus[s] || 0) + 1;
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;
  }
  return { total: entries.length, byStatus, byCategory };
}

function writeLedger(file, lines) {
  fs.writeFileSync(file, lines.join("\n"));
}

function updateEntryStatus(lines, entry, newStatus, canonicalSha) {
  for (let i = entry.lineStart; i < entry.lineEnd; i++) {
    if (/^-\s+Status:/.test(lines[i])) {
      lines[i] = `- Status: ${newStatus}`;
    }
  }
  if (canonicalSha) {
    let foundSha = false;
    for (let i = entry.lineStart; i < entry.lineEnd; i++) {
      if (/^-\s+Canonical-SHA:/.test(lines[i])) {
        lines[i] = `- Canonical-SHA: ${canonicalSha}`;
        foundSha = true;
      }
    }
    if (!foundSha) {
      // Insert before the blank-line-after-entry
      let insertAt = entry.lineEnd;
      // Find the last non-empty line in the entry
      for (let i = entry.lineEnd - 1; i > entry.lineStart; i--) {
        if (lines[i].trim()) {
          insertAt = i + 1;
          break;
        }
      }
      lines.splice(insertAt, 0, `- Canonical-SHA: ${canonicalSha}`);
    }
  }
  let foundPromotedAt = false;
  for (let i = entry.lineStart; i < entry.lineEnd; i++) {
    if (/^-\s+Promoted-At:/.test(lines[i])) {
      lines[i] = `- Promoted-At: ${new Date().toISOString()}`;
      foundPromotedAt = true;
    }
  }
  if (!foundPromotedAt && newStatus === "promoted") {
    let insertAt = entry.lineEnd;
    for (let i = entry.lineEnd - 1; i > entry.lineStart; i--) {
      if (lines[i].trim()) {
        insertAt = i + 1;
        break;
      }
    }
    lines.splice(insertAt, 0, `- Promoted-At: ${new Date().toISOString()}`);
  }
}

function ensureArchiveHeader(file) {
  if (fs.existsSync(file)) return;
  const header = [
    "# WarpOS Promoted Flags Archive",
    "",
    "<!-- managed by /warp:promote-flags --archive-promoted. Entries flow here from warpos-to-update.md after upstream promotion. -->",
    "",
  ].join("\n");
  fs.writeFileSync(file, header);
}

function writeReport(report) {
  const dir = resolveReportsDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `${stamp}-flags.md`);
  fs.writeFileSync(file, report);
  return file;
}

function renderReport(summary, ledgerPath, mutations) {
  const lines = [];
  lines.push(`# /warp:promote-flags report — ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`Source ledger: \`${path.relative(projectRoot(), ledgerPath)}\``);
  lines.push(`Total entries: ${summary.total}`);
  lines.push("");
  lines.push("## By status");
  for (const [s, n] of Object.entries(summary.byStatus).sort()) {
    lines.push(`- ${s}: ${n}`);
  }
  lines.push("");
  lines.push("## By category");
  for (const [c, n] of Object.entries(summary.byCategory).sort()) {
    lines.push(`- ${c}: ${n}`);
  }
  if (mutations && mutations.length) {
    lines.push("");
    lines.push("## Mutations applied this run");
    for (const m of mutations) {
      lines.push(
        `- ${m.action}: ${m.title} (status → ${m.status}${m.canonicalSha ? `, sha ${m.canonicalSha}` : ""})`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    process.stdout.write(
      [
        "Usage: node scripts/warpos/promote-flags.js [--apply]",
        "                                            [--mark <title-substr> --to <status>]",
        "                                            [--canonical-sha <sha>]",
        "                                            [--archive-promoted]",
        "                                            [--ledger <path>] [--json]",
        "",
        `Statuses: ${VALID_STATUSES.join(", ")}`,
      ].join("\n") + "\n",
    );
    process.exit(0);
  }

  const ledgerPath = resolveLedgerPath(args.ledger);
  if (!fs.existsSync(ledgerPath)) {
    process.stdout.write(`No ledger at ${ledgerPath} — nothing to drain.\n`);
    process.exit(0);
  }
  const { entries, lines } = parseLedger(ledgerPath);
  const summary = summarize(entries);
  const apply = !!args.apply;
  const mutations = [];

  if (args.mark && args.to) {
    if (!VALID_STATUSES.includes(args.to)) {
      process.stderr.write(`--to "${args.to}" is not a valid status.\n`);
      process.exit(2);
    }
    const needle = String(args.mark).toLowerCase();
    let hit = 0;
    for (const e of entries) {
      if (e.title.toLowerCase().includes(needle)) {
        hit++;
        mutations.push({
          action: "mark",
          title: e.title,
          status: args.to,
          canonicalSha: args["canonical-sha"] || null,
        });
        if (apply) {
          updateEntryStatus(lines, e, args.to, args["canonical-sha"] || null);
        }
      }
    }
    if (!hit) {
      process.stderr.write(`No entry matched --mark "${args.mark}".\n`);
      process.exit(2);
    }
    if (apply) writeLedger(ledgerPath, lines);
  }

  if (args["archive-promoted"]) {
    if (apply) {
      const archivePath = resolveArchivePath();
      ensureArchiveHeader(archivePath);
      const stayLines = [];
      const moveBlocks = [];
      // Re-parse after possible mutations
      const fresh = parseLedger(ledgerPath);
      let cursor = 0;
      const promotedSpans = fresh.entries
        .filter((e) => statusOf(e) === "promoted")
        .map((e) => [e.lineStart, e.lineEnd]);
      const isInsideSpan = (i) =>
        promotedSpans.some(([a, b]) => i >= a && i < b);
      for (let i = 0; i < fresh.lines.length; i++) {
        if (isInsideSpan(i)) {
          moveBlocks.push(fresh.lines[i]);
          if (i === fresh.lines.length - 1 || !isInsideSpan(i + 1)) {
            moveBlocks.push("");
          }
        } else {
          stayLines.push(fresh.lines[i]);
        }
      }
      writeLedger(ledgerPath, stayLines);
      fs.appendFileSync(
        archivePath,
        "\n## Archived " +
          new Date().toISOString() +
          "\n\n" +
          moveBlocks.join("\n") +
          "\n",
      );
      mutations.push({
        action: "archive",
        title: `${promotedSpans.length} promoted entr${promotedSpans.length === 1 ? "y" : "ies"}`,
        status: "archived",
      });
    } else {
      const promotedCount = entries.filter(
        (e) => statusOf(e) === "promoted",
      ).length;
      mutations.push({
        action: "archive (dry-run)",
        title: `${promotedCount} promoted entr${promotedCount === 1 ? "y" : "ies"} would move to archive`,
        status: "archived",
      });
    }
  }

  const reportText = renderReport(summary, ledgerPath, mutations);
  const reportFile = apply ? writeReport(reportText) : null;

  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          ledger: ledgerPath,
          summary,
          mutations,
          applied: apply,
          report: reportFile,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    process.stdout.write(reportText);
    if (reportFile)
      process.stdout.write(
        `\nReport written: ${path.relative(projectRoot(), reportFile)}\n`,
      );
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseLedger, summarize, statusOf, VALID_STATUSES };
