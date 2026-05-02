#!/usr/bin/env node
/**
 * drift-build-decisions-jsonl.js
 *
 * Build the decision JSONL file for the pending drift queue:
 *   - low    → rejected ("batch-dismissed: low-confidence reminder, pre-gut stale")
 *   - medium → deferred ("needs human review post-gut; code referenced no longer exists in current form")
 *   - high   → deferred ("spec_excerpt mostly applies cleanly but suggested edits would corrupt or refer to gutted code; needs human re-evaluation against post-gut state")
 *
 * Usage: node scripts/drift-build-decisions-jsonl.js [outputFile]
 *   defaults to .drift-decisions-tmp.jsonl in repo root
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(
  ROOT,
  ".claude/project/events/requirements-staged.jsonl",
);
const OUT = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, ".drift-decisions-tmp.jsonl");

const NOTE_LOW = "batch-dismissed: low-confidence reminder, pre-gut stale";
const NOTE_MEDIUM =
  "needs human review post-gut; code referenced no longer exists in current form";
const NOTE_HIGH =
  "spec_excerpt mostly applies cleanly but suggested edits would corrupt or refer to gutted code; needs human re-evaluation against post-gut state";

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
  if (s === "pending") pending.push(e);
}

const out = [];
const counts = { approved: 0, rejected: 0, deferred: 0 };
for (const e of pending) {
  const c = (e.data && e.data.confidence) || "unknown";
  let status, note;
  if (c === "low") {
    status = "rejected";
    note = NOTE_LOW;
  } else if (c === "medium") {
    status = "deferred";
    note = NOTE_MEDIUM;
  } else if (c === "high") {
    status = "deferred";
    note = NOTE_HIGH;
  } else {
    status = "deferred";
    note = "deferred: unknown confidence";
  }
  out.push(JSON.stringify({ id: e.id, status, review_note: note }));
  counts[status]++;
}

fs.writeFileSync(OUT, out.join("\n") + "\n");
console.log(
  "Wrote " +
    out.length +
    " decisions to " +
    OUT +
    " — " +
    JSON.stringify(counts),
);
