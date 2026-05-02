#!/usr/bin/env node
/**
 * Create a guarded deprecation proposal.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, ".claude", "project", "decisions", "deprecations");

function slug(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseArgs(argv) {
  const args = { id: null, type: "unknown", replacement: null, removalVersion: null, reason: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!args.id && !a.startsWith("--")) args.id = a;
    else if (a === "--type") args.type = argv[++i] || args.type;
    else if (a === "--replacement") args.replacement = argv[++i] || null;
    else if (a === "--removal-version") args.removalVersion = argv[++i] || null;
    else if (a === "--reason") args.reason = argv[++i] || null;
  }
  return args;
}

function proposal(args) {
  if (!args.id) throw new Error("missing id");
  const today = new Date().toISOString().slice(0, 10);
  return {
    $schema: "warpos/deprecation-proposal/v1",
    id: args.id,
    type: args.type,
    status: "deprecated",
    owner: "warp-framework",
    replacement: args.replacement || "TBD",
    reason: args.reason || "TBD",
    deprecatedAt: today,
    firstDeprecatedVersion: "TBD",
    earliestRemovalVersion: args.removalVersion || "TBD",
    migration: {
      required: true,
      script: "TBD",
      manualSteps: [],
    },
    userWarning: "TBD",
    rollback: "Restore the prior release capsule or revert the deprecation commit.",
  };
}

function writeProposal(args) {
  const body = proposal(args);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${new Date().toISOString().slice(0, 10)}-${slug(args.id)}.json`);
  if (fs.existsSync(file)) throw new Error(`proposal already exists: ${path.relative(ROOT, file)}`);
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + "\n", "utf8");
  return { ok: true, file: path.relative(ROOT, file).replace(/\\/g, "/"), proposal: body };
}

if (require.main === module) {
  try {
    const result = writeProposal(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(`deprecate: ${e.message}`);
    process.exit(2);
  }
}

module.exports = { parseArgs, proposal, writeProposal };
