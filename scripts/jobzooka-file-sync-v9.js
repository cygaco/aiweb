#!/usr/bin/env node
/**
 * jobzooka-file-sync-v9.js — Project-specific one-off patch (Phase 4.2 split).
 *
 * The generic version of this logic now lives at
 * `scripts/oneshot-store-file-sync.js` and derives every file scope from
 * each feature's PRD Section 13. This file holds the jobzooka-only patches
 * that were hardcoded into the previous v9 of oneshot-store-file-sync.js
 * before it was genericized for WarpOS canonical:
 *
 *   1. store.features.auth.files += "src/app/api/auth/reset/route.ts"
 *      (run-09 retro item I8 — the file existed but wasn't in auth's scope)
 *   2. manifest.fileOwnership.foundation += "src/lib/rockets.ts"
 *      (run-09 retro item I7 — orphan library used by rockets feature but
 *      not in foundation)
 *
 * Both items are idempotent. After this commit lands, the generic script
 * will pick up #1 automatically (auth's PRD §13 lists the file). #2 is a
 * manifest concern, not a store concern, and stays here.
 *
 * Usage:
 *   node scripts/jobzooka-file-sync-v9.js
 */

const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(projectRoot, ".claude", "manifest.json");

const manifestText = fs.readFileSync(manifestPath, "utf8");
const needs = "src/lib/rockets.ts";

if (manifestText.includes(`"${needs}"`)) {
  console.log("[manifest] already synced — " + needs + " is in foundation");
  process.exit(0);
}

const anchor = `      "src/lib/prompts.ts",\n`;
if (manifestText.includes(anchor)) {
  const updated = manifestText.replace(
    anchor,
    `      "src/lib/prompts.ts",\n      "${needs}",\n`,
  );
  fs.writeFileSync(manifestPath, updated);
  console.log(`[manifest] fileOwnership.foundation += ${needs}`);
} else {
  console.error(
    `[manifest] anchor "src/lib/prompts.ts" not found — manifest untouched`,
  );
  process.exit(1);
}
