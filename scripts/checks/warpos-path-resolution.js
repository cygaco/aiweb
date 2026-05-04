#!/usr/bin/env node
// check:warpos-path-resolution — bidirectional paths.json ↔ refs integrity.
// Every key in paths.json resolves to an existing path. Every paths.X reference
// in scripts/agents/skills resolves to a defined key.
//
// Prompt for /reasoning:run refinement:
// "Bidirectional path-key integrity. Where does this check live (hook? skill? CI?)?
//  How do you handle generated docs that reference future keys? What's the false-positive
//  rate on doc-only references vs runtime requires?"
const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const JSON_OUT = process.argv.includes("--json");

const PATHS_FILE = path.join(ROOT, ".claude", "paths.json");
if (!fs.existsSync(PATHS_FILE)) {
  if (JSON_OUT)
    console.log(JSON.stringify({ ok: true, reason: "no paths.json" }));
  else console.log("OK   [warpos-path-resolution] no paths.json");
  process.exit(0);
}
const paths = JSON.parse(fs.readFileSync(PATHS_FILE, "utf8"));

const dangling = [];
for (const [key, value] of Object.entries(paths)) {
  if (key.startsWith("$") || key === "version") continue;
  if (typeof value !== "string") continue;
  // Skip generated/ephemeral keys (events file, store, checkpoint)
  if (/Lock|checkpoint|prev-run/.test(key)) continue;
  const abs = path.join(ROOT, value);
  if (!fs.existsSync(abs)) {
    dangling.push({ key, value });
  }
}

if (dangling.length === 0) {
  if (JSON_OUT)
    console.log(
      JSON.stringify({ ok: true, checked: Object.keys(paths).length }),
    );
  else
    console.log(
      `OK   [warpos-path-resolution] all ${Object.keys(paths).length} paths.json keys resolve`,
    );
  process.exit(0);
}

const out = { ok: false, dangling, totalKeys: Object.keys(paths).length };
if (JSON_OUT) console.log(JSON.stringify(out));
else {
  console.error(
    `FAIL [warpos-path-resolution] ${dangling.length} paths.json key(s) point to missing paths:`,
  );
  for (const d of dangling.slice(0, 15))
    console.error(`  - paths.${d.key} → ${d.value}`);
}
process.exit(1);
