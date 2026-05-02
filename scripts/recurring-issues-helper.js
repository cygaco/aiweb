#!/usr/bin/env node
/**
 * recurring-issues-helper.js — shared helpers for the recurring-issues
 * tracker. Dispatched by /issues:* skills.
 *
 * Subcommands:
 *   list                            — list open issues (default)
 *   list --all                      — include resolved
 *   log "<title>" <category> <severity> <context>
 *                                    — append an instance, dedupe by title
 *   resolve <id> "<fix-summary>"     — mark resolved with a permanent fix
 *   scan                             — pattern-mine events.jsonl for repeat
 *                                      block signatures and surface candidates
 *
 * Schema (one JSON object per line in paths.recurringIssuesFile):
 *   {
 *     id: "RI-001",
 *     title: "short, slug-like",
 *     category: "hook|path|skeleton-rebuild|provider|spec-drift|merge-guard|
 *                harness|dispatch|context-overflow|other",
 *     first_seen: ISO,
 *     last_seen: ISO,
 *     count: N,
 *     instances: [{date, context, ref}],
 *     severity: "low|medium|high",
 *     status: "open|monitoring|resolved",
 *     current_workaround: string|null,
 *     permanent_fix: string|null,
 *     tags: [string]
 *   }
 *
 * SCOPE: SYSTEM-only (the agent framework, hooks, skills, .claude/, scripts/).
 * Product bugs go through bug-registry / fix:deep / retro flows, not here.
 */

const fs = require("fs");
const path = require("path");
const { PATHS } = require("./hooks/lib/paths");

const FILE =
  PATHS.recurringIssuesFile ||
  path.resolve(
    __dirname,
    "..",
    ".claude",
    "project",
    "memory",
    "recurring-issues.jsonl",
  );

const VALID_CATEGORIES = [
  "hook",
  "path",
  "skeleton-rebuild",
  "provider",
  "spec-drift",
  "merge-guard",
  "harness",
  "dispatch",
  "context-overflow",
  "other",
];
const VALID_SEVERITIES = ["low", "medium", "high"];

// ─── I/O ────────────────────────────────────────────────────────────────────

