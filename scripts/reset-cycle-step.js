// Resets ROOT store heartbeat.cycleStep after merge window closes.
const fs = require("fs");
const path = require("path");

const rootStorePath = path.resolve(
  __dirname,
  "..",
  ".claude",
  "agents",
  "store.json",
);
const store = JSON.parse(fs.readFileSync(rootStorePath, "utf8"));
delete store.heartbeat.cycleStep;
store.heartbeat.timestamp = new Date().toISOString();
fs.writeFileSync(rootStorePath, JSON.stringify(store, null, 2));
console.log("cycleStep cleared from ROOT store heartbeat");
