// One-off sleep-cycle analysis helper (Phase 1 NREM)
const fs = require("fs");
const path = require("path");
const { PATHS } = require("./hooks/lib/paths.js");

const learnings = fs
  .readFileSync(PATHS.learningsFile, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l, i) => {
    try {
      return { ...JSON.parse(l), _lineno: i + 1 };
    } catch (e) {
      return { _parse_error: e.message, _raw: l, _lineno: i + 1 };
    }
  });

const total = learnings.length;
const parseErr = learnings.filter((l) => l._parse_error).length;
const byStatus = {};
const byIntent = {};
const byImportance = {};
const byScore = { zero: 0, lowHalf: 0, mid: 0, high: 0 };
const pendingValidation = [];
const effectiveNull = [];
const noImportance = [];
const ts2021 = [];
const ts2022 = [];
const byTs = {};

for (const l of learnings) {
  if (l._parse_error) continue;
  byStatus[l.status || "NONE"] = (byStatus[l.status || "NONE"] || 0) + 1;
  byIntent[l.intent || "NONE"] = (byIntent[l.intent || "NONE"] || 0) + 1;
  byImportance[l.importance || "NONE"] =
    (byImportance[l.importance || "NONE"] || 0) + 1;
  const s = typeof l.score === "number" ? l.score : null;
  if (s === 0) byScore.zero++;
  else if (s !== null && s < 0.5) byScore.lowHalf++;
  else if (s !== null && s < 0.85) byScore.mid++;
  else if (s !== null && s >= 0.85) byScore.high++;
  if (l.pending_validation === true) pendingValidation.push(l);
  if (l.effective === null && l.pending_validation !== true)
    effectiveNull.push(l);
  if (!l.importance) noImportance.push(l);
  const ts = (l.ts || "").slice(0, 10);
  byTs[ts] = (byTs[ts] || 0) + 1;
}

const recentTs = Object.entries(byTs)
  .sort((a, b) => b[0].localeCompare(a[0]))
  .slice(0, 10);

console.log("== Learnings audit ==");
console.log("Total:", total, "| Parse errors:", parseErr);
console.log("By status:", byStatus);
console.log("By intent:", byIntent);
console.log("By importance:", byImportance);
console.log("By score buckets:", byScore);
console.log("Pending validation:", pendingValidation.length);
console.log("Effective=null (not validated):", effectiveNull.length);
console.log("No importance field:", noImportance.length);
console.log("Recent 10 ts buckets:", recentTs);

// Candidates for decay: score=0, status=logged, no validation
const decayCandidates = learnings.filter(
  (l) =>
    !l._parse_error &&
    (l.score === 0 || l.score === null) &&
    (l.status === "logged" || l.status === "pending") &&
    l.effective !== true &&
    !l.implemented_by,
);
console.log("\n== Decay candidates (score=0 + logged + not validated) ==");
console.log("Count:", decayCandidates.length);

// Pending older than 21 days from today (2026-04-22)
const today = new Date("2026-04-22");
const age = (ts) => {
  try {
    return Math.floor((today - new Date(ts)) / 86400000);
  } catch {
    return null;
  }
};
const oldPending = pendingValidation.filter((l) => {
  const a = age(l.ts);
  return a !== null && a > 21;
});
console.log("Pending >21 days old:", oldPending.length);
const oldPending14 = pendingValidation.filter((l) => {
  const a = age(l.ts);
  return a !== null && a > 14;
});
console.log("Pending >14 days old (decay window):", oldPending14.length);

// Quick sample of decay candidates from old dates
const pre2026_04_10 = decayCandidates.filter(
  (l) => l.ts && l.ts < "2026-04-10",
);
console.log("\n== Decay candidates older than 2026-04-10 ==");
console.log("Count:", pre2026_04_10.length);
console.log("Sample (first 5):");
pre2026_04_10
  .slice(0, 5)
  .forEach((l) => console.log(" -", l.ts, "|", (l.tip || "").slice(0, 90)));

// Dup detection — by tip-prefix (first 60 chars)
const tipBuckets = {};
for (const l of learnings) {
  if (l._parse_error || !l.tip) continue;
  const key = l.tip.slice(0, 60).toLowerCase();
  tipBuckets[key] = (tipBuckets[key] || 0) + 1;
}
const dups = Object.entries(tipBuckets).filter(([k, v]) => v > 1);
console.log("\n== Tip-prefix duplicates (first 60 chars match) ==");
console.log("Groups:", dups.length);
dups.slice(0, 5).forEach(([k, v]) => console.log(" -", v + "x |", k));
