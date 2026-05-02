#!/usr/bin/env node
/**
 * delta-show-findings.js — print the inner JSON envelope from a reviewer
 * output file (after stripping prose-leak warning).
 *
 * Usage: node scripts/delta-show-findings.js <feature> <role>
 */
const fs = require("fs");
const path = require("path");

const [, , feature, role] = process.argv;
if (!feature || !role) {
  console.error("usage: delta-show-findings.js <feature> <role>");
  process.exit(1);
}

const file = path.join(
  __dirname,
  "..",
  ".claude",
  "runtime",
  "dispatch",
  "reviewers",
  `${feature}-${role}-output.json`,
);

let body = fs.readFileSync(file, "utf8");
body = body.replace(/^\[parseProviderJson\][^\n]*\n/, "");
const env = JSON.parse(body);
const out = env.output || "";
const i = out.lastIndexOf("```json");
if (i < 0) {
  console.log(out);
  process.exit(0);
}
const after = out.slice(i + "```json".length);
const closeFence = after.indexOf("```");
const inner = closeFence < 0 ? after : after.slice(0, closeFence);
console.log(inner.trim());
