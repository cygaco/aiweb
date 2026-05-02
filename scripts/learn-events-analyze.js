#!/usr/bin/env node
/**
 * learn-events-analyze.js
 * Mines events.jsonl for behavioral patterns, anomalies, insights.
 * Read-only analysis pass. No writes; use learn-events-write.js for writes.
 */
const fs = require("fs");
const path = require("path");

const EVENTS = path.join(
  __dirname,
  "..",
  ".claude",
  "project",
  "events",
  "events.jsonl",
);
const raw = fs.readFileSync(EVENTS, "utf8").trim().split("\n");

const now = Date.now();
const sevenDaysAgo = now - 7 * 86400000;

let total = 0,
  recent = 0;
const catTotal = {};
const catRecent = {};
const recentEvents = [];

// Per-category tallies
const fileHotspots = {}; // file path -> edit count
const readHotspots = {};
const hookFires = {}; // hook name -> count
const auditActions = {}; // action -> count
const dispatchUnknown = [];
const dispatchKnown = [];
const specChanges = {}; // target -> count
const specPending = []; // spec events with propagation_status=pending
const blockEvents = []; // blocked actions
const promptPatterns = {}; // recurring prompt keywords
const correctionKeywords = [
  "wrong",
  "stop",
  "no not",
  "no, not",
  "undo",
  "revert",
  "don't",
  "never",
  "didn't work",
];
const correctionEvents = [];
const modeFalsePositives = []; // team-mode events in oneshot
const worktreeEvents = [];
const bashSubprocessClaude = [];
const nodeEBlocks = [];
const promptValidatorBlocks = [];
const gap1101Events = [];

for (const line of raw) {
  if (!line) continue;
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    continue;
  }
  total++;
  catTotal[e.cat] = (catTotal[e.cat] || 0) + 1;
  const ts = new Date(e.ts).getTime();
  if (ts < sevenDaysAgo) continue;
  recent++;
  catRecent[e.cat] = (catRecent[e.cat] || 0) + 1;
  recentEvents.push(e);

  const data = e.data || {};
  const detail = (data.detail || "") + "";
  const action = data.action || "";
  const target = data.target || "";

  // Tool events — file hotspots
  if (e.cat === "tool") {
    const tool = data.tool || "";
    const file = data.file || target;
    if (file && (tool === "Edit" || tool === "Write")) {
      fileHotspots[file] = (fileHotspots[file] || 0) + 1;
    }
    if (file && tool === "Read") {
      readHotspots[file] = (readHotspots[file] || 0) + 1;
    }
    // Bash subprocess claude -p invocations
    if (tool === "Bash") {
      const cmd = data.command || "";
      if (/claude\s+-p\b/.test(cmd)) bashSubprocessClaude.push(e);
      if (/node\s+-e\b/.test(cmd)) nodeEBlocks.push(e);
    }
  }

  // Audit events — hook fires, blocks
  if (e.cat === "audit") {
    if (action) auditActions[action] = (auditActions[action] || 0) + 1;
    const hook = data.hook || data.guard || "";
    if (hook) hookFires[hook] = (hookFires[hook] || 0) + 1;
    if (action === "dispatch-unknown") dispatchUnknown.push(e);
    if (action === "dispatch-known" || action === "dispatch")
      dispatchKnown.push(e);
    if (
      action.includes("merge-guard") ||
      detail.includes("merge-guard") ||
      detail.includes("node -e with fs write blocked")
    ) {
      nodeEBlocks.push(e);
    }
    if (
      action.includes("prompt-validator") ||
      detail.includes("prompt-validator")
    ) {
      promptValidatorBlocks.push(e);
    }
    if (detail.includes("GAP-1101") || action.includes("GAP-1101")) {
      gap1101Events.push(e);
    }
  }

  // Block events
  if (e.cat === "block") {
    blockEvents.push(e);
  }

  // Spec events
  if (e.cat === "spec") {
    const specTarget = target || data.spec || "";
    if (specTarget)
      specChanges[specTarget] = (specChanges[specTarget] || 0) + 1;
    if (data.propagation_status === "pending") specPending.push(e);
  }

  // Prompt events
  if (e.cat === "prompt") {
    const p = (data.raw || data.stripped || "").toLowerCase();
    for (const k of correctionKeywords) {
      if (p.includes(k)) {
        correctionEvents.push({
          ts: e.ts,
          keyword: k,
          preview: p.slice(0, 100),
        });
        break;
      }
    }
  }

  // Mode anomalies — team-mode in oneshot
  const rawStr = JSON.stringify(e).toLowerCase();
  if (
    (rawStr.includes("oneshot") && rawStr.includes("team-mode")) ||
    (rawStr.includes("oneshot") && rawStr.includes("team_mode"))
  ) {
    modeFalsePositives.push(e);
  }
  if (
    rawStr.includes("worktree") &&
    (rawStr.includes("leak") ||
      rawStr.includes("isolation") ||
      rawStr.includes("phase-1") ||
      rawStr.includes("phase 1"))
  ) {
    worktreeEvents.push(e);
  }
}

