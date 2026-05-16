#!/usr/bin/env node
/**
 * prune-installed-assets.js — remove framework-installed.json#assets entries
 * whose dest is missing on disk. Run after cleanup of stale migration dirs
 * or other intentional file removals before /warp:update preflight.
 *
 * Usage:
 *   node scripts/warpos/prune-installed-assets.js --target <path>
 *   node scripts/warpos/prune-installed-assets.js --target <path> --dry-run
 */

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : argv[i + 1];
  };
  return {
    target: get("--target") || process.cwd(),
    dryRun: argv.includes("--dry-run"),
    filter: get("--filter"),
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const target = path.resolve(opts.target);
  const fi = path.join(target, ".claude", "framework-installed.json");
  if (!fs.existsSync(fi)) {
    console.error(`framework-installed.json missing at ${fi}`);
    process.exit(2);
  }
  const installed = JSON.parse(fs.readFileSync(fi, "utf8"));
  const assets = installed.assets || [];

  const filter = opts.filter ? new RegExp(opts.filter) : null;
  const kept = [];
  const dropped = [];

  for (const a of assets) {
    const abs = path.join(target, a.dest);
    const exists = fs.existsSync(abs);
    if (exists) {
      kept.push(a);
      continue;
    }
    if (filter && !filter.test(a.dest)) {
      kept.push(a);
      continue;
    }
    dropped.push(a.dest);
  }

  console.log(
    JSON.stringify(
      {
        target,
        dryRun: opts.dryRun,
        droppedCount: dropped.length,
        keptCount: kept.length,
        droppedSample: dropped.slice(0, 20),
      },
      null,
      2,
    ),
  );

  if (!opts.dryRun && dropped.length > 0) {
    installed.assets = kept;
    fs.writeFileSync(fi, JSON.stringify(installed, null, 2) + "\n");
    console.log(
      `wrote pruned framework-installed.json (${kept.length} assets remain)`,
    );
  }
}

main();
