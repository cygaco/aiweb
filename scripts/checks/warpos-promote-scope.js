#!/usr/bin/env node
/* check:warpos-promote-scope — verify FRAMEWORK_PREFIXES covers every
 * known framework-owned dir.
 *
 * Catches the bug fixed 2026-05-03: requirements/, docs/, framework/ all
 * needed to be in scope for /warp:promote to detect changes; missing
 * prefixes silently dropped framework-touching commits.
 *
 * Exit 0 = green; 1 = missing prefixes.
 */
const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const JSON_OUT = process.argv.includes("--json");

const PROMOTE_FILE = path.join(ROOT, "scripts", "warpos", "promote.js");
if (!fs.existsSync(PROMOTE_FILE)) {
  if (JSON_OUT)
    console.log(
      JSON.stringify({
        ok: true,
        reason: "promote.js not present (consumer project)",
      }),
    );
  else
    console.log("OK   [warpos-promote-scope] no promote.js (consumer project)");
  process.exit(0);
}

const promoteSrc = fs.readFileSync(PROMOTE_FILE, "utf8");
const m = promoteSrc.match(/FRAMEWORK_PREFIXES\s*=\s*\[([\s\S]*?)\]/);
if (!m) {
  if (JSON_OUT)
    console.log(
      JSON.stringify({
        ok: false,
        reason: "FRAMEWORK_PREFIXES const not found",
      }),
    );
  else
    console.error(
      "FAIL [warpos-promote-scope] FRAMEWORK_PREFIXES not found in promote.js",
    );
  process.exit(1);
}
const prefixes = m[1].match(/"[^"]+"/g).map((s) => s.slice(1, -1));

// Known framework-owned top-level dirs that MUST be in scope (or have a
// good reason not to be — e.g. test/dev-only artifacts)
const REQUIRED = [
  ".claude/agents/",
  ".claude/commands/",
  ".claude/project/reference/",
  "scripts/",
  "schemas/",
  "patterns/",
  "fixtures/",
  "migrations/",
  "framework/", // post-2026-05-03 (was warpos/)
  "_requirements/", // post-2026-05-03 (was requirements/)
  "_docs/", // post-2026-05-03 (was docs/)
  "version.json",
  "install.ps1",
];

const missing = REQUIRED.filter(
  (req) => !prefixes.some((p) => p === req || p.startsWith(req)),
);

if (missing.length === 0) {
  if (JSON_OUT)
    console.log(JSON.stringify({ ok: true, count: prefixes.length }));
  else
    console.log(
      `OK   [warpos-promote-scope] all ${REQUIRED.length} required prefixes covered`,
    );
  process.exit(0);
}

const out = { ok: false, missing, prefixesPresent: prefixes };
if (JSON_OUT) console.log(JSON.stringify(out));
else {
  console.error(
    `FAIL [warpos-promote-scope] ${missing.length} required prefix(es) missing from FRAMEWORK_PREFIXES:`,
  );
  for (const m of missing) console.error(`  - ${m}`);
  console.error(
    "\nFix: add the missing prefix(es) to scripts/warpos/promote.js FRAMEWORK_PREFIXES.",
  );
}
process.exit(1);
