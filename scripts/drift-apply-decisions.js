#!/usr/bin/env node
/**
 * drift-apply-decisions.js
 *
 * Read decisions from a JSONL file (one decision per line) and append
 * status_update entries to requirements-staged.jsonl.
 *
 * Each input line: {"id":"<id>","status":"approved|rejected|deferred","review_note":"..."}
 *
 * Usage: node scripts/drift-apply-decisions.js [decisionsFile]
 *   defaults to .drift-decisions-tmp.jsonl in repo root
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STAGED = path.join(
  ROOT,
  ".claude/project/events/requirements-staged.jsonl",
);
const INPUT = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, ".drift-decisions-tmp.jsonl");

if (!fs.existsSync(INPUT)) {
  console.error("Decisions file not found:", INPUT);
  process.exit(1);
}

const allowed = new Set(["approved", "rejected", "deferred"]);
const now = new Date().toISOString();

const lines = fs.readFileSync(INPUT, "utf8").split(/\r?\n/);
const out = [];
const counts = { approved: 0, rejected: 0, deferred: 0, skipped: 0 };

for (const L of lines) {
  if (!L.trim()) continue;
  let d;
  try {
    d = JSON.parse(L);
  } catch (e) {
    console.error("Skipping malformed line:", L);
    counts.skipped++;
    continue;
  }
  if (!d || !d.id || !allowed.has(d.status)) {
    console.error("Skipping invalid decision:", JSON.stringify(d));
    counts.skipped++;
    continue;
  }
  const rec = {
    id: d.id,
    ts: now,
    type: "status_update",
    status: d.status,
    reviewed_at: now,
    reviewed_by: "alpha-batch",
  };
  if (d.review_note) rec.review_note = d.review_note;
  out.push(JSON.stringify(rec));
  counts[d.status]++;
}

if (!out.length) {
  console.log("No decisions to write.");
  process.exit(0);
}

const existing = fs.readFileSync(STAGED, "utf8");
const prefix = existing.endsWith("\n") || existing.length === 0 ? "" : "\n";
fs.appendFileSync(STAGED, prefix + out.join("\n") + "\n");
console.log("Appended " + out.length + " status_update lines to " + STAGED);
console.log("Counts:", JSON.stringify(counts));
