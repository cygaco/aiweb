#!/usr/bin/env node
// Append a foundation-update request to store.foundationQueue for later resolution.
// Usage:
//   node scripts/delta-queue-foundation.js '<file>' '<reason>' '<requested-by-feature>'
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

const [, , file, reason, byFeature] = process.argv;
if (!file || !reason || !byFeature) {
  console.error(
    "usage: delta-queue-foundation.js <file> <reason> <requested-by-feature>",
  );
  process.exit(1);
}

const store = JSON.parse(fs.readFileSync(STORE, "utf8"));
store.foundationQueue = store.foundationQueue || [];
store.foundationQueue.push({
  file,
  reason,
  requestedBy: byFeature,
  timestamp: new Date().toISOString(),
  resolved: false,
});
fs.writeFileSync(STORE, JSON.stringify(store, null, 2) + "\n");
console.log(
  `queued: ${file} (by ${byFeature}) — ${store.foundationQueue.length} total in queue`,
);
