#!/usr/bin/env node
/**
 * drift-dump-pending.js
 *
 * Dump full pending entries as a JSON array. Optional filter by confidence.
 * Usage:
 *   node scripts/drift-dump-pending.js          # all pending
 *   node scripts/drift-dump-pending.js high     # only high
 *   node scripts/drift-dump-pending.js medium   # only medium
 *   node scripts/drift-dump-pending.js low      # only low
 *   node scripts/drift-dump-pending.js high,medium
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(
  ROOT,
  ".claude/project/events/requirements-staged.jsonl",
);

const filter = (process.argv[2] || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const lines = fs.readFileSync(FILE, "utf8").trim().split(/\r?\n/);
const byId = new Map();
const statusUpdates = [];

for (const L of lines) {
  if (!L.trim()) continue;
  let e;
  try {
    e = JSON.parse(L);
  } catch {
    continue;
  }
  if (e.type === "status_update") {
    statusUpdates.push(e);
    continue;
  }
  byId.set(e.id, e);
}

for (const su of statusUpdates) {
  const orig = byId.get(su.id);
  if (orig) {
    orig.data = orig.data || {};
    orig.data.status = su.status;
  }
}

const pending = [];
for (const e of byId.values()) {
  const s = (e.data && e.data.status) || e.status || "unknown";
  if (s !== "pending") continue;
  if (filter.length) {
    const c = (e.data && e.data.confidence) || "unknown";
    if (!filter.includes(c)) continue;
  }
  pending.push(e);
}

process.stdout.write(JSON.stringify(pending, null, 2));
