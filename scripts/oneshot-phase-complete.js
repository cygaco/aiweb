#!/usr/bin/env node
/**
 * oneshot-phase-complete.js — Mark phase features done + log cycle scores.
 *
 * Usage: node scripts/oneshot-phase-complete.js <phase> <feature1>,<feature2>... <score1>,<score2>...
 * Example: node scripts/oneshot-phase-complete.js 1 auth,rockets 94,92
 */
const fs = require("fs");
const path = require("path");

const [, , phase, featuresArg, scoresArg] = process.argv;
if (!scoresArg) {
  console.error("usage: oneshot-phase-complete.js <phase> <features> <scores>");
  process.exit(1);
}
const features = featuresArg.split(",");
const scores = scoresArg.split(",").map(Number);

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

for (let i = 0; i < features.length; i++) {
  const f = features[i];
  if (!s.features[f]) {
    console.error(`unknown feature: ${f}`);
    continue;
  }
  s.features[f].status = "done";
  s.features[f].finalScore = scores[i];
  s.features[f].completedAt = new Date().toISOString();
  s.features[f].phase = Number(phase);
}

s.cycle = (s.cycle || 0) + 1;
s.heartbeat = {
  cycle: s.cycle,
  phase: Number(phase),
  feature: null,
  agent: "delta",
  status: `phase-${phase}-complete`,
  cycleStep: "phase-complete",
  workstream: null,
  timestamp: new Date().toISOString(),
};

// Record in runLog
s.runLog = s.runLog || {};
s.runLog.phases = s.runLog.phases || {};
s.runLog.phases[phase] = {
  features: features.map((f, i) => ({ name: f, score: scores[i] })),
  completedAt: new Date().toISOString(),
};

fs.writeFileSync(storePath, JSON.stringify(s, null, 2));
console.log(
  `Phase ${phase} complete: ${features.map((f, i) => `${f}=${scores[i]}`).join(", ")}`,
);
console.log(`Cycle advanced to ${s.cycle}`);
