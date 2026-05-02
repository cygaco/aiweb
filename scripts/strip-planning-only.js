#!/usr/bin/env node
/**
 * strip-planning-only.js
 *
 * Strips `[planning-only]` sections (8 & 9) from all PRD.md files.
 * Removes everything from "## 8." through the line before "## 10."
 *
 * Usage: node scripts/strip-planning-only.js [--dry-run]
 */

const fs = require("fs");
const path = require("path");

const dryRun = process.argv.includes("--dry-run");
const featuresDir = path.join(__dirname, "..", "docs", "05-features");

const prdFiles = fs
  .readdirSync(featuresDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => path.join(d.name, "PRD.md"))
  .filter((p) => fs.existsSync(path.join(featuresDir, p)));

let modified = 0;

for (const relPath of prdFiles) {
  const fullPath = path.join(featuresDir, relPath);
  const content = fs.readFileSync(fullPath, "utf-8");

  // Match from "## 8." up to (but not including) "## 10."
  const stripped = content.replace(
    /## 8\..*?\[planning-only\][\s\S]*?(?=## 10\.)/,
    "",
  );

  if (stripped !== content) {
    if (dryRun) {
      console.log(`[dry-run] Would strip sections 8-9 from: ${relPath}`);
    } else {
      fs.writeFileSync(fullPath, stripped, "utf-8");
      console.log(`Stripped sections 8-9 from: ${relPath}`);
    }
    modified++;
  } else {
    console.log(`No [planning-only] sections found in: ${relPath}`);
  }
}

console.log(
  `\n${dryRun ? "Would modify" : "Modified"}: ${modified}/${prdFiles.length} PRDs`,
);
