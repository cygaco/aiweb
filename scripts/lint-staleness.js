#!/usr/bin/env node

/**
 * lint-staleness.js
 * Scans all .md files under docs/ for <!-- STALE: --> markers.
 * Reports as errors — stale files should be reviewed before builds.
 * Integrated into `npm run lint:docs`.
 */

const fs = require("fs");
const path = require("path");
const { PROJECT, PATHS } = require("./hooks/lib/paths");

const DOCS_DIR = path.join(PROJECT, "docs");
const REQUIREMENTS_DIR = PATHS.requirementsRoot || path.join(PROJECT, "requirements");
const STALE_RE = /<!-- STALE: (.+?) changed at (.+?) — review needed -->/g;

let totalStale = 0;
const findings = [];

function scanDir(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip hidden dirs and node_modules
      if (entry.name.startsWith(".")) continue;
      scanDir(full);
    } else if (entry.name.endsWith(".md")) {
      checkFile(full);
    }
  }
}

function checkFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  let match;
  STALE_RE.lastIndex = 0;
  while ((match = STALE_RE.exec(content)) !== null) {
    totalStale++;
    const rel = path.relative(PROJECT, filePath).replace(/\\/g, "/");
    findings.push({
      file: rel,
      source: match[1],
      timestamp: match[2],
    });
  }
}

// Main
scanDir(DOCS_DIR);
scanDir(REQUIREMENTS_DIR);

if (findings.length === 0) {
  console.log("lint-staleness: ✓ No stale files found");
  process.exit(0);
} else {
  console.error(`lint-staleness: ✗ ${totalStale} STALE marker(s) found:\n`);
  for (const f of findings) {
    console.error(`  ERROR  ${f.file}`);
    console.error(
      `         ← upstream: ${f.source} (changed ${f.timestamp})\n`,
    );
  }
  console.error(
    "Fix: Review each file, update if needed, then remove the <!-- STALE: --> comment.\n",
  );
  process.exit(1);
}
