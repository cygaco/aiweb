#!/usr/bin/env node
/**
 * delta-heartbeat.js — update delta's heartbeat in the oneshot store.
 *
 * Usage: node scripts/delta-heartbeat.js '<json-fragment>'
 *   e.g. node scripts/delta-heartbeat.js '{"phase":1,"cycleStep":"dispatching","feature":"auth+rockets","status":"dispatching"}'
 *
 * Writes to .claude/agents/02-oneshot/.system/store.json → heartbeat.
 * Merges with existing heartbeat, sets agent='delta' and timestamp=now.
 */
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

const patchArg = process.argv[2];
if (!patchArg) {
  console.error("usage: node scripts/delta-heartbeat.js '<json>'");
  process.exit(1);
}

let patch;
try {
  patch = JSON.parse(patchArg);
} catch (e) {
  console.error("Invalid JSON: " + e.message);
  process.exit(1);
}

const store = JSON.parse(fs.readFileSync(STORE, "utf8"));
store.heartbeat = {
  ...(store.heartbeat || {}),
  ...patch,
  agent: "delta",
  timestamp: new Date().toISOString(),
};

fs.writeFileSync(STORE, JSON.stringify(store, null, 2) + "\n");
console.log("heartbeat updated:", JSON.stringify(store.heartbeat));
