#!/usr/bin/env node
// Mark features as "done" in the oneshot store. Usage: node scripts/delta-mark-done.js feat1 feat2 ...
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
const features = process.argv.slice(2);
if (features.length === 0) {
  console.error("usage: delta-mark-done.js <feature> [feature ...]");
  process.exit(1);
}
const store = JSON.parse(fs.readFileSync(STORE, "utf8"));
for (const f of features) {
  if (!store.features[f]) {
    console.error(`feature '${f}' not in store`);
    continue;
  }
  store.features[f].status = "done";
  store.features[f].completedAt = new Date().toISOString();
  console.log(`marked ${f} → done`);
}
fs.writeFileSync(STORE, JSON.stringify(store, null, 2) + "\n");
