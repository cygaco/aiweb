#!/usr/bin/env node
// Remove haltReason from store.heartbeat. Run when the halt condition is resolved.
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

const store = JSON.parse(fs.readFileSync(STORE, "utf8"));
if (store.heartbeat?.haltReason) {
  delete store.heartbeat.haltReason;
  store.heartbeat.timestamp = new Date().toISOString();
  fs.writeFileSync(STORE, JSON.stringify(store, null, 2) + "\n");
  console.log("haltReason cleared");
} else {
  console.log("no haltReason present");
}
