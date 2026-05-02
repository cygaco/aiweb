#!/usr/bin/env node
// Build inlined fixer prompt for a feature
// Usage: node scripts/delta-build-fixer-prompt.js <feature> <fix-brief-file> <output-file>
const fs = require("fs");
const path = require("path");

const PROJ = path.join(__dirname, "..");
const feature = process.argv[2];
const fixBriefFile = process.argv[3];
const outputFile = process.argv[4];

if (!feature || !fixBriefFile || !outputFile) {
  console.error(
    "Usage: node delta-build-fixer-prompt.js <feature> <fix-brief-file> <output-file>",
  );
  process.exit(1);
}

const store = JSON.parse(
  fs.readFileSync(
    path.join(PROJ, ".claude/agents/02-oneshot/.system/store.json"),
    "utf8",
  ),
);

const featureData = store.features[feature];
if (!featureData) {
  console.error(`Feature not found in store: ${feature}`);
  process.exit(1);
}

function readFile(relPath) {
  try {
    return fs.readFileSync(path.join(PROJ, relPath), "utf8");
  } catch (e) {
    return `[FILE NOT FOUND: ${relPath}]`;
  }
}

const fixBrief = fs.readFileSync(fixBriefFile, "utf8");
const files = featureData.files || [];

let prompt = fixBrief + "\n\n---\n\n## Current File Contents\n\n";
for (const f of files) {
  prompt += `--- BEGIN file: ${f} ---\n`;
  prompt += readFile(f);
  prompt += `\n--- END file ---\n\n`;
}

// Add types.ts for context (read-only)
prompt += `--- BEGIN file: src/lib/types.ts (READ-ONLY) ---\n`;
prompt += readFile("src/lib/types.ts");
prompt += `\n--- END file ---\n\n`;

// Add api.ts for POLL_INTERVAL_MS context (read-only)
prompt += `--- BEGIN file: src/lib/api.ts (READ-ONLY) ---\n`;
prompt += readFile("src/lib/api.ts");
prompt += `\n--- END file ---\n`;

fs.writeFileSync(outputFile, prompt, "utf8");
console.log(`Fixer prompt written to ${outputFile} (${prompt.length} chars)`);
