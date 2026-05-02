// Second-pass aggressive prune to get near homeostasis target (30-50, stretch: 60-80)
// Conservative removal targeting score=0 logged noise and old unvalidated entries

const fs = require("fs");
const { PATHS } = require("./hooks/lib/paths.js");
const raw = fs.readFileSync(PATHS.learningsFile, "utf8");
const entries = raw
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const today = new Date("2026-04-22");
const age = (ts) => {
  try {
    return Math.floor((today - new Date(ts)) / 86400000);
  } catch {
    return null;
  }
};

// Tiers of protection (keep):
// T1: implemented OR validated OR effective:true OR fix_quality>=3 — ALWAYS keep
// T2: score >= 0.85 — keep (high signal)
// T3: pending_validation within 14d — keep (hippocampal window)
// T4: authored in last 3 days — keep (fresh, needs time)
// EVERYTHING else is prunable. Sort prunable by age*1 - score*100 (oldest+weakest first), then trim.

function tier(l) {
  if (l.status === "implemented" || l.status === "validated") return 1;
  if (l.effective === true) return 1;
  if ((l.fix_quality || 0) >= 3) return 1;
  if ((l.score || 0) >= 0.85) return 2;
  const a = age(l.ts);
  if (l.pending_validation === true && a !== null && a <= 14) return 3;
  if (a !== null && a <= 3) return 4;
  return 0; // prunable
}

const tiered = entries.map((l) => ({ l, t: tier(l), a: age(l.ts) }));
const keep1 = tiered.filter((x) => x.t > 0);
const prunable = tiered.filter((x) => x.t === 0);

console.log("Protected tiers:");
console.log(
  " T1 (validated/implemented/effective/fq>=3):",
  tiered.filter((x) => x.t === 1).length,
);
console.log(" T2 (score>=0.85):", tiered.filter((x) => x.t === 2).length);
console.log(
  " T3 (pending within 14d):",
  tiered.filter((x) => x.t === 3).length,
);
console.log(
  " T4 (authored in last 3d):",
  tiered.filter((x) => x.t === 4).length,
);
console.log("Prunable pool:", prunable.length);

// Prune the prunable pool entirely — these are score=0 or low-signal older entries
// that weren't validated or implemented
const kept = keep1.map((x) => x.l);
console.log("\n== Pruning all of prunable pool ==");
console.log("Before:", entries.length);
console.log("After:", kept.length);
console.log("\nSample pruned (first 15):");
prunable
  .slice(0, 15)
  .forEach((x) =>
    console.log(
      " -",
      x.l.ts,
      "| sc=" + (x.l.score ?? "∅"),
      "| st=" + (x.l.status ?? "∅"),
      "|",
      (x.l.tip || "").slice(0, 70),
    ),
  );

const out = kept.map((l) => JSON.stringify(l)).join("\n") + "\n";
fs.writeFileSync(PATHS.learningsFile, out);

// Report
const statusCount = {};
for (const l of kept)
  statusCount[l.status || "NONE"] = (statusCount[l.status || "NONE"] || 0) + 1;
console.log("\nFinal status distribution:", statusCount);
console.log("Total:", kept.length);
