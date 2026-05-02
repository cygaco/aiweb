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

const backendFiles = new Set(store.features.backend.files);

const allMissing = new Set();
const inBackend = [];
const notInBackend = [];

for (const [name, entry] of Object.entries(store.features || {})) {
  if (entry.status === "done" || entry.status === "skipped") continue;
  if (!Array.isArray(entry.files)) continue;
  for (const f of entry.files) {
    const abs = path.join(ROOT, f);
    if (!fs.existsSync(abs)) {
      if (!allMissing.has(f)) {
        allMissing.add(f);
        if (backendFiles.has(f)) inBackend.push(f);
        else notInBackend.push({ feature: name, file: f });
      }
    }
  }
}

console.log(`Unique missing files: ${allMissing.size}`);
console.log(`  In backend.files: ${inBackend.length}`);
console.log(`  NOT in backend.files: ${notInBackend.length}`);
if (notInBackend.length) {
  console.log("\nNon-backend missing files:");
  for (const x of notInBackend) console.log(`  ${x.feature}: ${x.file}`);
}
