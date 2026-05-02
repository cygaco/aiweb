#!/usr/bin/env node
// One-off: survey learnings.jsonl for /learn:integrate Phase A — find candidates
// score >= 0.7, status != implemented/logged, !implemented_by.
const fs = require("fs");
const { PATHS } = require("./hooks/lib/paths");

const lines = fs
  .readFileSync(PATHS.learningsFile, "utf8")
  .split("\n")
  .filter(Boolean);
const learnings = [];
for (let i = 0; i < lines.length; i++) {
  try {
    const entry = JSON.parse(lines[i]);
    entry._line = i + 1;
    learnings.push(entry);
  } catch {}
}

console.log("Total learnings:", learnings.length);

const candidates = learnings.filter((l) => {
  const score = typeof l.score === "number" ? l.score : 0;
  const status = l.status || (l.pending_validation ? "logged" : "validated");
  if (score < 0.7) return false;
  if (status === "implemented") return false;
  if (status === "logged") return false;
  if (l.implemented_by) return false;
  return true;
});

console.log(
  "\nPromotion candidates (score>=0.7, !implemented, !logged):",
  candidates.length,
);
console.log("\nTop candidates by score:");
candidates
  .sort((a, b) => (b.score || 0) - (a.score || 0))
  .slice(0, 12)
  .forEach((c) => {
    const id = c.id || `line${c._line}`;
    const intent = c.intent || c.type || "unknown";
    const status = c.status || "validated";
    const tip = (c.tip || c.text || "").slice(0, 100);
    console.log(`  [${id}] score=${c.score} intent=${intent} status=${status}`);
    console.log(`    ${tip}`);
  });

// Status histogram
const statuses = {};
for (const l of learnings) {
  const s = l.status || (l.pending_validation ? "logged" : "validated");
  statuses[s] = (statuses[s] || 0) + 1;
}
console.log("\nStatus histogram:");
Object.entries(statuses).forEach(([k, v]) => console.log(" ", k, ":", v));
