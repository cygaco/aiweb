// Deeper analysis of run-12 specific patterns
const fs = require("fs");

const inPath =
  process.argv[2] || "C:\\Users\\VLADIS~1\\AppData\\Local\\Temp\\run12.jsonl";
const lines = fs.readFileSync(inPath, "utf8").split("\n").filter(Boolean);
const events = lines
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

// 1. Look at all merge-guard blocks - what commands triggered them?
console.log("=== MERGE-GUARD BLOCKS (full detail) ===");
events
  .filter(
    (e) => e.cat === "audit" && (e.data || {}).action === "merge-guard-blocked",
  )
  .forEach((e) => {
    console.log(" ts:", e.ts, "\n   detail:", (e.data || {}).detail);
  });

// 2. Dispatch-unknown events
console.log("\n=== DISPATCH-UNKNOWN ===");
events
  .filter(
    (e) => e.cat === "audit" && (e.data || {}).action === "dispatch-unknown",
  )
  .forEach((e) => {
    console.log(
      " ts:",
      e.ts,
      "detail:",
      (e.data || {}).detail,
      "target:",
      (e.data || {}).target,
    );
  });

// 3. Merge-unknown
console.log("\n=== MERGE-UNKNOWN ===");
events
  .filter((e) => e.cat === "audit" && (e.data || {}).action === "merge-unknown")
  .forEach((e) => {
    console.log(" ts:", e.ts, "detail:", (e.data || {}).detail);
  });

// 4. Store validations
console.log("\n=== STORE VALIDATIONS ===");
events
  .filter(
    (e) =>
      e.cat === "audit" &&
      String((e.data || {}).action || "").includes("store"),
  )
  .forEach((e) => {
    console.log(
      " ts:",
      e.ts,
      "action:",
      e.data.action,
      "detail:",
      String(e.data.detail || "").slice(0, 100),
    );
  });

// 5. Look at high-churn files in context
console.log("\n=== HIGH-CHURN FILES — patterns ===");
const churnFiles = [
  ".claude/agents/02-oneshot/.system/r",
  "scripts/dispatch/gui.js",
  ".claude/agents/02-oneshot/.system/s",
  "scripts/dispatch.js",
];
churnFiles.forEach((prefix) => {
  const matches = events.filter(
    (e) =>
      e.cat === "tool" &&
      ["Edit", "Write", "MultiEdit"].includes((e.data || {}).tool) &&
      String((e.data || {}).file || "").includes(prefix),
  );
  console.log("\n  Pattern:", prefix, "(", matches.length, "edits)");
  matches.forEach((e) => {
    const f = (e.data || {}).file || "";
    const trail = f
      .split(/[\\\/]/)
      .slice(-3)
      .join("/");
    console.log("    ts:", e.ts, "tool:", e.data.tool, "file:", trail);
  });
});

// 6. Time-spaced clusters of edits to same file (churn indicator)
console.log("\n=== EDIT CLUSTERS (same file edited >2x in 10min) ===");
const allEdits = events.filter(
  (e) =>
    e.cat === "tool" &&
    ["Edit", "Write", "MultiEdit"].includes((e.data || {}).tool),
);
const byFile = {};
allEdits.forEach((e) => {
  const f = (e.data || {}).file || "";
  if (!byFile[f]) byFile[f] = [];
  byFile[f].push(new Date(e.ts).getTime());
});
Object.entries(byFile).forEach(([f, times]) => {
  if (times.length < 3) return;
  times.sort();
  const span = (times[times.length - 1] - times[0]) / 60000;
  if (span < 60) {
    const trail = f
      .split(/[\\\/]/)
      .slice(-3)
      .join("/");
    console.log("  ", times.length + "x in", span.toFixed(1) + "min:", trail);
  }
});

// 7. Bash commands that contain "node -e"
console.log('\n=== "node -e" attempts (likely blocked) ===');
events
  .filter(
    (e) =>
      e.cat === "tool" &&
      (e.data || {}).tool === "Bash" &&
      String((e.data || {}).file || "").includes("node -e"),
  )
  .forEach((e) => {
    console.log(" ts:", e.ts, "cmd:", String(e.data.file).slice(0, 100));
  });

// 8. Look at retro creation skips
console.log("\n=== NO-RETRO-CREATED ===");
events
  .filter(
    (e) => e.cat === "audit" && (e.data || {}).action === "no-retro-created",
  )
  .forEach((e) => {
    console.log(" ts:", e.ts, "detail:", (e.data || {}).detail);
  });

// 9. Spec category events
console.log("\n=== SPEC events ===");
events
  .filter((e) => e.cat === "spec")
  .forEach((e) => {
    console.log(
      " ts:",
      e.ts,
      "action:",
      e.data && e.data.action,
      "detail:",
      String((e.data || {}).detail || "").slice(0, 80),
    );
  });

// 10. Cycle-enforcer
console.log("\n=== CYCLE-ENFORCER ===");
events
  .filter(
    (e) =>
      e.cat === "audit" &&
      String((e.data || {}).action || "").includes("cycle"),
  )
  .forEach((e) => {
    console.log(" ts:", e.ts, "detail:", (e.data || {}).detail);
  });
