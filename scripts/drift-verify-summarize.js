#!/usr/bin/env node
/**
 * drift-verify-summarize.js
 *
 * Reads a JSON array (output of drift-verify.js) from argv[2] and prints a
 * compact summary: counts of can_apply true/false grouped by reason and
 * drift_type. Then lists the can_apply=true entries.
 */
const fs = require("fs");
const arr = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

const reasons = {};
const driftCounts = {};
let canApply = 0;
for (const r of arr) {
  if (r.can_apply) canApply++;
  reasons[r.reason] = (reasons[r.reason] || 0) + 1;
  const k = `${r.drift_type}/${r.confidence}/can_apply=${r.can_apply}`;
  driftCounts[k] = (driftCounts[k] || 0) + 1;
}
console.log("Total:", arr.length, "| can_apply=true:", canApply);
console.log("\nBy drift_type/confidence/can_apply:");
for (const [k, v] of Object.entries(driftCounts).sort()) {
  console.log("  ", v, "—", k);
}
console.log("\nBy reason:");
for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
  console.log("  ", v, "—", k);
}
console.log("\nCAN APPLY entries:");
for (const r of arr) {
  if (!r.can_apply) continue;
  console.log(
    "---",
    r.id,
    "|",
    r.feature,
    "|",
    r.drift_type,
    "|",
    r.confidence,
  );
  console.log("  spec:", r.spec_file);
  console.log("  edit_kind:", r.edit_kind);
  console.log(
    "  old:",
    JSON.stringify(r.old_value),
    "→ new:",
    JSON.stringify(r.new_value),
  );
  if (r.fallback_old || r.fallback_new) {
    console.log(
      "  fallback old:",
      JSON.stringify(r.fallback_old),
      "→",
      JSON.stringify(r.fallback_new),
    );
  }
  console.log("  reason:", r.reason);
}
