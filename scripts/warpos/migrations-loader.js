/**
 * migrations-loader.js — Load + plan + apply migrations between WarpOS versions.
 *
 * Each migration module exports:
 *   { id, from, to, description, async plan(ctx)?, async apply(ctx) }
 *
 * `from` may be an exact semver ("0.1.2") or a wildcard ("0.1.x").
 *
 * Versions are walked semver-aware: from 0.1.2 -> 0.2.2, the loader picks the
 * applicable migrations/<from>-to-<to>/ at each step (e.g. 0.1.x-to-0.2.0/
 * then any later 0.2.0-to-0.2.x/), executing in order.
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_ROOT = path.join(REPO_ROOT, "migrations");

function parseSemver(v) {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`not semver: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function patternMatches(pattern, version) {
  if (pattern === version) return true;
  // Convert wildcard pattern (e.g. "0.1.x") to regex.
  const re = new RegExp(
    "^" + pattern.replace(/\./g, "\\.").replace(/x/gi, "\\d+") + "$",
  );
  return re.test(version);
}

function listMigrationDirs() {
  if (!fs.existsSync(MIGRATIONS_ROOT)) return [];
  return fs
    .readdirSync(MIGRATIONS_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const m = e.name.match(/^([\d.x]+)-to-(\d+\.\d+\.\d+)$/i);
      if (!m) return null;
      return { dir: e.name, fromPat: m[1], toVer: m[2] };
    })
    .filter(Boolean);
}

/**
 * Walk semver-aware from `from` to `to`, picking the lowest-`to` applicable
 * dir at each step. Returns an ordered list of migration .js paths.
 */
function listMigrationsBetween(from, to) {
  const dirs = listMigrationDirs();
  const files = [];
  let current = from;
  let safety = 64;
  while (compareSemver(current, to) < 0 && safety-- > 0) {
    const candidates = dirs
      .filter(
        (d) =>
          patternMatches(d.fromPat, current) &&
          compareSemver(d.toVer, current) > 0 &&
          compareSemver(d.toVer, to) <= 0,
      )
      .sort((a, b) => compareSemver(a.toVer, b.toVer));
    if (candidates.length === 0) break;
    const chosen = candidates[0];
    const dirAbs = path.join(MIGRATIONS_ROOT, chosen.dir);
    const stepFiles = fs
      .readdirSync(dirAbs)
      .filter((f) => /^\d{3}-/.test(f) && f.endsWith(".js"))
      .sort()
      .map((f) => path.join(dirAbs, f));
    for (const f of stepFiles) files.push(f);
    current = chosen.toVer;
  }
  return files;
}

/**
 * Legacy single-pair lookup. Kept for backwards compat with existing callers
 * that pass exact `from`-`to` like "0.1.2" → "0.2.0". For chain walking,
 * prefer listMigrationsBetween.
 */
function listMigrations(from, to) {
  const dir = path.join(MIGRATIONS_ROOT, `${from}-to-${to}`);
  if (fs.existsSync(dir)) {
    return fs
      .readdirSync(dir)
      .filter((f) => /^\d{3}-/.test(f) && f.endsWith(".js"))
      .sort()
      .map((f) => path.join(dir, f));
  }
  // Fall through to the chain walker — handles wildcarded `from` dirs.
  return listMigrationsBetween(from, to);
}

async function loadMigration(file) {
  delete require.cache[require.resolve(file)];
  const mod = require(file);
  if (!mod.id || !mod.from || !mod.to) {
    throw new Error(`Migration ${file} missing required fields (id, from, to)`);
  }
  if (typeof mod.plan !== "function" && typeof mod.apply !== "function") {
    throw new Error(`Migration ${file} must export plan() or apply()`);
  }
  return mod;
}

async function planAll(from, to, ctx) {
  const files = listMigrations(from, to);
  const allOps = [];
  for (const f of files) {
    const mig = await loadMigration(f);
    let ops = [];
    if (typeof mig.plan === "function") {
      ops = (await mig.plan(ctx || {})) || [];
    }
    allOps.push({
      migration: mig.id,
      file: path.relative(REPO_ROOT, f).replace(/\\/g, "/"),
      ops,
    });
  }
  return allOps;
}

async function applyAll(from, to, ctx) {
  const files = listMigrations(from, to);
  const log = [];
  for (const f of files) {
    const mig = await loadMigration(f);
    const start = Date.now();
    let result = { ok: true };
    if (typeof mig.apply === "function") {
      result = (await mig.apply(ctx || {})) || { ok: true };
    } else if (typeof mig.plan === "function") {
      result = { ok: true, planOnly: true, ops: await mig.plan(ctx || {}) };
    }
    log.push({
      migration: mig.id,
      file: path.relative(REPO_ROOT, f).replace(/\\/g, "/"),
      durationMs: Date.now() - start,
      result,
    });
    if (!result.ok) {
      log[log.length - 1].halted = true;
      break;
    }
  }
  return log;
}

module.exports = {
  listMigrations,
  listMigrationsBetween,
  listMigrationDirs,
  patternMatches,
  compareSemver,
  loadMigration,
  planAll,
  applyAll,
  MIGRATIONS_ROOT,
};

if (require.main === module) {
  const [, , from, to, mode] = process.argv;
  if (!from || !to) {
    console.error(
      "Usage: node scripts/warpos/migrations-loader.js <from> <to> [--plan|--apply]",
    );
    process.exit(2);
  }
  (async () => {
    if (mode === "--apply") {
      const log = await applyAll(from, to);
      console.log(JSON.stringify(log, null, 2));
    } else {
      const ops = await planAll(from, to);
      console.log(JSON.stringify(ops, null, 2));
    }
  })();
}
