// Probe spec churn (top files) and audit action vocabulary.
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
const specFiles = {},
  staleConsumers = {},
  propagatedFalse = 0,
  propagatedTrue = 0,
  auditActions = {};
let propagatedFalseFiles = {};
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
    const f = data.file || "?";
    specFiles[f] = (specFiles[f] || 0) + 1;
    if (data.propagated === false) {
      // count
      // eslint-disable-next-line no-unused-vars
      propagatedFalseFiles[f] = (propagatedFalseFiles[f] || 0) + 1;
    }
    if (Array.isArray(data.stale_consumers)) {
      for (const sc of data.stale_consumers) {
        staleConsumers[sc] = (staleConsumers[sc] || 0) + 1;
      }
    }
  }
  if (ev.cat === "audit") {
    const a = String(data.action || data.type || "?");
    auditActions[a] = (auditActions[a] || 0) + 1;
  }
}
function top(o, n) {
  return Object.entries(o)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}
console.log("[top spec-churn files]");
console.log(top(specFiles, 15));
console.log("\n[top stale_consumers]");
console.log(top(staleConsumers, 15));
console.log("\n[top spec files with propagated=false]");
console.log(top(propagatedFalseFiles, 15));
console.log("\n[top audit actions]");
console.log(top(auditActions, 25));
