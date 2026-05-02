// Analyze run-12 events for learning patterns
const fs = require("fs");
const path = require("path");

const file = process.argv[2] || "/tmp/run12.jsonl";
const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
const events = [];
for (const l of lines) {
  try {
    events.push(JSON.parse(l));
  } catch {}
}

console.log("Total events:", events.length);

// 1. Category breakdown
const cats = {};
events.forEach((e) => (cats[e.cat] = (cats[e.cat] || 0) + 1));
console.log("\n=== CATEGORIES ===");
Object.entries(cats)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(" ", k, ":", v));

// 2. Tool hotspots
const tools = {};
const toolFails = {};
events
  .filter((e) => e.cat === "tool")
  .forEach((e) => {
    const t = (e.data && e.data.tool) || "unknown";
    tools[t] = (tools[t] || 0) + 1;
    if (e.data && e.data.success === false)
      toolFails[t] = (toolFails[t] || 0) + 1;
  });
console.log("\n=== TOOL CALLS ===");
Object.entries(tools)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .forEach(([k, v]) => {
    const f = toolFails[k] || 0;
    console.log(" ", k, ":", v, "(failures:", f + ")");
  });

// 3. Audit events (PreToolUse rejections, decisions)
const audits = {};
const auditDetail = {};
events
  .filter((e) => e.cat === "audit")
  .forEach((e) => {
    const action = (e.data && e.data.action) || "unknown";
    audits[action] = (audits[action] || 0) + 1;
    if (
      action.includes("block") ||
      action.includes("reject") ||
      action.includes("failed")
    ) {
      const key = action + ":" + ((e.data && e.data.detail) || "").slice(0, 80);
      auditDetail[key] = (auditDetail[key] || 0) + 1;
    }
  });
console.log("\n=== AUDIT ACTIONS ===");
Object.entries(audits)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .forEach(([k, v]) => console.log(" ", k, ":", v));

console.log("\n=== AUDIT BLOCKS/FAILURES (with detail) ===");
Object.entries(auditDetail)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .forEach(([k, v]) => console.log(" ", v + "x:", k));

// 4. PreToolUse rejections (look for blocks specifically)
const blocks = events.filter(
  (e) =>
    e.cat === "audit" &&
    e.data &&
    (String(e.data.action || "").includes("block") ||
      String(e.data.action || "").includes("reject") ||
      String(e.data.type || "") === "guard"),
);
console.log("\n=== BLOCKS (", blocks.length, ") ===");
const blockTypes = {};
blocks.forEach((e) => {
  const key = (e.data.type || "") + "/" + (e.data.action || "");
  blockTypes[key] = (blockTypes[key] || 0) + 1;
});
Object.entries(blockTypes)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(" ", k, ":", v));

// 5. File churn — same file edited repeatedly
const fileEdits = {};
events
  .filter(
    (e) =>
      e.cat === "tool" &&
      ["Edit", "Write", "MultiEdit"].includes((e.data || {}).tool),
  )
  .forEach((e) => {
    const f = (e.data && e.data.file) || "";
    if (f) fileEdits[f] = (fileEdits[f] || 0) + 1;
  });
console.log("\n=== FILE CHURN (top 15) ===");
Object.entries(fileEdits)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .forEach(([k, v]) => console.log(" ", v + "x:", k));

// 6. Spec edits (requirements/specs)
const specEdits = events.filter((e) => {
  if (e.cat !== "tool") return false;
  const d = e.data || {};
  if (!["Edit", "Write", "MultiEdit"].includes(d.tool)) return false;
  const f = String(d.file || "");
  return (
    f.includes("spec") ||
    f.includes("requirement") ||
    f.includes("SPEC") ||
    f.includes("store.json")
  );
});
console.log("\n=== SPEC EDITS (", specEdits.length, ") ===");
const specTimes = specEdits.map((e) => e.ts).sort();
if (specTimes.length)
  console.log(
    " First:",
    specTimes[0],
    "Last:",
    specTimes[specTimes.length - 1],
  );
const specFiles = {};
specEdits.forEach((e) => {
  const f = (e.data || {}).file || "";
  specFiles[f] = (specFiles[f] || 0) + 1;
});
Object.entries(specFiles)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .forEach(([k, v]) => console.log(" ", v + "x:", k));

// 7. Dispatcher / Task invocations
const dispatches = events.filter(
  (e) => e.cat === "tool" && (e.data || {}).tool === "Task",
);
console.log("\n=== TASK DISPATCHES (", dispatches.length, ") ===");
const roles = {};
dispatches.forEach((e) => {
  const f = (e.data && e.data.file) || "";
  const desc = String(f).slice(0, 60);
  roles[desc] = (roles[desc] || 0) + 1;
});
Object.entries(roles)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .forEach(([k, v]) => console.log(" ", v + "x:", k));

// 8. Hook firings (PreToolUse / PostToolUse)
const hooks = {};
events
  .filter((e) => e.cat === "audit")
  .forEach((e) => {
    const t = (e.data && e.data.type) || "";
    if (t) hooks[t] = (hooks[t] || 0) + 1;
  });
console.log("\n=== HOOK TYPES ===");
Object.entries(hooks)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .forEach(([k, v]) => console.log(" ", k, ":", v));

// 9. Time window
const times = events
  .map((e) => e.ts)
  .filter(Boolean)
  .sort();
console.log("\n=== TIME WINDOW ===");
console.log(" First:", times[0]);
console.log(" Last:", times[times.length - 1]);

// 10. Bash patterns - high-freq commands
const bashCmds = {};
events
  .filter((e) => e.cat === "tool" && (e.data || {}).tool === "Bash")
  .forEach((e) => {
    const f = (e.data && e.data.file) || "";
    const head = String(f).slice(0, 40);
    bashCmds[head] = (bashCmds[head] || 0) + 1;
  });
console.log("\n=== TOP BASH PATTERNS ===");
Object.entries(bashCmds)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .forEach(([k, v]) => console.log(" ", v + "x:", k));
