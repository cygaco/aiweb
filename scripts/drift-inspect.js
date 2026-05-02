#!/usr/bin/env node
/**
 * drift-inspect.js
 *
 * Print each pending entry's id, feature, drift_type, spec_file,
 * spec_excerpt, edit_how, and suggested_update. Optional confidence filter.
 * Usage: node scripts/drift-inspect.js [confidenceCsv]
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
const driftFilter = (process.argv[3] || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const featureFilter = (process.argv[4] || "")
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
  if (driftFilter.length) {
    const t = (e.data && e.data.drift_type) || "unknown";
    if (!driftFilter.includes(t)) continue;
  }
  if (featureFilter.length) {
    const f = (e.data && e.data.feature) || "unknown";
    if (!featureFilter.includes(f)) continue;
  }
  pending.push(e);
}

console.log("Count:", pending.length);
for (const e of pending) {
  const d = e.data || {};
  console.log(
    "---",
    e.id,
    "|",
    d.feature,
    "|",
    d.drift_type,
    "|",
    d.confidence,
  );
  console.log("  src:", d.file);
  console.log("  spec:", d.spec_file);
  console.log(
    "  excerpt:",
    JSON.stringify((d.spec_excerpt || "").slice(0, 240)),
  );
  console.log("  edit_how:", JSON.stringify((d.edit_how || "").slice(0, 280)));
  console.log(
    "  suggested:",
    JSON.stringify((d.suggested_update || "").slice(0, 280)),
  );
}
