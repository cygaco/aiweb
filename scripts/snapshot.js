#!/usr/bin/env node
// Compute and compare sha256 file hashes for parallel gauntlet snapshot diffing.
// Usage:
//   node scripts/snapshot.js --hash --files <comma-separated-paths>
//   node scripts/snapshot.js --diff --before <json-file> --after <json-file>

const fs = require("fs");
const crypto = require("crypto");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

function usage() {
  process.stderr.write(
    `${YELLOW}Usage:${RESET}\n` +
      `  node scripts/snapshot.js --hash --files <comma-separated-paths>\n` +
      `  node scripts/snapshot.js --diff --before <json-file> --after <json-file>\n`,
  );
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let mode = null;
  let files = null;
  let before = null;
  let after = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--hash") {
      mode = "hash";
    } else if (args[i] === "--diff") {
      mode = "diff";
    } else if (args[i] === "--files" && args[i + 1]) {
      files = args[++i].split(",").map((f) => f.trim());
    } else if (args[i] === "--before" && args[i + 1]) {
      before = args[++i];
    } else if (args[i] === "--after" && args[i + 1]) {
      after = args[++i];
    }
  }

  if (!mode) usage();
  if (mode === "hash" && (!files || files.length === 0)) usage();
  if (mode === "diff" && (!before || !after)) usage();

  return { mode, files, before, after };
}

function hashFile(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(content).digest("hex");
  } catch (err) {
    process.stderr.write(
      `${YELLOW}[snapshot] WARNING: Could not read "${filePath}": ${err.message}${RESET}\n`,
    );
    return null;
  }
}

function computeHashes(files) {
  const hashes = {};

  for (const filePath of files) {
    const hash = hashFile(filePath);
    if (hash !== null) {
      hashes[filePath] = hash;
    }
  }

  process.stderr.write(
    `${CYAN}[snapshot]${RESET} Hashed ${Object.keys(hashes).length}/${files.length} files\n`,
  );

  process.stdout.write(JSON.stringify(hashes, null, 2) + "\n");
}

function diffSnapshots(beforePath, afterPath) {
  let beforeData, afterData;

  try {
    beforeData = JSON.parse(fs.readFileSync(beforePath, "utf8"));
  } catch (err) {
    process.stderr.write(
      `${RED}[snapshot] ERROR: Could not read before snapshot "${beforePath}": ${err.message}${RESET}\n`,
    );
    process.exit(1);
  }

  try {
    afterData = JSON.parse(fs.readFileSync(afterPath, "utf8"));
  } catch (err) {
    process.stderr.write(
      `${RED}[snapshot] ERROR: Could not read after snapshot "${afterPath}": ${err.message}${RESET}\n`,
    );
    process.exit(1);
  }

  const beforeKeys = new Set(Object.keys(beforeData));
  const afterKeys = new Set(Object.keys(afterData));

  const changed = [];
  const unchanged = [];
  const added = [];
  const removed = [];

  // Files in both snapshots
  for (const key of beforeKeys) {
    if (afterKeys.has(key)) {
      if (beforeData[key] === afterData[key]) {
        unchanged.push(key);
      } else {
        changed.push(key);
      }
    } else {
      removed.push(key);
    }
  }

  // Files only in after
  for (const key of afterKeys) {
    if (!beforeKeys.has(key)) {
      added.push(key);
    }
  }

  const result = { changed, unchanged, added, removed };

  if (changed.length > 0) {
    process.stderr.write(
      `${YELLOW}[snapshot]${RESET} ${changed.length} file(s) changed\n`,
    );
  }
  if (added.length > 0) {
    process.stderr.write(
      `${GREEN}[snapshot]${RESET} ${added.length} file(s) added\n`,
    );
  }
  if (removed.length > 0) {
    process.stderr.write(
      `${RED}[snapshot]${RESET} ${removed.length} file(s) removed\n`,
    );
  }
  if (changed.length === 0 && added.length === 0 && removed.length === 0) {
    process.stderr.write(`${GREEN}[snapshot]${RESET} No changes detected\n`);
  }

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

function main() {
  const { mode, files, before, after } = parseArgs();

  if (mode === "hash") {
    computeHashes(files);
  } else if (mode === "diff") {
    diffSnapshots(before, after);
  }
}

main();
