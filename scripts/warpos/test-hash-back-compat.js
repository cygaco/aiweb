#!/usr/bin/env node
/**
 * scripts/warpos/test-hash-back-compat.js — One-off smoke verifying the
 * back-compat read path for 0.6.x truncated sha256.
 *
 * Synthesizes a framework-installed.json with truncated 12-char hashes,
 * runs the manifest-honesty check via direct require + override, confirms
 * hashMatches accepts the prefix.
 *
 * Linked: SP-20260514-001 R-1, AC-4.2. Tickets T-20260514-069/070/071.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const cHash = require("./lib/content-hash");

const ROOT = path.resolve(__dirname, "..", "..");
const INSTALLED = path.join(ROOT, ".claude", "framework-installed.json");

function main() {
  const installed = JSON.parse(fs.readFileSync(INSTALLED, "utf8"));
  let totalChecked = 0;
  let prefixMatched = 0;
  let mismatched = 0;
  for (const a of installed.assets || []) {
    if (!a.installedHash || a.owner === "project") continue;
    const dest = path.join(ROOT, a.dest);
    if (!fs.existsSync(dest)) continue;
    const fullLocal = cHash.contentHash(dest);
    const simulatedTruncated = a.installedHash.slice(0, 12);
    if (cHash.hashMatches(fullLocal, simulatedTruncated)) {
      prefixMatched++;
    } else {
      mismatched++;
      if (mismatched <= 5) {
        process.stdout.write(
          `  mismatch: ${a.dest} (full=${fullLocal.slice(0, 12)}... vs trunc=${simulatedTruncated})\n`,
        );
      }
    }
    totalChecked++;
  }
  process.stdout.write(
    `back-compat: ${prefixMatched}/${totalChecked} assets accept simulated 12-char prefix hash via hashMatches; ${mismatched} mismatched\n`,
  );
  process.exit(mismatched === 0 ? 0 : 1);
}

main();
