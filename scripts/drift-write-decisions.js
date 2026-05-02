#!/usr/bin/env node
/**
 * drift-write-decisions.js
 *
 * Append status_update lines to requirements-staged.jsonl in bulk.
 * Reads decisions from a JSON file path passed as argv[2], or from stdin if no
 * arg. Each decision: { id, status, review_note? }. Status must be one of
 * approved | rejected | deferred.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(
  ROOT,
  ".claude/project/events/requirements-staged.jsonl",
);

function loadInput() {
  const argFile = process.argv[2];
  if (argFile) return fs.readFileSync(argFile, "utf8");
  // stdin
  return fs.readFileSync(0, "utf8");
}

const raw = loadInput();
const decisions = JSON.parse(raw);

if (!Array.isArray(decisions)) {
  console.error("Expected JSON array of decisions");
  process.exit(1);
}

const allowed = new Set(["approved", "rejected", "deferred"]);
const now = new Date().toISOString();
const out = [];

for (const d of decisions) {
  if (!d || !d.id || !allowed.has(d.status)) {
    console.error("Skipping malformed decision:", JSON.stringify(d));
    continue;
  }
  const line = {
    id: d.id,
    ts: now,
    type: "status_update",
    status: d.status,
    reviewed_at: now,
    reviewed_by: "alpha-batch",
  };
  if (d.review_note) line.review_note = d.review_note;
  out.push(JSON.stringify(line));
}

if (!out.length) {
  console.log("No decisions to write.");
  process.exit(0);
}

// Ensure trailing newline before append
const existing = fs.readFileSync(FILE, "utf8");
const prefix = existing.endsWith("\n") || existing.length === 0 ? "" : "\n";
fs.appendFileSync(FILE, prefix + out.join("\n") + "\n");
console.log(`Appended ${out.length} status_update lines to ${FILE}`);
