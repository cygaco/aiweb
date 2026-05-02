#!/usr/bin/env node
const { PATHS } = require("./hooks/lib/paths");
const fs = require("fs");
const arg = process.argv[2];
if (!arg) {
  console.error("usage: node scripts/append-learning.js '<json>'");
  process.exit(1);
}
fs.appendFileSync(PATHS.learningsFile, arg + "\n");
console.log(`appended learning to ${PATHS.learningsFile}`);
