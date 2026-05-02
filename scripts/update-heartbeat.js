// Updates store.json heartbeat. Args: cycle phase feature status cycleStep note
const fs = require("fs");
const path = require("path");
const { PATHS } = require("./hooks/lib/paths");

const [, , cycle, phase, feature, status, cycleStep, ...noteParts] =
  process.argv;
const note = noteParts.join(" ");

const store = JSON.parse(fs.readFileSync(PATHS.oneshotStore, "utf8"));
store.heartbeat = {
  cycle: Number(cycle),
  phase: Number(phase),
  feature,
  agent: "delta",
  status,
  cycleStep,
  workstream: null,
  timestamp: new Date().toISOString(),
  note,
};
fs.writeFileSync(PATHS.oneshotStore, JSON.stringify(store, null, 2));
console.log(
  `heartbeat updated: cycle=${cycle} phase=${phase} feature=${feature} status=${status}`,
);
