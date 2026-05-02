/**
 * mine-events-7d.js — One-shot pattern miner for /learn:events.
 * Streams events.jsonl, filters to last 7 days, prints stats to stdout.
 * Does NOT write learnings — that's a second pass after we eyeball the report.
 */
const fs = require("fs");
const path = require("path");
const { PROJECT, PATHS } = require(
  path.join(__dirname, "..", "hooks", "lib", "paths"),
);

const EVENTS = path.isAbsolute(PATHS.eventsFile)
  ? PATHS.eventsFile
  : path.join(PROJECT, PATHS.eventsFile);
const CUTOFF = Date.parse("2026-04-17T00:00:00Z");

const counts = {
  total: 0,
  inWindow: 0,
  byCat: {},
  toolCounts: {},
  toolFiles: {}, // tool -> file -> n
  blockReasons: {},
  blockHooks: {},
  specDriftFrom: {},
  specDriftTo: {},
  modFiles: {},
  hookFires: {},
  betaVerdicts: {},
  betaConfSum: 0,
  betaConfN: 0,
  sendMessage: 0,
};

function tsMs(ts) {
  if (!ts) return 0;
  if (typeof ts === "number") return ts;
  const p = Date.parse(ts);
  return isNaN(p) ? 0 : p;
}

const raw = fs.readFileSync(EVENTS, "utf8");
const lines = raw.split("\n");
for (const line of lines) {
  if (!line.trim()) continue;
  counts.total++;
  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    continue;
  }
  const t = tsMs(ev.ts);
  if (t && t < CUTOFF) continue;
  // tolerate ts:undefined entries by skipping window check
  if (t === 0) continue;
  counts.inWindow++;

  const cat = ev.cat || "unknown";
  counts.byCat[cat] = (counts.byCat[cat] || 0) + 1;

  const data = ev.data || {};

  if (cat === "tool") {
    const tn = data.tool || "unknown";
    counts.toolCounts[tn] = (counts.toolCounts[tn] || 0) + 1;
    if (data.file) {
      counts.toolFiles[tn] = counts.toolFiles[tn] || {};
      counts.toolFiles[tn][data.file] =
        (counts.toolFiles[tn][data.file] || 0) + 1;
    }
  }

  if (cat === "audit" || cat === "block") {
    const action = String(data.action || "");
    if (
      action.includes("blocked") ||
      action.includes("block") ||
      cat === "block"
    ) {
      const reason = (data.detail || data.reason || action).slice(0, 100);
      counts.blockReasons[reason] = (counts.blockReasons[reason] || 0) + 1;
      const hook = data.hook || data.source || data.guard || action;
      counts.blockHooks[hook] = (counts.blockHooks[hook] || 0) + 1;
    }
    // hook firings (any audit event with hook field)
    if (data.hook) {
      counts.hookFires[data.hook] = (counts.hookFires[data.hook] || 0) + 1;
    }
  }

  if (cat === "spec") {
    const action = String(data.action || "");
    const file = data.file || data.from || "";
    if (action.includes("drift") || action.includes("stale") || data.stale) {
      if (data.from) {
        counts.specDriftFrom[data.from] =
          (counts.specDriftFrom[data.from] || 0) + 1;
      }
      if (data.to) {
        counts.specDriftTo[data.to] = (counts.specDriftTo[data.to] || 0) + 1;
      } else if (file) {
        counts.specDriftFrom[file] = (counts.specDriftFrom[file] || 0) + 1;
      }
    }
  }

  if (cat === "modification") {
    const f = data.file || data.path || "unknown";
    counts.modFiles[f] = (counts.modFiles[f] || 0) + 1;
  }

  if (cat === "beta") {
    const v = (data.verdict || data.decision || "unknown").toUpperCase();
    counts.betaVerdicts[v] = (counts.betaVerdicts[v] || 0) + 1;
    if (typeof data.confidence === "number") {
      counts.betaConfSum += data.confidence;
      counts.betaConfN++;
    }
  }

  if (
    cat === "tool" &&
    (data.tool === "SendMessage" || data.tool === "send_message")
  ) {
    counts.sendMessage++;
  }
  if (cat === "inbox") counts.sendMessage++;
}

function topN(obj, n) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

console.log("=== /learn:events 7-day mine ===");
console.log(
  `Total events: ${counts.total} | in 7-day window (>= 2026-04-17): ${counts.inWindow}`,
);
console.log("\n[cat counts]");
console.log(topN(counts.byCat, 30));

console.log("\n[top 15 tools]");
console.log(topN(counts.toolCounts, 15));

console.log("\n[top Read targets — thrash check]");
const readTargets = counts.toolFiles.Read || {};
console.log(topN(readTargets, 10));

console.log("\n[top Bash targets]");
const bashTargets = counts.toolFiles.Bash || {};
console.log(topN(bashTargets, 10));

console.log("\n[top Edit targets — churn]");
console.log(topN(counts.toolFiles.Edit || {}, 10));

console.log("\n[top Write targets — churn]");
console.log(topN(counts.toolFiles.Write || {}, 10));

console.log("\n[top block reasons]");
console.log(topN(counts.blockReasons, 15));

console.log("\n[top block hooks/guards]");
console.log(topN(counts.blockHooks, 15));

console.log("\n[spec drift sources]");
console.log(topN(counts.specDriftFrom, 15));

console.log("\n[spec drift targets]");
console.log(topN(counts.specDriftTo, 15));

console.log("\n[modification files]");
console.log(topN(counts.modFiles, 15));

console.log("\n[hook firings]");
console.log(topN(counts.hookFires, 20));

console.log("\n[beta verdicts]");
console.log(counts.betaVerdicts);
console.log(
  `beta avg confidence: ${
    counts.betaConfN
      ? (counts.betaConfSum / counts.betaConfN).toFixed(2)
      : "n/a"
  } (n=${counts.betaConfN})`,
);

console.log("\n[inter-agent messaging count]", counts.sendMessage);
