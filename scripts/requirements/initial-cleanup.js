/**
 * initial-cleanup.js — Phase 3L §6 one-time initial backlog cleanup.
 *
 * Auto-expire any open entry pre-dating 2026-03-31, except Class C entries
 * (which require human resolution per validation-backlog-policy §3).
 *
 * Idempotent — safe to re-run.
 */

const fs = require("fs");
const { STAGED_FILE } = require("./config");

const CUTOFF = Date.parse("2026-03-31T00:00:00Z");

if (!fs.existsSync(STAGED_FILE)) {
  console.log("No staged file present; nothing to clean up.");
  process.exit(0);
}

const lines = fs.readFileSync(STAGED_FILE, "utf8").split("\n");
let expired = 0;
let preserved = 0;
let alreadyResolved = 0;
const out = [];
for (const raw of lines) {
  if (!raw.trim()) continue;
  let e;
  try {
    e = JSON.parse(raw);
  } catch {
    out.push(raw);
    continue;
  }
  const isOpen = e.status === "open" || e.status === undefined;
  if (!isOpen) {
    alreadyResolved += 1;
    out.push(JSON.stringify(e));
    continue;
  }
  if (e.riskClass === "C") {
    preserved += 1;
    out.push(JSON.stringify(e));
    continue;
  }
  const at = e.stagedAt
    ? Date.parse(e.stagedAt)
    : e.ts
      ? Date.parse(e.ts)
      : NaN;
  if (Number.isNaN(at) || at >= CUTOFF) {
    out.push(JSON.stringify(e));
    continue;
  }
  e.status = "expired";
  e.resolution = {
    at: new Date().toISOString(),
    by: "phase-3l-initial-cleanup",
    notes:
      "Pre-2026-03-31 entry auto-expired per validation-backlog-policy §6.",
  };
  expired += 1;
  out.push(JSON.stringify(e));
}
fs.writeFileSync(STAGED_FILE, out.join("\n") + "\n");
console.log(
  `initial-cleanup: expired=${expired} preservedClassC=${preserved} alreadyResolved=${alreadyResolved}`,
);
