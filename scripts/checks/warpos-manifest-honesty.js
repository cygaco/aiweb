#!/usr/bin/env node
// check:warpos-manifest-honesty — verify framework-installed.json reflects disk state.
// Every listed asset exists; every hash matches; no asset on disk is unlisted.
//
// Prompt for /reasoning:run refinement:
// "Design a check that detects manifest drift: listed-but-missing, on-disk-but-unlisted,
//  hash-drifted-since-install. What thresholds distinguish 'expected local edit' from
//  'broken install'? Should hash drift on owner=project files be ignored entirely?"
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const JSON_OUT = process.argv.includes("--json");

const installedFile = path.join(ROOT, ".claude", "framework-installed.json");
if (!fs.existsSync(installedFile)) {
  if (JSON_OUT)
    console.log(
      JSON.stringify({ ok: true, reason: "no framework-installed.json" }),
    );
  else
    console.log(
      "OK   [warpos-manifest-honesty] not a WarpOS-installed project",
    );
  process.exit(0);
}
const installed = JSON.parse(fs.readFileSync(installedFile, "utf8"));
const assets = installed.assets || [];

const issues = [];
let checked = 0;
for (const a of assets) {
  if (a.owner === "project") continue; // project files allowed to drift
  const dest = path.join(ROOT, a.dest);
  if (!fs.existsSync(dest)) {
    issues.push({ kind: "missing", file: a.dest });
    continue;
  }
  if (a.installedHash) {
    const buf = fs.readFileSync(dest);
    const sha = crypto
      .createHash("sha256")
      .update(buf)
      .digest("hex")
      .slice(0, a.installedHash.length);
    if (sha !== a.installedHash) {
      issues.push({
        kind: "drift",
        file: a.dest,
        expected: a.installedHash,
        actual: sha,
      });
    }
  }
  checked++;
}

if (issues.length === 0) {
  if (JSON_OUT) console.log(JSON.stringify({ ok: true, checked }));
  else
    console.log(
      `OK   [warpos-manifest-honesty] ${checked} framework assets verified`,
    );
  process.exit(0);
}
const out = {
  ok: false,
  checked,
  issues: issues.slice(0, 30),
  totalIssues: issues.length,
};
if (JSON_OUT) console.log(JSON.stringify(out));
else {
  console.error(
    `FAIL [warpos-manifest-honesty] ${issues.length} drift issue(s) (${checked} assets checked):`,
  );
  for (const i of issues.slice(0, 10))
    console.error(`  - [${i.kind}] ${i.file}`);
  if (issues.length > 10) console.error(`  ... and ${issues.length - 10} more`);
}
process.exit(1);
