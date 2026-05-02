#!/usr/bin/env node
// One-off: /learn:integrate Phase C+D — mark 3 already-realized learnings as implemented.
// Self-contained because merge-guard blocks node -e (RI-004).
const fs = require("fs");
const { PATHS } = require("./hooks/lib/paths");
const { log } = require("./hooks/lib/logger");

const ts = new Date().toISOString();

// Each attestation: predicate to find the line, plus implemented_by + commit ref.
const attestations = [
  {
    name: "mode-aware hooks single SoT",
    match: (e) =>
      typeof e.tip === "string" &&
      e.tip.includes(
        "Mode-of-operation hooks that fire on all prompts must resolve mode from a single source",
      ),
    implemented_by: "hook:team-guard",
    commit: "4456ff1",
  },
  {
    name: "team-guard silent-fail (I/O outside try)",
    match: (e) =>
      e.id === "LN-team-guard-silent-fail" ||
      (typeof e.tip === "string" &&
        e.tip.includes(
          "Never place debug-logging I/O inside the same try-block as the core guard decision",
        )),
    implemented_by: "hook:team-guard",
    commit: "56a937c",
  },
  {
    name: "redteam SECURITY vs QUALITY taxonomy",
    match: (e) =>
      typeof e.tip === "string" && e.tip.includes("Redteam scope taxonomy"),
    implemented_by: "skill:redteam:full+redteam:scan",
    commit: "split lives in skills, not commit-pinned",
  },
];

const lines = fs.readFileSync(PATHS.learningsFile, "utf8").split("\n");
let updates = 0;
const integrationEvents = [];

for (let i = 0; i < lines.length; i++) {
  const raw = lines[i];
  if (!raw) continue;
  let entry;
  try {
    entry = JSON.parse(raw);
  } catch {
    continue;
  }
  for (const att of attestations) {
    if (att.match(entry)) {
      // Already implemented — skip
      if (entry.status === "implemented" && entry.implemented_by) continue;
      entry.status = "implemented";
      entry.implemented_by = att.implemented_by;
      entry.implemented_at = ts;
      entry.attested_via_commit = att.commit;
      const newScore = Math.min(1.0, (entry.score || 0.7) + 0.1);
      entry.score = Number(newScore.toFixed(2));
      lines[i] = JSON.stringify(entry);
      updates++;
      integrationEvents.push({
        target: att.implemented_by,
        learning_id: entry.id || `line${i + 1}`,
        learning_tip: (entry.tip || "").slice(0, 100),
      });
      break;
    }
  }
}

fs.writeFileSync(PATHS.learningsFile, lines.join("\n"));

for (const ev of integrationEvents) {
  log("integration", { source: "learn:integrate", ...ev });
}

console.log(`Attested ${updates} learnings as implemented.`);
integrationEvents.forEach((ev) => {
  console.log(`  → ${ev.learning_id}: ${ev.target}`);
});
