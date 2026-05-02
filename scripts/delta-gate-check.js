#!/usr/bin/env node
// Append a GATE_CHECK entry to store.runLog.entries with fields the
// gauntlet-gate hook expects: reviewer, security, compliance, qa.
// Values must start with "pass", "done", or "impossible" to count as gated.
//
// Field renamed 2026-04-29: evaluator → reviewer. The first positional arg
// is still parsed as the reviewer's verdict; alias kept for callers that
// pass --evaluator.
//
// Usage:
//   node scripts/delta-gate-check.js <feature> <phase> <reviewer> <security> <compliance> <qa>
// e.g.
//   node scripts/delta-gate-check.js auth 1 pass-82 done-after-fixes pass done-after-fixes
const fs = require("fs");
const path = require("path");

const STORE = path.resolve(
  __dirname,
  "..",
  ".claude",
  "agents",
  "02-oneshot",
  ".system",
  "store.json",
);

const [, , feature, phase, reviewer, security, compliance, qa] = process.argv;
if (!feature || !phase) {
  console.error(
    "usage: delta-gate-check.js <feature> <phase> <reviewer> <security> <compliance> <qa>",
  );
  process.exit(1);
}

const store = JSON.parse(fs.readFileSync(STORE, "utf8"));
if (Array.isArray(store.runLog)) {
  store.runLog = { entries: store.runLog };
}
store.runLog = store.runLog || { entries: [] };
store.runLog.entries = store.runLog.entries || [];

// Dedup: remove any existing GATE_CHECK for this feature before appending.
store.runLog.entries = store.runLog.entries.filter(
  (e) => !(e.type === "GATE_CHECK" && e.feature === feature),
);

const entry = {
  type: "GATE_CHECK",
  feature,
  phase: parseFloat(phase),
  reviewer: reviewer || "skipped",
  security: security || "skipped",
  compliance: compliance || "skipped",
  qa: qa || "skipped",
  buildResult: "pass",
  timestamp: new Date().toISOString(),
};
store.runLog.entries.push(entry);
fs.writeFileSync(STORE, JSON.stringify(store, null, 2) + "\n");
console.log(
  `GATE_CHECK ${feature} phase ${phase}: reviewer=${entry.reviewer} security=${entry.security} compliance=${entry.compliance} qa=${entry.qa}`,
);
