#!/usr/bin/env node
// Diagnostic: report the true-pending count for requirements-staged.jsonl,
// using the reconciler that joins envelopes with status_updates. Originally
// proves BACKLOG.md (Run-12)'s "71 pending" / Explore agent's "228 pending" were
// stale reads — the actual undecided count cross-references the audit trail.

const path = require("path");
const { reconcile } = require("./lib/staged-drift-reconciler");

const file = path.resolve(
  __dirname,
  "..",
  ".claude/project/events/requirements-staged.jsonl",
);

const r = reconcile(file);

console.log("staged-drift summary");
console.log("  unique envelopes:", r.all.length);
console.log("  by status:", JSON.stringify(r.byStatus, null, 2));
console.log("  truly pending:", r.pending.length);

if (r.pending.length) {
  console.log("\npending entries:");
  for (const p of r.pending) {
    console.log(
      `  ${p.id} | ${p.feature} | ${p.drift_type} | ${p.confidence} | ${p.file} → ${p.spec_file}`,
    );
    console.log(`    "${p.suggested_update}"`);
  }
  console.log("\nby feature:", JSON.stringify(r.byFeature, null, 2));
}
