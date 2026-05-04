#!/usr/bin/env node
/* check:warpos-applied-migrations — already-applied migration scripts present.
 *
 * Migration scripts under migrations/X-to-Y/ are framework-side artifacts;
 * they should ONLY exist in the canonical repo (where authors maintain them)
 * and be deleted from consumer projects once installed-version >= Y.
 *
 * Exit 0 = green; 1 = stale migration dirs in consumer project.
 */
const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const JSON_OUT = process.argv.includes("--json");

function semver(v) {
  return v.split(".").map((n) => parseInt(n, 10) || 0);
}
function cmp(a, b) {
  const A = semver(a),
    B = semver(b);
  for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] - B[i];
  return 0;
}

const installedFile = path.join(ROOT, ".claude", "framework-installed.json");
if (!fs.existsSync(installedFile)) {
  if (JSON_OUT)
    console.log(
      JSON.stringify({
        ok: true,
        reason: "no framework-installed.json — not a consumer project",
      }),
    );
  else
    console.log(
      "OK   [warpos-applied-migrations] not a WarpOS-installed consumer project",
    );
  process.exit(0);
}
const installedVersion = JSON.parse(
  fs.readFileSync(installedFile, "utf8"),
).installedVersion;

const migrationsDir = path.join(ROOT, "migrations");
if (!fs.existsSync(migrationsDir)) {
  if (JSON_OUT)
    console.log(JSON.stringify({ ok: true, reason: "no migrations/ dir" }));
  else console.log("OK   [warpos-applied-migrations] no migrations/ dir");
  process.exit(0);
}

const stale = [];
for (const entry of fs.readdirSync(migrationsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const name = entry.name; // e.g. "0.0.0-to-0.1.0" or "0.1.x-to-0.2.0"
  const m = name.match(/^([0-9.x]+)-to-([0-9.]+)$/);
  if (!m) continue;
  const targetVersion = m[2].replace(/\.x$/, ".0");
  if (cmp(installedVersion, targetVersion) >= 0) {
    stale.push({
      dir: `migrations/${name}`,
      target: targetVersion,
      installed: installedVersion,
    });
  }
}

if (stale.length === 0) {
  if (JSON_OUT)
    console.log(JSON.stringify({ ok: true, installedVersion, count: 0 }));
  else
    console.log(
      `OK   [warpos-applied-migrations] no stale migrations (installed ${installedVersion})`,
    );
  process.exit(0);
}

const out = { ok: false, installedVersion, count: stale.length, stale };
if (JSON_OUT) console.log(JSON.stringify(out));
else {
  console.error(
    `FAIL [warpos-applied-migrations] ${stale.length} already-applied migration(s) on disk:`,
  );
  for (const s of stale)
    console.error(
      `  - ${s.dir}  (target ${s.target} <= installed ${s.installed})`,
    );
  console.error(
    "\nFix: git rm -rf <each dir>. Migration sources only need to exist in canonical WarpOS.",
  );
}
process.exit(1);
