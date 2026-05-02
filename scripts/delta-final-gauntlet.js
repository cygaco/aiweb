#!/usr/bin/env node
/**
 * delta-final-gauntlet.js — fire all 14 features × 4 reviewers in parallel.
 *
 * Each dispatch is a background subprocess. This script writes a launch
 * matrix, fires them all, and exits. The orchestrator (Delta) checks
 * .claude/runtime/.final-gauntlet-progress.json periodically.
 *
 * Usage: node scripts/delta-final-gauntlet.js
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

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

const ROOT = path.resolve(__dirname, "..");
const REV_DIR = path.join(ROOT, ".claude", "runtime", "dispatch", "reviewers");

const launched = [];
const skipped = [];

for (const feat of FEATURES) {
  for (const role of ROLES) {
    const promptFile = path.join(REV_DIR, `${feat}-${role}-prompt.txt`);
    const outputFile = path.join(REV_DIR, `${feat}-${role}-output.json`);
    if (!fs.existsSync(promptFile)) {
      skipped.push(`${feat}/${role}: no prompt`);
      continue;
    }

    const env = { ...process.env };
    if (role !== "redteam") env.OPENAI_FLAGSHIP_MODEL = "gpt-5.4";

    // spawn detached so the parent (this script) can exit immediately.
    // stdio piped to outputFile; the launched node process will keep running.
    const out = fs.openSync(outputFile, "w");
    const child = spawn(
      "node",
      [path.join(ROOT, "scripts", "dispatch-agent.js"), role, promptFile],
      {
        env,
        cwd: ROOT,
        detached: true,
        stdio: ["ignore", out, out],
      },
    );
    child.unref();
    launched.push({ feature: feat, role, pid: child.pid });
  }
}

const progress = {
  startedAt: new Date().toISOString(),
  totalDispatches: launched.length,
  launched,
  skipped,
};
fs.writeFileSync(
  path.join(ROOT, ".claude", "runtime", ".final-gauntlet-progress.json"),
  JSON.stringify(progress, null, 2),
);

console.log(`launched=${launched.length} skipped=${skipped.length}`);
if (skipped.length) {
  console.log("skipped:", skipped.join(", "));
}
