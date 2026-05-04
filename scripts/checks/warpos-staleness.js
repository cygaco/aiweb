#!/usr/bin/env node
/* check:warpos-staleness — installed-version vs canonical-version drift.
 *
 * Reads .claude/framework-installed.json (this project) and the canonical
 * WarpOS repo's version.json (path resolved from framework-installed.json
 * `source` or via WARPOS_CANONICAL env var). Fails if installed < canonical
 * for >7 days AND no pending /warp:update transaction exists.
 *
 * Exit 0 = green; 1 = stale.
 *
 * Usage: node scripts/checks/warpos-staleness.js [--json]
 */
const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const JSON_OUT = process.argv.includes("--json");
const STALENESS_DAYS = 7;

function semver(v) {
  return v.split(".").map((n) => parseInt(n, 10) || 0);
}
function cmp(a, b) {
  const A = semver(a),
    B = semver(b);
  for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] - B[i];
  return 0;
}

function findCanonicalVersionFile(installedSource) {
  if (process.env.WARPOS_CANONICAL) {
    return path.join(process.env.WARPOS_CANONICAL, "version.json");
  }
  if (!installedSource) return null;
  // installedSource looks like ".../WarpOS/framework/releases/0.1.2"
  const m = installedSource.match(/(.*[\\/]WarpOS)[\\/]/);
  if (m) return path.join(m[1], "version.json");
  return null;
}

function fail(reason, extra = {}) {
  const out = { ok: false, reason, ...extra };
  if (JSON_OUT) console.log(JSON.stringify(out));
  else console.error(`FAIL [warpos-staleness] ${reason}`);
  process.exit(1);
}
function pass(reason, extra = {}) {
  const out = { ok: true, reason, ...extra };
  if (JSON_OUT) console.log(JSON.stringify(out));
  else console.log(`OK   [warpos-staleness] ${reason}`);
  process.exit(0);
}

const installedFile = path.join(ROOT, ".claude", "framework-installed.json");
if (!fs.existsSync(installedFile))
  pass("no framework-installed.json — not a WarpOS-installed project");
const installed = JSON.parse(fs.readFileSync(installedFile, "utf8"));
const installedVersion = installed.installedVersion;
const installedSource = installed.source;
const installedAt = installed.installedAt;

const canonicalVersionFile = findCanonicalVersionFile(installedSource);
if (!canonicalVersionFile || !fs.existsSync(canonicalVersionFile)) {
  pass(
    `installed ${installedVersion}; canonical version.json not reachable (set WARPOS_CANONICAL to enable comparison)`,
    { installedVersion },
  );
}
const canonical = JSON.parse(fs.readFileSync(canonicalVersionFile, "utf8"));
const canonicalVersion = canonical.version;

const cmpResult = cmp(installedVersion, canonicalVersion);
if (cmpResult >= 0)
  pass(`installed ${installedVersion} >= canonical ${canonicalVersion}`, {
    installedVersion,
    canonicalVersion,
  });

// Stale — check for pending update transaction
const txDir = path.join(ROOT, ".warpos", "transactions");
let pendingTx = null;
if (fs.existsSync(txDir)) {
  const entries = fs.readdirSync(txDir);
  pendingTx = entries.find((e) => /warp-update/.test(e));
}
if (pendingTx)
  pass(
    `stale (installed ${installedVersion} < canonical ${canonicalVersion}) but pending update transaction in .warpos/transactions/${pendingTx}`,
    { installedVersion, canonicalVersion, pendingTx },
  );

// Check age
const installedDate = new Date(installedAt);
const now = new Date();
const ageDays = (now - installedDate) / 86400000;
if (ageDays < STALENESS_DAYS)
  pass(
    `stale (installed ${installedVersion} < canonical ${canonicalVersion}) but only ${ageDays.toFixed(1)}d old (threshold ${STALENESS_DAYS}d)`,
    { installedVersion, canonicalVersion, ageDays },
  );

fail(
  `installed ${installedVersion} < canonical ${canonicalVersion}, age ${ageDays.toFixed(1)}d > threshold ${STALENESS_DAYS}d, no pending /warp:update transaction. Run: /warp:update --to ${canonicalVersion} --apply`,
  { installedVersion, canonicalVersion, ageDays },
);
