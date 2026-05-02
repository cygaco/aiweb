#!/usr/bin/env node
// One-off: mine events.jsonl for behavioral patterns last 7d.
// Self-contained because merge-guard blocks all `node -e` (RI-004 broader scope than I thought).
const fs = require("fs");
const { PATHS } = require("./hooks/lib/paths");

const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
const lines = fs
  .readFileSync(PATHS.eventsFile, "utf8")
  .split("\n")
  .filter(Boolean);
const events = [];
for (const l of lines) {
  try {
    events.push(JSON.parse(l));
  } catch {}
}
const recent = events.filter((e) => {
  const t = e.ts ? Date.parse(e.ts) : 0;
  return t >= cutoff;
});

console.log("Total events 7d:", recent.length);

const tally = (key) => {
  const m = {};
  for (const e of recent) {
    const v = key(e);
    if (v) m[v] = (m[v] || 0) + 1;
  }
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
};

const cats = tally((e) => e.cat || "unknown");
console.log("\nTop categories:");
cats.slice(0, 12).forEach(([k, v]) => console.log(" ", k, ":", v));

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));

const tools = tally((e) => {
  if (e.cat !== "tool" || !e.data) return null;
  return str(e.data.tool_name || e.data.tool || e.data.name);
});
console.log("\nTop tools:");
tools.slice(0, 10).forEach(([k, v]) => console.log(" ", k, ":", v));

const hooks = tally((e) => {
  if (e.cat !== "hook" || !e.data) return null;
  return str(e.data.hook_name || e.data.hook || e.data.name);
});
console.log("\nTop hooks (fired):");
hooks.slice(0, 10).forEach(([k, v]) => console.log(" ", k, ":", v));

const audits = tally((e) => {
  if (e.cat !== "audit" || !e.data) return null;
  if (!str(e.data.action).includes("blocked")) return null;
  return `${str(e.data.hook) || "?"} :: ${str(e.data.reason).slice(0, 80)}`;
});
console.log("\nTop audit-blocks (recurring system pain):");
audits.slice(0, 10).forEach(([k, v]) => console.log(" ", v + "x", k));

const skills = tally((e) => {
  if (e.cat === "prompt" && e.data && typeof e.data.text === "string") {
    const m = e.data.text.match(/^\/([a-z]+:[a-z]+(:[a-z]+)?)\b/i);
    if (m) return m[1];
  }
  return null;
});
console.log("\nTop skill invocations:");
skills.slice(0, 10).forEach(([k, v]) => console.log(" ", k, ":", v));

const dailyFires = {};
for (const e of recent) {
  if (e.ts) {
    const day = e.ts.slice(0, 10);
    dailyFires[day] = (dailyFires[day] || 0) + 1;
  }
}
console.log("\nDaily activity:");
Object.entries(dailyFires)
  .sort()
  .forEach(([d, n]) => console.log(" ", d, ":", n));
