const fs = require("fs");
const path = require("path");

const storePath = path.join(
  __dirname,
  "../.claude/agents/02-oneshot/.system/store.json",
);
const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
const now = new Date().toISOString();

store.features["market-research"].status = "done";
store.features["market-research"].builderCommit = "a3898f0";
store.features["market-research"].typecheckClean = true;
store.features["market-research"].fixAttempts = 0;
store.features["market-research"].completedAt = now;
store.features["market-research"].phase = 3;

store.heartbeat = {
  cycle: 5,
  phase: 3,
  feature: "market-research",
  agent: "delta",
  status: "gauntlet",
  cycleStep: "reviewing",
  workstream: null,
  timestamp: now,
  note: "market-research merged (b0a1173), typecheck clean — running gauntlet",
};

fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
console.log("store updated: market-research=done, gauntlet reviewing");
