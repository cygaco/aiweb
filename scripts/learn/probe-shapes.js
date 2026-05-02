// Probe event shapes for spec/beta/hook within the 7-day window.
const fs = require("fs");
const path = require("path");
const file = path.join(
  __dirname,
  "..",
  "..",
  ".claude",
  "project",
  "events",
  "events.jsonl",
);
const lines = fs.readFileSync(file, "utf8").split("\n");
const cutoff = Date.parse("2026-04-17T00:00:00Z");
const specSamp = [],
  betaSamp = [],
  hookSamp = [],
  driftSamp = [],
  reqSamp = [];
let specActions = {},
  hookFields = {};
for (const line of lines) {
  if (!line.trim()) continue;
  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    continue;
  }
  const t = Date.parse(ev.ts || "");
  if (!t || t < cutoff) continue;
  const data = ev.data || {};
  if (ev.cat === "spec") {
    const a = String(data.action || data.event || "?");
    specActions[a] = (specActions[a] || 0) + 1;
    if (specSamp.length < 6) specSamp.push(ev);
  }
  if (ev.cat === "requirement_staged" && reqSamp.length < 4) reqSamp.push(ev);
  if (ev.cat === "beta" && betaSamp.length < 6) betaSamp.push(ev);
  if (ev.cat === "audit") {
    if (data.hook) {
      hookFields[data.hook] = (hookFields[data.hook] || 0) + 1;
      if (hookSamp.length < 4) hookSamp.push(ev);
    }
  }
  const a = String(data.action || "");
  if ((a.includes("drift") || a.includes("stale")) && driftSamp.length < 6)
    driftSamp.push(ev);
}
console.log("SPEC action counts:", specActions);
console.log("\nSPEC samples:");
for (const e of specSamp) console.log(JSON.stringify(e).slice(0, 350));
console.log("\nREQUIREMENT_STAGED samples:");
for (const e of reqSamp) console.log(JSON.stringify(e).slice(0, 350));
console.log("\nDRIFT samples (audit/data.action):");
for (const e of driftSamp) console.log(JSON.stringify(e).slice(0, 350));
console.log("\nBETA samples:");
for (const e of betaSamp) console.log(JSON.stringify(e).slice(0, 350));
console.log("\nHOOK-field counts:", hookFields);
console.log("\nHOOK-field samples:");
for (const e of hookSamp) console.log(JSON.stringify(e).slice(0, 350));
