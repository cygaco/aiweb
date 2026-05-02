#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "..", ".claude", "project", "maps");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));

let bad = 0;
for (const f of files) {
  const lines = fs
    .readFileSync(path.join(dir, f), "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
  let ok = true;
  for (const line of lines) {
    try {
      JSON.parse(line);
    } catch (e) {
      ok = false;
      bad += 1;
      console.log(`BAD ${f}: ${e.message}`);
      break;
    }
  }
  if (ok) console.log(`OK ${f} (${lines.length} lines)`);
}
console.log(`\nDone — bad files: ${bad}`);
process.exit(bad === 0 ? 0 : 1);