// Sort hotspots
const topEdits = Object.entries(fileHotspots)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20);
const topReads = Object.entries(readHotspots)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20);
const topHooks = Object.entries(hookFires)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20);
const topAudits = Object.entries(auditActions)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 25);
const topSpecs = Object.entries(specChanges)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15);

console.log("=== EVENT COUNTS ===");
console.log("TOTAL events:", total);
console.log("LAST 7d events:", recent);
console.log("Total by cat:");
for (const [k, v] of Object.entries(catTotal).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v}`);
}
console.log("\nLast-7d by cat:");
for (const [k, v] of Object.entries(catRecent).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v}`);
}

console.log("\n=== TOP EDIT HOTSPOTS (7d) ===");
topEdits.forEach(([f, c]) => console.log(`  ${c}x  ${f}`));

console.log("\n=== TOP READ HOTSPOTS (7d, 5+) ===");
topReads
  .filter(([, c]) => c >= 5)
  .forEach(([f, c]) => console.log(`  ${c}x  ${f}`));

console.log("\n=== HOOK FIRES (7d) ===");
topHooks.forEach(([h, c]) => console.log(`  ${c}x  ${h}`));

console.log("\n=== AUDIT ACTIONS (7d) ===");
topAudits.forEach(([a, c]) => console.log(`  ${c}x  ${a}`));

console.log("\n=== DISPATCH RATIO ===");
console.log(`  dispatch-unknown: ${dispatchUnknown.length}`);
console.log(`  dispatch-known: ${dispatchKnown.length}`);
if (dispatchKnown.length > 0)
  console.log(
    `  ratio: ${(dispatchUnknown.length / dispatchKnown.length).toFixed(1)}x`,
  );

console.log("\n=== SPEC CHANGES (7d, top 15) ===");
topSpecs.forEach(([s, c]) => console.log(`  ${c}x  ${s}`));
console.log(
  `  spec events with propagation_status=pending: ${specPending.length}`,
);

console.log("\n=== BLOCK EVENTS (7d) ===");
console.log(`  total blocks: ${blockEvents.length}`);
const blockActions = {};
blockEvents.forEach((b) => {
  const a = (b.data && b.data.action) || "unknown";
  blockActions[a] = (blockActions[a] || 0) + 1;
});
Object.entries(blockActions)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .forEach(([a, c]) => console.log(`  ${c}x  ${a}`));

console.log("\n=== CORRECTION PROMPTS (7d) ===");
console.log(`  ${correctionEvents.length} correction-keyword prompts`);
const kwTally = {};
correctionEvents.forEach((c) => {
  kwTally[c.keyword] = (kwTally[c.keyword] || 0) + 1;
});
Object.entries(kwTally)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(`  ${v}x  "${k}"`));

console.log("\n=== MODE ANOMALIES (7d) ===");
console.log(
  `  team-mode false positive w/ oneshot: ${modeFalsePositives.length}`,
);

console.log("\n=== WORKTREE ISOLATION (7d) ===");
console.log(`  worktree leak/isolation events: ${worktreeEvents.length}`);

console.log("\n=== BASH SUBPROCESS claude -p (7d) ===");
console.log(`  references: ${bashSubprocessClaude.length}`);

console.log("\n=== NODE -E / MERGE-GUARD BLOCKS (7d) ===");
console.log(`  node -e blocks or merge-guard: ${nodeEBlocks.length}`);

console.log("\n=== PROMPT-VALIDATOR / GAP-1101 (7d) ===");
console.log(`  prompt-validator events: ${promptValidatorBlocks.length}`);
console.log(`  GAP-1101 events: ${gap1101Events.length}`);

// Expose a few samples to stderr for evidence citation
console.log("\n=== SAMPLE EVIDENCE ===");
if (dispatchUnknown.length) {
  console.log(
    "sample dispatch-unknown:",
    JSON.stringify(dispatchUnknown[0]).slice(0, 300),
  );
}
if (nodeEBlocks.length) {
  console.log(
    "sample node-e block:",
    JSON.stringify(nodeEBlocks[0]).slice(0, 300),
  );
}
if (specPending.length) {
  console.log(
    "sample spec pending:",
    JSON.stringify(specPending[0]).slice(0, 300),
  );
}
if (worktreeEvents.length) {
  console.log(
    "sample worktree event:",
    JSON.stringify(worktreeEvents[0]).slice(0, 300),
  );
}
