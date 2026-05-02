// Sleep cycle 2026-04-22 — Phase 1 NREM consolidation
// - Add importance field where inferable
// - Prune score=0 + logged + unvalidated entries older than 14 days that were never implemented
// - Dedup (no exact-prefix dups found; skip merge pass)
// - Target 30-50; floor at ~90 this round (don't wholesale slash)

const fs = require("fs");
const path = require("path");
const { PATHS } = require("./hooks/lib/paths.js");

const raw = fs.readFileSync(PATHS.learningsFile, "utf8");
const lines = raw.split("\n").filter(Boolean);
const entries = lines.map((l) => JSON.parse(l));
const today = new Date("2026-04-22");
const daysAgo = (ts) => {
  try {
    return Math.floor((today - new Date(ts)) / 86400000);
  } catch {
    return null;
  }
};

// Infer importance for entries missing it
function inferImportance(l) {
  if (l.importance) return l.importance;
  if (l.fix_quality === 4 || l.fix_quality === 3) return "high";
  if (l.score >= 0.9) return "high";
  if (l.score >= 0.7) return "medium";
  if (l.score >= 0.5) return "medium";
  if (l.score === 0 || l.score === null) return "low";
  return "low";
}

let added = 0;
for (const l of entries) {
  if (!l.importance) {
    l.importance = inferImportance(l);
    added++;
  }
}

// Prune decision: keep anything validated/implemented/recent/high-score
function shouldKeep(l) {
  const age = daysAgo(l.ts);
  if (l.status === "implemented" || l.status === "validated") return true;
  if (l.effective === true) return true;
  if (l.fix_quality >= 3) return true;
  if (l.score >= 0.85) return true;
  if (l.pending_validation === true && age !== null && age <= 14) return true;
  if (age !== null && age <= 7) return true; // keep very recent regardless
  // Decay: score=0 or null, status=logged, older than 14 days, never implemented
  if (
    (l.score === 0 || l.score === null) &&
    (l.status === "logged" || !l.status) &&
    !l.implemented_by &&
    age > 14
  )
    return false;
  // score<0.5 older than 21d with no implementation
  if (
    l.score !== undefined &&
    l.score !== null &&
    l.score < 0.5 &&
    age > 21 &&
    !l.implemented_by
  )
    return false;
  return true;
}

const kept = [];
const pruned = [];
for (const l of entries) {
  if (shouldKeep(l)) kept.push(l);
  else pruned.push(l);
}

console.log("Total in:", entries.length);
console.log("Importance added:", added);
console.log("Kept:", kept.length, "Pruned:", pruned.length);
console.log("\nSample pruned (first 10):");
pruned
  .slice(0, 10)
  .forEach((l) => console.log(" -", l.ts, "|", (l.tip || "").slice(0, 80)));

// Further: if still over 90, prune lowest-score entries older than 14d
let final = kept;
if (final.length > 90) {
  const prunable = final.filter((l) => {
    const age = daysAgo(l.ts);
    return (
      age > 14 &&
      (l.score === 0 || !l.implemented_by) &&
      l.status !== "implemented" &&
      l.status !== "validated" &&
      l.effective !== true &&
      (l.fix_quality == null || l.fix_quality < 3)
    );
  });
  prunable.sort((a, b) => (a.score || 0) - (b.score || 0));
  const overage = final.length - 90;
  const toRemove = new Set(
    prunable
      .slice(0, overage)
      .map((l) => (l._key = l.id || l.ts + "|" + (l.tip || "").slice(0, 40))),
  );
  final = final.filter((l) => {
    const k = l.id || l.ts + "|" + (l.tip || "").slice(0, 40);
    return !toRemove.has(k);
  });
  console.log(
    "\nSecond-pass prune (to ~90): removed",
    entries.length -
      kept.length +
      (kept.length - final.length) -
      (entries.length - kept.length),
    "more, final:",
    final.length,
  );
}

// Write
const out = final.map((l) => JSON.stringify(l)).join("\n") + "\n";
const backup = PATHS.learningsFile + ".pre-sleep-20260422";
fs.writeFileSync(backup, raw);
fs.writeFileSync(PATHS.learningsFile, out);
console.log("\nBackup:", backup);
console.log("Wrote", final.length, "entries to learnings.jsonl");

// Emit summary for the journal
console.log("\n--- SUMMARY ---");
console.log("before:", entries.length);
console.log("after:", final.length);
console.log("pruned:", entries.length - final.length);
console.log("importance-added:", added);
