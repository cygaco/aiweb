#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const STORE_PATH = path.resolve(
  __dirname,
  "../.claude/agents/02-oneshot/.system/store.json",
);
const s = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
s.heartbeat.cycleStep = "review-complete";
fs.writeFileSync(STORE_PATH, JSON.stringify(s, null, 2));
console.log("cycleStep → review-complete");
