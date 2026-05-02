#!/usr/bin/env node
// One-shot verifier for the drift-detector fix in
// scripts/hooks/lib/context-sources.js. Confirms that the features
// flagged by BACKLOG.md (skills-curation, auto-apply) DO have PRD.md on
// disk, so the new featureHasSpec() filesystem check correctly
// distinguishes them from genuinely spec-less components.

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const specsDir = path.join(root, "docs", "05-features");
const features = [
  "skills-curation",
  "auto-apply",
  "onboarding",
  "market-research",
  "extension",
];

console.log("specs dir:", specsDir);
for (const f of features) {
  const prd = path.join(specsDir, f, "PRD.md");
  console.log(`  ${f} PRD.md →`, fs.existsSync(prd) ? "EXISTS" : "MISSING");
}
