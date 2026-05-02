#!/usr/bin/env node
/**
 * drift-shape.js
 *
 * Profile the shape of pending drift entries by confidence: how many have a
 * non-empty spec_excerpt, how many have a "Value X changed to Y" suggested
 * update vs a generic reminder, etc.
 *
 * Usage: node scripts/drift-shape.js [confidenceCsv]
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

let withExcerpt = 0;
let valueChange = 0;
let genericReminder = 0;
let other = 0;

for (const e of pending) {
  const d = e.data || {};
  if ((d.spec_excerpt || "").trim()) withExcerpt++;
  const su = d.suggested_update || "";
  if (/^Value ".+?" changed to ".+?" in code/.test(su)) valueChange++;
  else if (/touches behavior keywords|review spec for accuracy/i.test(su))
    genericReminder++;
  else other++;
}

console.log("Total:", pending.length);
console.log("With non-empty spec_excerpt:", withExcerpt);
console.log('  suggested = "Value X changed to Y":', valueChange);
console.log("  suggested = generic reminder:", genericReminder);
console.log("  suggested = other:", other);

// Sample a few with non-trivial suggested_update
console.log("\n-- Sample (up to 5) --");
let shown = 0;
for (const e of pending) {
  if (shown >= 5) break;
  const d = e.data || {};
  console.log(
    "\n[" +
      e.id +
      "] " +
      d.feature +
      " | " +
      d.drift_type +
      " | " +
      d.confidence,
  );
  console.log("  excerpt-len:", (d.spec_excerpt || "").length);
  console.log("  edit_how:", JSON.stringify((d.edit_how || "").slice(0, 220)));
  console.log(
    "  suggested:",
    JSON.stringify((d.suggested_update || "").slice(0, 320)),
  );
  shown++;
}
