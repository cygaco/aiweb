#!/usr/bin/env node
// Read-only scan of learnings.jsonl to find /learn:integrate candidates.
// Filter: score >= 0.7 AND status != "implemented" AND status != "logged"
// AND no implemented_by field.

const fs = require("fs");
const path = require("path");

const file = path.join(
  __dirname,
  "..",
  ".claude",
  "project",
  "memory",
  "learnings.jsonl",
);
const lines = fs.readFileSync(file, "utf8").trim().split("\n");

console.log("total entries:", lines.length);

const candidates = [];
const sessionImplemented = []; // already-fixed-this-session candidates worth attesting

lines.forEach((line, i) => {
  try {
    const e = JSON.parse(line);
    const idx = i + 1;
    const isImplemented = e.status === "implemented" || e.implemented_by;
    const score = typeof e.score === "number" ? e.score : 0;

    if (score >= 0.7 && !isImplemented && e.status !== "logged") {
      candidates.push({
        idx,
        score,
        status: e.status,
        intent: e.intent,
        tip: (e.tip || "").slice(0, 110),
      });
    }

    // Also surface session learnings that describe work already shipped this
    // session — these warrant attestation (mark implemented + implemented_by)
    // even though they have score:0/status:logged today.
    if (
      e.source === "learn:deep:conversation" &&
      e.ts === "2026-04-29" &&
      typeof e.tip === "string" &&
      (/drift detector|context-sources|spec/i.test(e.tip) ||
        /merge-guard|per-segment|git\s+rm/i.test(e.tip) ||
        /validateOrigin|requireOrigin/i.test(e.tip) ||
        /event-contract|addEventListener|dispatchEvent/i.test(e.tip) ||
        /Refactor.*Rename Hygiene|grep.*before/i.test(e.tip) ||
        /one-shot.*migration script|prettier.*hook race/i.test(e.tip))
    ) {
      sessionImplemented.push({
        idx,
        intent: e.intent,
        tip: (e.tip || "").slice(0, 110),
      });
    }
  } catch {
    /* skip */
  }
});

console.log(
  "\n--- HIGH-SCORE NON-IMPLEMENTED CANDIDATES ---",
  candidates.length,
);
candidates
  .slice(0, 40)
  .forEach((c) =>
    console.log(
      `  #${c.idx} [${c.intent}] s=${c.score} ${c.status || "?"} | ${c.tip}`,
    ),
  );

console.log(
  "\n--- SESSION LEARNINGS WITH IN-SESSION ATTESTATION ---",
  sessionImplemented.length,
);
sessionImplemented.forEach((c) =>
  console.log(`  #${c.idx} [${c.intent}] | ${c.tip}`),
);
