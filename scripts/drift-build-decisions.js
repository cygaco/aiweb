#!/usr/bin/env node
/**
 * drift-build-decisions.js
 *
 * Build the decision array for the pending drift queue based on the cleanup
 * policy:
 *   - low confidence  → reject (batch-dismissed reminder)
 *   - medium / high   → defer (post-gut skeleton; suggested edits unsafe or
 *     reminders only; needs human review)
 *
 * Writes JSON array to /tmp/drift-decisions.json (or argv[2] if provided).
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(
  ROOT,
  ".claude/project/events/requirements-staged.jsonl",
);
const OUT = process.argv[2] || "/tmp/drift-decisions.json";

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

const decisions = [];
let counts = { approved: 0, rejected: 0, deferred: 0 };
for (const e of pending) {
  const c = (e.data && e.data.confidence) || "unknown";
  const t = (e.data && e.data.drift_type) || "unknown";
  const excerpt = (e.data && e.data.spec_excerpt) || "";
  const sug = (e.data && e.data.suggested_update) || "";
  let status, note;

  if (c === "low") {
    status = "rejected";
    note = "batch-dismissed: low-confidence reminder";
  } else if (c === "medium") {
    status = "deferred";
    if (!excerpt.trim()) {
      note =
        "deferred: no spec_excerpt — generic reminder, no specific spec edit to apply";
    } else {
      note = "deferred: needs human review of " + t + " intent";
    }
  } else if (c === "high") {
    status = "deferred";
    note =
      "deferred: post-gut skeleton state — spec_excerpt present but suggested edit would corrupt unrelated text or applies to dead code";
  } else {
    status = "deferred";
    note = "deferred: unknown confidence";
  }

  decisions.push({ id: e.id, status, review_note: note });
  counts[status]++;
}

fs.writeFileSync(OUT, JSON.stringify(decisions, null, 2));
console.log(
  "Wrote",
  decisions.length,
  "decisions to",
  OUT,
  "—",
  JSON.stringify(counts),
);
