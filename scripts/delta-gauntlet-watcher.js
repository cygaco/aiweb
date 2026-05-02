#!/usr/bin/env node
/**
 * delta-gauntlet-watcher.js — poll for all 60 reviewer outputs to be > 0 bytes.
 * Exits when all done OR after MAX_WAIT_MIN.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const REV_DIR = path.join(ROOT, ".claude", "runtime", "dispatch", "reviewers");

const FEATURES = [
  "auth",
  "rockets",
  "extension",
  "deus-mechanicus",
  "shell",
  "profile",
  "backend",
  "onboarding",
  "market-research",
  "deep-dive-qa",
  "skills-curation",
  "competitiveness",
  "resume-generation",
  "linkedin",
  "auto-apply",
];
const ROLES = ["reviewer", "compliance", "qa", "redteam"];

const expected = [];
for (const f of FEATURES) for (const r of ROLES) expected.push(`${f}-${r}`);

const MAX_WAIT_MIN = 30;
const POLL_SEC = 30;
const startMs = Date.now();

function check() {
  let done = 0;
  let pending = [];
  for (const key of expected) {
    const file = path.join(REV_DIR, `${key}-output.json`);
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {}
    if (size > 100) done++;
    else pending.push(key);
  }
  return { done, total: expected.length, pending };
}

(function loop() {
  const { done, total, pending } = check();
  const elapsedMin = (Date.now() - startMs) / 60000;
  console.log(
    `[${new Date().toISOString()}] done=${done}/${total} elapsed=${elapsedMin.toFixed(1)}min pending=${pending.length}`,
  );
  if (done >= total) {
    console.log("ALL DONE");
    process.exit(0);
  }
  if (elapsedMin >= MAX_WAIT_MIN) {
    console.log(
      `TIMEOUT after ${MAX_WAIT_MIN}min. Pending:`,
      pending.join(", "),
    );
    process.exit(2);
  }
  setTimeout(loop, POLL_SEC * 1000);
})();
