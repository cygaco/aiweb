#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const id = process.argv[2];
const note = process.argv[3] || "";
if (!id) {
  console.error("usage: node scripts/dismiss-drift-entry.js <ENTRY_ID> [note]");
  process.exit(1);
}

const file = path.resolve(
  __dirname,
  "..",
  ".claude/project/events/requirements-staged.jsonl",
);
const update = {
  id,
  ts: new Date().toISOString(),
  type: "status_update",
  status: "rejected",
  reviewed_at: new Date().toISOString(),
  reviewed_by: "alpha-via-beta",
  review_note: note,
};
fs.appendFileSync(file, JSON.stringify(update) + "\n");
console.log("Dismissed:", id);
