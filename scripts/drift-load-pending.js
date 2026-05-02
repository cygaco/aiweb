#!/usr/bin/env node
/**
 * drift-load-pending.js
 *
 * Load all pending entries from requirements-staged.jsonl, apply
 * last-write-wins (status_update entries override originals), group by
 * feature + drift_type + confidence, and print a summary.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(
  ROOT,
  ".claude/project/events/requirements-staged.jsonl",
);

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
  // Original entry
  byId.set(e.id, e);
}

// Apply status updates
for (const su of statusUpdates) {
  const orig = byId.get(su.id);
  if (orig) {
    orig.data = orig.data || {};
    orig.data.status = su.status;
  }
}

// Filter to pending
const pending = [];
for (const e of byId.values()) {
  const s = (e.data && e.data.status) || e.status || "unknown";
  if (s === "pending") pending.push(e);
}

// Group
const byFeature = {};
for (const e of pending) {
  const f = (e.data && e.data.feature) || "unknown";
  const t = (e.data && e.data.drift_type) || "unknown";
  const c = (e.data && e.data.confidence) || "unknown";
  byFeature[f] = byFeature[f] || {
    high: {
      overwrite: [],
      extension: [],
      new_behavior: [],
      removal: [],
      unknown: [],
    },
    medium: {
      overwrite: [],
      extension: [],
      new_behavior: [],
      removal: [],
      unknown: [],
    },
    low: {
      overwrite: [],
      extension: [],
      new_behavior: [],
      removal: [],
      unknown: [],
    },
    timeout: {
      overwrite: [],
      extension: [],
      new_behavior: [],
      removal: [],
      unknown: [],
    },
    unknown: {
      overwrite: [],
      extension: [],
      new_behavior: [],
      removal: [],
      unknown: [],
    },
  };
  if (!byFeature[f][c]) byFeature[f][c] = {};
  if (!byFeature[f][c][t]) byFeature[f][c][t] = [];
  byFeature[f][c][t].push(e.id);
}

// Summarize
console.log("Total pending:", pending.length);
console.log("");
const overall = { high: 0, medium: 0, low: 0, timeout: 0, unknown: 0 };
const byType = {
  overwrite: 0,
  extension: 0,
  new_behavior: 0,
  removal: 0,
  unknown: 0,
};
for (const e of pending) {
  const c = (e.data && e.data.confidence) || "unknown";
  const t = (e.data && e.data.drift_type) || "unknown";
  overall[c] = (overall[c] || 0) + 1;
  byType[t] = (byType[t] || 0) + 1;
}
console.log("By confidence:", JSON.stringify(overall));
console.log("By drift type:", JSON.stringify(byType));
console.log("");
console.log("By feature:");
for (const [f, conf] of Object.entries(byFeature)) {
  let total = 0;
  for (const c of Object.keys(conf)) {
    for (const t of Object.keys(conf[c])) {
      total += conf[c][t].length;
    }
  }
  console.log(`  ${f}: ${total}`);
  for (const c of ["high", "medium", "low", "timeout", "unknown"]) {
    if (!conf[c]) continue;
    let cTotal = 0;
    for (const t of Object.keys(conf[c])) cTotal += conf[c][t].length;
    if (cTotal === 0) continue;
    const types = Object.entries(conf[c])
      .filter(([_, ids]) => ids.length)
      .map(([t, ids]) => `${t}=${ids.length}`)
      .join(", ");
    console.log(`    ${c} (${cTotal}): ${types}`);
  }
}

// Spit a sample of high-confidence overwrites
console.log("");
console.log("--- HIGH-CONFIDENCE OVERWRITE SAMPLE (up to 5) ---");
let shown = 0;
for (const e of pending) {
  if (shown >= 5) break;
  if (
    (e.data && e.data.confidence) === "high" &&
    (e.data && e.data.drift_type) === "overwrite"
  ) {
    console.log(`\n[${e.id}] feature=${e.data.feature}`);
    console.log(`  file: ${e.data.file}`);
    console.log(`  spec_file: ${e.data.spec_file}`);
    console.log(`  edit_how: ${(e.data.edit_how || "").slice(0, 200)}`);
    if (e.data.suggested_update)
      console.log(
        `  suggested: ${(e.data.suggested_update || "").slice(0, 200)}`,
      );
    shown++;
  }
}
