#!/usr/bin/env node
/**
 * delta-store-review.js — persist a reviewer envelope to store.features[<feature>].reviews[<role>]
 *
 * Usage:
 *   node scripts/delta-store-review.js <feature> <role> <pass:bool> <findings-count> [summary-file]
 *
 * Records:
 *   features[<feature>].reviews[<role>] = {
 *     pass: bool,
 *     findingsCount: int,
 *     reviewedAt: iso,
 *     summaryPath: rel-path-or-null
 *   }
 *
 * Optionally accepts a summary file path; the file's full contents are NOT stored
 * in store.json (would bloat it), but the path is tracked for retrieval.
 */
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

const [, , feature, role, passArg, countArg, summaryPath] = process.argv;
if (!feature || !role || passArg == null || countArg == null) {
  console.error(
    "usage: delta-store-review.js <feature> <role> <pass:bool> <findings-count> [summary-file]",
  );
  process.exit(1);
}

const pass = String(passArg).toLowerCase() === "true";
const findingsCount = parseInt(countArg, 10) || 0;

const s = JSON.parse(fs.readFileSync(STORE, "utf8"));
if (!s.features[feature]) {
  console.error(`feature '${feature}' not in store.features`);
  process.exit(1);
}
s.features[feature].reviews = s.features[feature].reviews || {};
s.features[feature].reviews[role] = {
  pass,
  findingsCount,
  reviewedAt: new Date().toISOString(),
  summaryPath: summaryPath || null,
};

fs.writeFileSync(STORE, JSON.stringify(s, null, 2) + "\n");
console.log(
  `review stored: ${feature}.${role} pass=${pass} findings=${findingsCount}`,
);
