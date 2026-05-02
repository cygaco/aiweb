#!/usr/bin/env node
/**
 * Install/update/migration safety checks.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

function read(rel) {
  return fs.existsSync(path.join(ROOT, rel)) ? fs.readFileSync(path.join(ROOT, rel), "utf8") : "";
}

function check() {
  const findings = [];
  const install = read("install.ps1");
  const update = read("scripts/warpos/update.js");
  const migrations = fs.existsSync(path.join(ROOT, "migrations"));

  if (!/\[switch\]\$DryRun/.test(install)) findings.push("install.ps1 lacks DryRun");
  if (!/framework-installed\.json/.test(install)) findings.push("install.ps1 does not write install snapshot");
  if (!/Apply path not yet implemented/.test(update) && !/dryRun/.test(update)) findings.push("update.js does not enforce dry-run safety");
  if (!migrations) findings.push("migrations directory missing");
  if (!/rollback|git/i.test(update + install)) findings.push("rollback/git safety not documented in update/install scripts");
  return { ok: findings.length === 0, findings };
}

if (require.main === module) {
  const result = check();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 2);
}

module.exports = { check };
