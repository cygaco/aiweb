#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// Seed an admin user — bootstrap script for DM access in staging/prod.
// Stories: PRD §9 dependency, GS-DM-31 (no API endpoint grants admin scope).
//
// Usage:
//   node scripts/seed-admin.js <userId>
//   node scripts/seed-admin.js <userId> --revoke
//
// In staging/prod this is run via `fly ssh console -C "node scripts/seed-admin.js <userId>"`.
// In local dev, point DATABASE_URL at the local Postgres or run with --dry-run.

"use strict";

function parseArgs(argv) {
  const args = { userId: null, revoke: false, dryRun: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--revoke") args.revoke = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--")) {
      // ignore unknown flags
    } else if (!args.userId) {
      args.userId = arg;
    }
  }
  return args;
}

function usage() {
  process.stderr.write(
    "Usage: node scripts/seed-admin.js <userId> [--revoke] [--dry-run]\n",
  );
}

async function getPgClient() {
  // Defer require so a missing pg dep in dev doesn't crash --dry-run.
  let pg;
  try {
    pg = require("pg");
  } catch (err) {
    throw new Error(
      "Failed to load 'pg'. Run `npm install pg` in services/backend or pass --dry-run.",
    );
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set.");
  }
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

async function grantAdminScope(userId, opts) {
  const ts = new Date().toISOString();
  if (opts.dryRun) {
    process.stdout.write(
      `[dry-run] would INSERT/UPDATE admin_users (user_id=${userId}, granted_at=${ts})\n`,
    );
    return { granted: true, dryRun: true };
  }
  const client = await getPgClient();
  try {
    // Idempotent upsert — repeated invocations refresh granted_at but don't
    // duplicate the row. Audit trail lives in a separate table (audit_log).
    const sql = `
      INSERT INTO admin_users (user_id, granted_at, granted_by, source)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id)
        DO UPDATE SET granted_at = EXCLUDED.granted_at, granted_by = EXCLUDED.granted_by
      RETURNING user_id, granted_at
    `;
    const grantedBy =
      process.env.SEEDER_ADMIN_OPERATOR || process.env.USER || "ssh-script";
    const res = await client.query(sql, [userId, ts, grantedBy, "seed-admin"]);
    return { granted: true, row: res.rows[0] };
  } finally {
    await client.end();
  }
}

async function revokeAdminScope(userId, opts) {
  if (opts.dryRun) {
    process.stdout.write(
      `[dry-run] would DELETE FROM admin_users WHERE user_id = ${userId}\n`,
    );
    return { revoked: true, dryRun: true };
  }
  const client = await getPgClient();
  try {
    const res = await client.query(
      "DELETE FROM admin_users WHERE user_id = $1 RETURNING user_id",
      [userId],
    );
    return { revoked: res.rowCount > 0 };
  } finally {
    await client.end();
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.userId) {
    usage();
    process.exit(1);
  }

  try {
    if (args.revoke) {
      const result = await revokeAdminScope(args.userId, {
        dryRun: args.dryRun,
      });
      process.stdout.write(JSON.stringify(result) + "\n");
    } else {
      const result = await grantAdminScope(args.userId, {
        dryRun: args.dryRun,
      });
      process.stdout.write(JSON.stringify(result) + "\n");
    }
    process.exit(0);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    process.stderr.write(`seed-admin failed: ${message}\n`);
    process.exit(2);
  }
}

if (require.main === module) {
  void main();
}

module.exports = {
  grantAdminScope,
  revokeAdminScope,
  parseArgs,
};
