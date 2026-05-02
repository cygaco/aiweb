#!/usr/bin/env node
/**
 * oneshot-store-reset.js — One-time store reset for a fresh skeleton run.
 *
 * Resets non-foundation feature statuses to "not_started", clears failure
 * counters, refreshes runLog, and updates the heartbeat for Delta startup.
 * Foundation features stay "done" because the --gut pass leaves them intact.
 *
 * Usage: node scripts/oneshot-store-reset.js <branch-name>
 */
const fs = require("fs");
const path = require("path");

const branch = process.argv[2] || "skeleton-testN";
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

// Backup current store alongside
fs.writeFileSync(
  storePath + ".prev-run-backup.json",
  JSON.stringify(s, null, 2),
);

let resetCount = 0;
for (const [name, f] of Object.entries(s.features)) {
  if (name.startsWith("foundation-")) continue;
  f.status = "not_started";
  f.owner = null;
  f.fixAttempts = 0;
  f.note = null;
  resetCount++;
}

s.cycle = 0;
s.consecutiveFailures = 0;
s.totalFailures = 0;
s.circuitBreaker = "CLOSED";
s.lastCooldownMs = 0;

// Close the prior runLog before starting a new one. Pass 5.1 audit
// previously WARNed/ERRORed because finalStatus stayed null across runs
// and prior summary lingered (e.g. "Run 006" still in the field at the
// start of run 10). Archive prior runLog into runLogHistory[] and start
// fresh.
s.runLog = s.runLog || {};
if (
  s.runLog.finalStatus === null &&
  (s.runLog.startedAt || s.runLog.summary || s.runLog.branch)
) {
  // Implicit completion — running preflight implies prior run is over.
  s.runLog.finalStatus = "completed";
  s.runLog.endedAt = new Date().toISOString();
  s.runLog.closedBy = "oneshot-store-reset.js (implicit)";
}
if (s.runLog.startedAt || s.runLog.summary) {
  s.runLogHistory = s.runLogHistory || [];
  s.runLogHistory.push({ ...s.runLog });
  // Cap history at 20 entries — older runs live in retros/.
  if (s.runLogHistory.length > 20) {
    s.runLogHistory = s.runLogHistory.slice(-20);
  }
}

// Derive runId from branch name (skeleton-test10 → run-010).
const runIdMatch = (branch || "").match(/skeleton-test(\d+)/);
const runId = runIdMatch
  ? `run-${String(runIdMatch[1]).padStart(3, "0")}`
  : null;

// Fresh runLog for this run.
s.runLog = {
  runId,
  branch,
  startedAt: new Date().toISOString(),
  finalStatus: null,
  endedAt: null,
  haltReason: null,
  summary: null,
};

s.heartbeat = {
  cycle: 0,
  phase: "startup",
  feature: null,
  agent: "delta",
  status: "initializing",
  cycleStep: "pre-flight",
  workstream: null,
  timestamp: new Date().toISOString(),
};

fs.writeFileSync(storePath, JSON.stringify(s, null, 2));
console.log(`Reset ${resetCount} non-foundation features to not_started`);
console.log(`Foundation features preserved as done`);
console.log(`runLog.branch=${branch}, cycle=0, circuitBreaker=CLOSED`);
console.log(`Heartbeat: delta/startup`);
console.log(`Backup: ${path.basename(storePath)}.prev-run-backup.json`);
