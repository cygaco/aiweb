#!/usr/bin/env node
// Update store.heartbeat to "awaiting-delta-launch" so any monitor
// can see run-10 is prepped but Delta hasn't started its state
// machine yet (since Delta is designed as a separate session).
const fs = require("fs");
const { PATHS } = require("./hooks/lib/paths");

const s = JSON.parse(fs.readFileSync(PATHS.oneshotStore, "utf8"));
s.heartbeat = {
  cycle: 0,
  phase: "startup",
  feature: null,
  agent: "delta",
  status: "awaiting-launch",
  cycleStep: "session-handoff",
  workstream: null,
  timestamp: new Date().toISOString(),
  note: "Run-10 prepped by Alpha session 2026-04-25. World is launch-ready (skeleton-test10, store reset, build clean, mode=oneshot). Delta launches by opening a fresh Claude Code session in this project dir and instructing: 'Read and execute .claude/agents/00-alex/delta.md'.",
};
fs.writeFileSync(PATHS.oneshotStore, JSON.stringify(s, null, 2));
console.log("Heartbeat updated: delta / awaiting-launch / session-handoff");
