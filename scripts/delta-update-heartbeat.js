#!/usr/bin/env node
// Delta orchestrator — update heartbeat in store.json
const fs = require("fs");
const path = require("path");

const storePath = path.join(
  __dirname,
  "../.claude/agents/02-oneshot/.system/store.json",
);
const store = JSON.parse(fs.readFileSync(storePath, "utf8"));

const [cycle, phase, feature, status, cycleStep, note] = process.argv.slice(2);

store.heartbeat = {
  cycle: parseInt(cycle, 10),
  phase: parseFloat(phase),
  feature,
  agent: "delta",
  status,
  cycleStep,
  workstream: null,
  timestamp: new Date().toISOString(),
  note: note || null,
};

fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
console.log("heartbeat updated:", JSON.stringify(store.heartbeat));
