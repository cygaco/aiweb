/**
 * scripts/paths/lib/registry.js — small helper for consumers (installer,
 * update-engine, doctor) that need the path registry without rebuilding
 * the full artifact set.
 *
 * Single source of truth: framework/paths.registry.json.
 * Generators in scripts/paths/build.js consume the same file; this helper
 * exists so callers do NOT duplicate that registry → flat-paths logic
 * (which is exactly the rot warp-setup.js had pre-0.1.2).
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const REGISTRY_FILE = path.join(ROOT, "framework", "paths.registry.json");

function loadRegistry(rootOverride) {
  const file = rootOverride
    ? path.join(rootOverride, "framework", "paths.registry.json")
    : REGISTRY_FILE;
  if (!fs.existsSync(file)) {
    throw new Error(`paths registry not found at ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Build the runtime paths.json shape from the registry. Mirrors
 * scripts/paths/build.js#buildPathsJson — kept in sync because the build
 * script is the canonical source for cold-cache regeneration; this helper
 * is the warm-cache version for callers that just need the dictionary.
 */
function buildPathsJson(registry) {
  const out = {
    $schema: "warpos/paths/v" + registry.version,
    version: registry.version,
  };
  for (const [key, entry] of Object.entries(registry.paths)) {
    if (entry.removedIn) continue;
    out[key] = entry.path;
  }
  return out;
}

/**
 * Read warpos version.json. Used by installer + manifest writer to stamp
 * the canonical version into per-project manifests instead of guessing.
 */
function readWarpOSVersion(rootOverride) {
  const file = rootOverride
    ? path.join(rootOverride, "version.json")
    : path.join(ROOT, "version.json");
  if (!fs.existsSync(file)) {
    throw new Error(`version.json not found at ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

module.exports = {
  loadRegistry,
  buildPathsJson,
  readWarpOSVersion,
};
