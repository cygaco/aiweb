#!/usr/bin/env node
/**
 * prune-dead-locks.js — eager pruner for stale dispatch concurrency slots.
 *
 * Phase 0 workstream C. Run by:
 *   - scripts/hooks/session-start.js (once per session start)
 *   - /warp:health (verification)
 *   - /warp:setup (initial install sanity)
 *   - Anytime an operator wants a clean board: `node scripts/dispatch/prune-dead-locks.js`
 *
 * The existing concurrency-lock.js does lazy mtime-based prune on every
 * acquire. Real failure mode: a process is killed before it released, its lock
 * file lives on, and orchestrators silently saturate the cap. Eager
 * PID-aliveness pruning fixes that.
 *
 * Exits 0 always. Prints a one-line summary; pass `--json` for a machine
 * readable summary.
 */

"use strict";

const { pruneDeadLocks } = require("../hooks/lib/concurrency-lock");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const verbose = args.includes("--verbose") || args.includes("-v");

const summary = pruneDeadLocks();

if (asJson) {
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  process.exit(0);
}

const parts = [];
parts.push(`scanned=${summary.scanned}`);
parts.push(`removed_dead=${summary.dead}`);
const providers = Object.keys(summary.byProvider);
if (providers.length) {
  parts.push(
    `providers=${providers
      .map(
        (p) =>
          `${p}(${summary.byProvider[p].after}/${summary.byProvider[p].before})`,
      )
      .join(",")}`,
  );
}
process.stdout.write(`[prune-dead-locks] ${parts.join(" ")}\n`);

if (verbose) {
  for (const [provider, stats] of Object.entries(summary.byProvider)) {
    process.stdout.write(
      `  ${provider}: ${stats.before} before -> ${stats.after} after (removed ${stats.removed})\n`,
    );
  }
}

process.exit(0);
