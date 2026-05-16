#!/usr/bin/env node
/**
 * scripts/sprint/backfill-schemas.js — Back-fill schema headers on existing
 * sprint YAML files that bypassed the canonical writer (and therefore lack
 * the schema field).
 *
 * One-shot recovery script for L-2026-05-14-event-sprint-schema-missing.
 * After the writeYaml fix in fs.js, all NEW writes get the schema header.
 * This script handles the back-catalog of files already on disk without it.
 *
 * Usage:
 *   node scripts/sprint/backfill-schemas.js              # dry-run report
 *   node scripts/sprint/backfill-schemas.js --apply      # write changes
 *
 * Idempotent: only touches files where `inferSprintSchemaKind` matches AND
 * the file doesn't already declare a schema.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { inferSprintSchemaKind } = require("./fs");

const REPO_ROOT = process.cwd();
const SPRINT_DIR = path.join(REPO_ROOT, ".claude", "project", "sprint");
const APPLY = process.argv.includes("--apply");

function* walkYaml(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkYaml(full);
    } else if (entry.name.endsWith(".yaml")) {
      yield full;
    }
  }
}

function hasSchemaHeader(text) {
  return /^schema:\s*warpos\/sprint\/[a-z-]+\/v\d+\s*$/m.test(text);
}

let scanned = 0;
let needed = 0;
let injected = 0;
let unmatched = 0;
const samples = { needed: [], unmatched: [] };

for (const file of walkYaml(SPRINT_DIR)) {
  scanned += 1;
  const rel = path.relative(REPO_ROOT, file).replace(/\\/g, "/");
  const text = fs.readFileSync(file, "utf8");
  if (hasSchemaHeader(text)) continue;
  const kind = inferSprintSchemaKind(file);
  if (!kind) {
    unmatched += 1;
    if (samples.unmatched.length < 5) samples.unmatched.push(rel);
    continue;
  }
  needed += 1;
  if (samples.needed.length < 5) samples.needed.push(`${rel} → ${kind}`);
  if (APPLY) {
    const header = `schema: warpos/sprint/${kind}/v1\n`;
    fs.writeFileSync(file, header + text, "utf8");
    injected += 1;
  }
}

const verb = APPLY ? "injected" : "would inject";
console.log(
  `backfill-schemas: scanned=${scanned} ${verb}=${needed} unmatched=${unmatched} (path didn't match any sprint pattern — fine)`,
);
if (samples.needed.length) {
  console.log("\nFiles needing schema:");
  for (const s of samples.needed) console.log("  " + s);
}
if (!APPLY && needed > 0) {
  console.log(
    "\nRe-run with --apply to actually inject the headers. Idempotent — safe to repeat.",
  );
}
if (APPLY && injected > 0) {
  console.log(
    `\nApplied ${injected} schema headers. Verify with: grep -l '^schema:' .claude/project/sprint/**/*.yaml`,
  );
}
process.exit(0);
