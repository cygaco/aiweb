#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const STORE_PATH = path.resolve(
  __dirname,
  "../.claude/agents/02-oneshot/.system/store.json",
);
const s = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
s.heartbeat = {
  cycle: 3,
  phase: 3,
  feature: "market-research",
  agent: "delta",
  status: "building",
  cycleStep: "builder",
  workstream: null,
  timestamp: new Date().toISOString(),
  note: "market-research builder dispatched (opus 4.7 max effort)",
};
s.features["market-research"] = {
  ...s.features["market-research"],
  status: "in_progress",
};
fs.writeFileSync(STORE_PATH, JSON.stringify(s, null, 2));
console.log("store → market-research building");
