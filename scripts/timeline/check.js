#!/usr/bin/env node
/**
 * Reconstructs timeline for a build id from events, build transaction, and provider traces.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

function loadPaths() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, ".claude", "paths.json"), "utf8"));
  } catch {
    return {};
  }
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function timeline(buildId) {
  const paths = loadPaths();
  const events = readJsonl(path.join(ROOT, paths.eventsFile || ".claude/project/events/events.jsonl"));
  const provider = readJsonl(path.join(ROOT, paths.providerTrace || ".claude/project/decisions/provider-trace.jsonl"));
  const buildFile = path.join(ROOT, ".claude", "project", "builds", buildId || "", "transaction.json");
  const tx = fs.existsSync(buildFile) ? JSON.parse(fs.readFileSync(buildFile, "utf8")) : null;
  const rows = [];
  if (tx) rows.push({ ts: tx.startedAt, source: "transaction", action: "started", buildId: tx.buildId });
  for (const e of events) {
    const hay = JSON.stringify(e);
    if (!buildId || hay.includes(buildId)) rows.push({ ts: e.ts, source: "events", action: e.cat || e.data?.action, data: e.data });
  }
  for (const p of provider) {
    if (!buildId || JSON.stringify(p).includes(buildId)) rows.push({ ts: p.ts, source: "provider", action: p.role, data: p });
  }
  rows.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  return { buildId: buildId || null, transaction: tx, events: rows };
}

if (require.main === module) {
  const buildId = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
  const result = timeline(buildId);
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { timeline };
