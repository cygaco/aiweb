#!/usr/bin/env node
/* WarpOS 0.1.x -> 0.2.0 migration 004 — paths schema v4 -> v5.
 *
 * v5 changes:
 *   - requirements/* path values become _requirements/*
 *   - docs/* path values become _docs/*
 *   - new keys: architectureRoot, designSystemRoot, auditsRoot,
 *     integrationsRoot, docsRoot, frameworkRoot
 *
 * Idempotent. Reads .claude/paths.json, rewrites if v4 detected.
 */
const fs = require("fs");
const path = require("path");

function resolveRoot(ctx) {
  return (
    (ctx && ctx.targetRoot) || process.env.CLAUDE_PROJECT_DIR || process.cwd()
  );
}

function bump(root) {
  const PATHS_FILE = path.join(root, ".claude", "paths.json");
  if (!fs.existsSync(PATHS_FILE)) {
    return { ok: true, status: "noop", reason: ".claude/paths.json not found" };
  }
  const data = JSON.parse(fs.readFileSync(PATHS_FILE, "utf8"));
  if (data.version >= 5) {
    return { ok: true, status: "noop", reason: "paths schema already v5+" };
  }
  data.$schema = "warpos/paths/v5";
  data.version = 5;
  const updates = {
    requirements: "_requirements",
    requirementsRoot: "_requirements",
    specsRoot: "_requirements/04-features",
    research: "_docs/research",
    karpathyRuns: "_docs/karpathy-auto-research",
  };
  for (const [k, v] of Object.entries(updates)) {
    if (data[k] !== undefined) data[k] = v;
  }
  const adds = {
    architectureRoot: "_requirements/03-architecture",
    designSystemRoot: "_requirements/01-design-system",
    auditsRoot: "_requirements/_audits",
    integrationsRoot: "_requirements/09-integrations",
    docsRoot: "_docs",
    frameworkRoot: "framework",
  };
  for (const [k, v] of Object.entries(adds)) {
    if (data[k] === undefined) data[k] = v;
  }
  fs.writeFileSync(PATHS_FILE, JSON.stringify(data, null, 2) + "\n");
  return { ok: true, status: "migrated" };
}

async function apply(ctx) {
  return bump(resolveRoot(ctx));
}

function main() {
  const r = bump(resolveRoot(null));
  console.log(`[004] ${r.status}${r.reason ? `: ${r.reason}` : ""}`);
  return r.ok ? 0 : 1;
}

if (require.main === module) process.exit(main());

module.exports = {
  id: "004-paths-schema-v4-to-v5",
  from: "0.1.x",
  to: "0.2.0",
  description: "Bump .claude/paths.json from schema v4 to v5",
  apply,
  main,
};
