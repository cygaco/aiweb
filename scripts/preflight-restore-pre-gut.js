#!/usr/bin/env node
/**
 * preflight-restore-pre-gut.js
 *
 * For each non-foundation feature file currently in store, restore the
 * pre-gut version from skeleton-test10 (last working branch) IF it exists
 * there. Files not in skeleton-test10 (e.g. newly-synced monorepo paths)
 * are skipped — they keep their reconcile-stubs.
 *
 * After this, re-running the gut script processes ORIGINAL content with the
 * improved type-preservation logic.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const STORE = path.join(ROOT, ".claude/agents/02-oneshot/.system/store.json");
const SOURCE_BRANCH = "skeleton-test10";

const store = JSON.parse(fs.readFileSync(STORE, "utf8"));

const restored = [];
const notInSource = [];
const failed = [];

for (const [feat, fdef] of Object.entries(store.features)) {
  if (feat.startsWith("foundation-")) continue;
  for (const rel of fdef.files || []) {
    if (rel.endsWith("/")) continue;
    if (/[*?]/.test(rel)) continue;
    try {
      const content = execSync(`git show ${SOURCE_BRANCH}:"${rel}"`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      const abs = path.join(ROOT, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
      restored.push(rel);
    } catch (e) {
      const msg = String(e.message || e);
      if (
        msg.includes("does not exist") ||
        msg.includes("exists on disk, but not in")
      ) {
        notInSource.push(rel);
      } else {
        failed.push({ rel, err: msg.split("\n")[0] });
      }
    }
  }
}

console.log(
  JSON.stringify(
    {
      restoredCount: restored.length,
      notInSourceCount: notInSource.length,
      failedCount: failed.length,
      restored,
      notInSource,
      failed,
    },
    null,
    2,
  ),
);
