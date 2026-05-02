/**
 * migrations-loader.js — Load + plan + apply migrations between WarpOS versions.
 *
 * Phase 4B artifact. Each migration module exports:
 *   { id, from, to, description, async plan(ctx), async apply(ctx) }
 *   plan() returns an operation list ({ op, src?, dest?, content?, reason })
 *
 * apply() actually mutates the working tree. Caller controls when.
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_ROOT = path.join(REPO_ROOT, "migrations");

function listMigrations(from, to) {
  const dir = path.join(MIGRATIONS_ROOT, `${from}-to-${to}`);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{3}-/.test(f) && f.endsWith(".js"))
    .sort()
    .map((f) => path.join(dir, f));
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
      // plan-only migration — record but don't execute
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
