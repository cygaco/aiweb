#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const store = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, ".claude/agents/02-oneshot/.system/store.json"),
    "utf8",
  ),
);

const STUB_LINE_THRESHOLD = 30;

const missing = [];
const stubs = [];
const filled = [];

for (const [name, entry] of Object.entries(store.features || {})) {
  if (entry.status === "done" || entry.status === "skipped") continue;
  if (!Array.isArray(entry.files)) continue;
  for (const f of entry.files) {
    const abs = path.join(ROOT, f);
    if (!fs.existsSync(abs)) {
      missing.push({ feature: name, file: f });
    } else {
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) continue;
      const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/).length;
      if (lines <= STUB_LINE_THRESHOLD) {
        stubs.push({ feature: name, file: f, lines });
      } else {
        filled.push({ feature: name, file: f, lines });
      }
    }
  }
}

console.log(`Missing files: ${missing.length}`);
for (const m of missing) console.log(`  ${m.feature}: ${m.file}`);
console.log(
  `\nThin stubs (≤${STUB_LINE_THRESHOLD} lines, expected for skeleton run): ${stubs.length}`,
);
console.log(
  `Filled (>${STUB_LINE_THRESHOLD} lines, suspicious): ${filled.length}`,
);
for (const f of filled)
  console.log(`  ${f.feature}: ${f.file} (${f.lines} lines)`);
