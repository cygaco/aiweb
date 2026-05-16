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
// SP-20260514-001 R-1 — single content-hash surface (handles LF/CRLF and
// prefix-tolerance). T-20260514-068 owns the module.
const cHash = require("../warpos/lib/content-hash");

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
    // contentHash returns LF-normalized sha256 for text assets and raw
    // sha256 for binary, based on the destination extension. rawHash gives
    // us the byte-equality variant for the raw fallback path. hashMatches
    // is prefix-tolerant (handles 0.6.x 12-char truncated installedHash
    // during the un-truncation transition).
    const localContent = cHash.contentHash(dest);
    if (!cHash.hashMatches(localContent, a.installedHash)) {
      const localRaw = cHash.rawHash(dest);
      if (!cHash.hashMatches(localRaw, a.installedHash)) {
        issues.push({
          kind: "drift",
          file: a.dest,
          expected: a.installedHash,
          actual: localContent,
        });
      }
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
