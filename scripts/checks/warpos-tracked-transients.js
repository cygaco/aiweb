#!/usr/bin/env node
// check:warpos-tracked-transients — accidentally-tracked transient state.
// Catches the regression that opened the 2026-05-03 cleanup.
// Exit 0 = green; 1 = tracked transients found.
const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const JSON_OUT = process.argv.includes("--json");

const FORBIDDEN = [
  {
    glob: ".warpos/",
    reason: "per-install transactional audit log; never ship",
  },
  {
    glob: "qa-*.png",
    reason: "QA screenshot; should live under runtime/qa-*/",
  },
  { glob: "runtime/qa-", reason: "QA output dir; gitignored" },
  { glob: "runtime/research/", reason: "research artifacts; gitignored" },
  { glob: "runtime/logs/", reason: "runtime logs; gitignored" },
];

const result = spawnSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" });
if (result.status !== 0) {
  if (JSON_OUT)
    console.log(
      JSON.stringify({ ok: true, reason: "not a git repo or git unavailable" }),
    );
  else console.log("OK   [warpos-tracked-transients] not a git repo");
  process.exit(0);
}
const tracked = result.stdout
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

const violations = [];
for (const file of tracked) {
  for (const { glob, reason } of FORBIDDEN) {
    if (
      file.startsWith(glob) ||
      (glob.includes("*") &&
        new RegExp("^" + glob.replace(/\*/g, ".*") + "$").test(
          path.basename(file),
        ))
    ) {
      violations.push({ file, reason });
    }
  }
}

if (violations.length === 0) {
  if (JSON_OUT) console.log(JSON.stringify({ ok: true, count: 0 }));
  else
    console.log("OK   [warpos-tracked-transients] no transient files tracked");
  process.exit(0);
}

const out = {
  ok: false,
  count: violations.length,
  violations: violations.slice(0, 20),
};
if (JSON_OUT) console.log(JSON.stringify(out));
else {
  console.error(
    `FAIL [warpos-tracked-transients] ${violations.length} transient files tracked:`,
  );
  for (const v of violations.slice(0, 20))
    console.error(`  - ${v.file}  (${v.reason})`);
  if (violations.length > 20)
    console.error(`  ... and ${violations.length - 20} more`);
  console.error(
    "\nFix: git rm --cached <file>, then ensure .gitignore covers the pattern.",
  );
}
process.exit(1);