function readAll() {
  if (!fs.existsSync(FILE)) return [];
  const raw = fs.readFileSync(FILE, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function writeAll(entries) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const text = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.writeFileSync(FILE, text);
}

function nextId(entries) {
  let max = 0;
  for (const e of entries) {
    const m = (e.id || "").match(/^RI-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `RI-${String(max + 1).padStart(3, "0")}`;
}

function slugMatchesTitle(a, b) {
  const norm = (s) =>
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const A = norm(a);
  const B = norm(b);
  if (!A || !B) return false;
  if (A === B) return true;
  // 70%+ token overlap counts as same issue (kept loose so "Hook silently
  // disabled" matches "Hook silently disables itself by I/O")
  const ta = new Set(A.split(" "));
  const tb = new Set(B.split(" "));
  const intersect = [...ta].filter((t) => tb.has(t)).length;
  const minSize = Math.min(ta.size, tb.size);
  return minSize > 0 && intersect / minSize >= 0.7;
}

// ─── Subcommand handlers ─────────────────────────────────────────────────────

function cmdLog(args) {
  const [title, category, severity, ...contextParts] = args;
  const context = contextParts.join(" ");
  if (!title || !category || !severity || !context) {
    console.error('Usage: log "<title>" <category> <severity> <context...>');
    console.error("  category: " + VALID_CATEGORIES.join("|"));
    console.error("  severity: " + VALID_SEVERITIES.join("|"));
    process.exit(1);
  }
  if (!VALID_CATEGORIES.includes(category)) {
    console.error(`invalid category "${category}"`);
    process.exit(1);
  }
  if (!VALID_SEVERITIES.includes(severity)) {
    console.error(`invalid severity "${severity}"`);
    process.exit(1);
  }

  const entries = readAll();
  const ts = new Date().toISOString();
  const existing = entries.find(
    (e) => e.status !== "resolved" && slugMatchesTitle(e.title, title),
  );

  if (existing) {
    existing.count = (existing.count || 0) + 1;
    existing.last_seen = ts;
    existing.instances = existing.instances || [];
    existing.instances.push({ date: ts, context });
    if (
      VALID_SEVERITIES.indexOf(severity) >
      VALID_SEVERITIES.indexOf(existing.severity || "low")
    ) {
      existing.severity = severity;
    }
    writeAll(entries);
    console.log(
      `incremented ${existing.id} "${existing.title}" (count=${existing.count}, severity=${existing.severity})`,
    );
    return;
  }

  const entry = {
    id: nextId(entries),
    title,
    category,
    first_seen: ts,
    last_seen: ts,
    count: 1,
    instances: [{ date: ts, context }],
    severity,
    status: "open",
    current_workaround: null,
    permanent_fix: null,
    tags: [],
  };
  entries.push(entry);
  writeAll(entries);
  console.log(`created ${entry.id} "${entry.title}" (severity=${severity})`);
}

function cmdList(args) {
  const showAll = args.includes("--all");
  const entries = readAll();
  const filtered = showAll
    ? entries
    : entries.filter((e) => e.status !== "resolved");
  if (filtered.length === 0) {
    console.log(showAll ? "(no issues)" : "(no open issues)");
    return;
  }
  const sorted = [...filtered].sort((a, b) => {
    const sevOrder = { high: 0, medium: 1, low: 2 };
    const da = sevOrder[a.severity] ?? 3;
    const db = sevOrder[b.severity] ?? 3;
    if (da !== db) return da - db;
    return (b.count || 0) - (a.count || 0);
  });
  console.log(`# Recurring system issues (${sorted.length})`);
  console.log("");
  for (const e of sorted) {
    const status = e.status === "resolved" ? " [RESOLVED]" : "";
    console.log(
      `## ${e.id} — ${e.title}${status}  [${e.category}, ${e.severity}, count=${e.count}]`,
    );
    console.log(
      `- First seen: ${e.first_seen?.slice(0, 10)} | Last: ${e.last_seen?.slice(0, 10)}`,
    );
    if (e.current_workaround)
      console.log(`- Workaround: ${e.current_workaround}`);
    if (e.permanent_fix) console.log(`- Fix: ${e.permanent_fix}`);
    if (e.instances && e.instances.length > 0) {
      const last = e.instances[e.instances.length - 1];
      console.log(
        `- Latest: ${last.date?.slice(0, 10)} — ${(last.context || "").slice(0, 120)}`,
      );
    }
    console.log("");
  }
}

function cmdResolve(args) {
  const [id, ...fixParts] = args;
  const fix = fixParts.join(" ");
  if (!id || !fix) {
    console.error('Usage: resolve <id> "<fix-summary>"');
    process.exit(1);
  }
  const entries = readAll();
  const e = entries.find((x) => x.id === id);
  if (!e) {
    console.error(`no issue ${id}`);
    process.exit(1);
  }
  e.status = "resolved";
  e.permanent_fix = fix;
  e.last_seen = new Date().toISOString();
  writeAll(entries);
  console.log(`resolved ${id}: ${fix}`);
}

function cmdScan() {
  const eventsFile = PATHS.eventsFile;
  if (!fs.existsSync(eventsFile)) {
    console.log("(no events.jsonl)");
    return;
  }
  // Look at the last 7 days of audit-block events
  const cutoff = Date.now() - 7 * 86400_000;
  const lines = fs.readFileSync(eventsFile, "utf8").trim().split("\n");
  const sigs = new Map();
  for (const line of lines) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.cat !== "audit") continue;
    if (!e.data?.action || !/blocked/.test(e.data.action)) continue;
    if (new Date(e.ts).getTime() < cutoff) continue;
    const sig = `${e.data.action} :: ${(e.data.detail || "").slice(0, 60)}`;
    sigs.set(sig, (sigs.get(sig) || 0) + 1);
  }
  if (sigs.size === 0) {
    console.log("(no audit-block events in the last 7d)");
    return;
  }
  const sorted = [...sigs.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`# Audit-block signatures (last 7d), ranked`);
  console.log("");
  for (const [sig, count] of sorted) {
    if (count < 2) continue; // single occurrences aren't recurring
    console.log(`- **${count}×** ${sig}`);
  }
  console.log("");
  console.log(
    "→ Anything ≥3× is a recurring-issue candidate. Use `node scripts/recurring-issues-helper.js log ...` to add it.",
  );
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case "log":
    cmdLog(args);
    break;
  case "list":
  case undefined:
    cmdList(args);
    break;
  case "resolve":
    cmdResolve(args);
    break;
  case "scan":
    cmdScan();
    break;
  default:
    console.error(`Unknown subcommand: ${cmd}`);
    console.error("  list [--all] | log | resolve | scan");
    process.exit(1);
}
