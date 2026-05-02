#!/usr/bin/env node
/**
 * oneshot-heartbeat.js — Update Delta's heartbeat per protocol 3.6.
 *
 * Usage: node scripts/oneshot-heartbeat.js <cycle> <phase> <feature|-> <status>
 * Example: node scripts/oneshot-heartbeat.js 1 1 auth,rockets dispatching
 */
const fs = require("fs");
const path = require("path");

const [, , cycle, phase, feature, status] = process.argv;
if (!status) {
  console.error(
    "usage: oneshot-heartbeat.js <cycle> <phase> <feature|-> <status>",
  );
  process.exit(1);
}

const storePath = path.resolve(
  __dirname,
  "..",
  ".claude",
  "agents",
  "02-oneshot",
  ".system",
  "store.json",
);

const s = JSON.parse(fs.readFileSync(storePath, "utf8"));
s.heartbeat = {
  cycle: Number(cycle),
  phase: phase === "-" ? null : isNaN(Number(phase)) ? phase : Number(phase),
  feature: feature === "-" ? null : feature,
  agent: "delta",
  status,
  cycleStep: status,
  workstream: null,
  timestamp: new Date().toISOString(),
};
fs.writeFileSync(storePath, JSON.stringify(s, null, 2));
console.log(
  `heartbeat: cycle=${cycle} phase=${phase} feature=${feature} status=${status}`,
);
