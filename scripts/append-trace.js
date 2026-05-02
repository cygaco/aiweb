#!/usr/bin/env node
/**
 * append-trace.js — append a reasoning trace to paths.tracesFile.
 * Required by /fix:deep Phase 5.0. Pass the JSON blob as the first arg.
 *
 * Usage: node scripts/append-trace.js '{"id":"RT-012","ts":"...","problem":"..."}'
 */
const { PATHS } = require("./hooks/lib/paths");
const fs = require("fs");

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node scripts/append-trace.js '<json>'");
  process.exit(1);
}
let entry;
try {
  entry = JSON.parse(arg);
} catch (e) {
  console.error("invalid JSON:", e.message);
  process.exit(1);
}
fs.appendFileSync(PATHS.tracesFile, JSON.stringify(entry) + "\n");
console.log(`appended trace ${entry.id ?? "?"} to ${PATHS.tracesFile}`);
