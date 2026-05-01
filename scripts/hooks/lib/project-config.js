/**
 * Project config loader for hook scripts.
 *
 * Loads and caches .claude/manifest.json (was project-config.json).
 * All hooks import from this instead of hardcoding project-specific
 * paths, feature names, or dependency maps.
 *
 * Usage:
 *   const { getFeatures, getDeps, getFoundationFiles, getProviders } = require("./lib/project-config");
 */

const fs = require("fs");
const path = require("path");
const { PROJECT } = require("./paths");

let _cache = null;

function loadConfig() {
  if (_cache) return _cache;
  const configPath = path.join(PROJECT, ".claude", "manifest.json");
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    _cache = JSON.parse(raw);
    return _cache;
  } catch {
    // Fail-open: return empty config so hooks don't crash on projects without config
    return {
      project: { name: "unknown" },
      features: [],
      phases: [],
      fileOwnership: { foundation: [], features: {} },
      providers: {},
      paths: {},
      buildCommands: {},
      featureIdToDir: {},
    };
  }
}

/** @returns {string} Project name */
function getProjectName() {
  return loadConfig().project?.name || "unknown";
}

/** @returns {Array<{id: string, name: string, phase: number, dependencies: string[]}>} */
function getFeatures() {
  return loadConfig().build?.features || loadConfig().features || [];
}

/** @returns {string[]} All feature IDs */
function getFeatureIds() {
  return getFeatures().map((f) => f.id);
}

/** @returns {Object<string, string[]>} Feature ID → dependency IDs */
function getDeps() {
  const deps = {};
  for (const f of getFeatures()) {
    deps[f.id] = f.dependencies || [];
  }
  return deps;
}

/** @returns {string[]} Foundation file paths (read-only for feature agents) */
function getFoundationFiles() {
  return loadConfig().fileOwnership?.foundation || [];
}

/** @returns {Object<string, string[]>} Feature ID → owned file paths */
function getFileOwnership() {
  return loadConfig().fileOwnership?.features || {};
}

/** @returns {{builder: string, reviewer: string, compliance: string, redteam: string, fixer: string, qa: string, learner: string}} */
function getProviders() {
  return loadConfig().providers || {};
}

/** @returns {{specs: string, retro: string, hygiene: string, fixtures: string}} */
function getPaths() {
  return loadConfig().paths || {};
}

/** @returns {{build: string, typecheck: string, test: string}} */
function getBuildCommands() {
  return loadConfig().buildCommands || {};
}

/** @returns {Array<{id: number, name: string, order: number, parallel: boolean}>} */
function getPhases() {
  return loadConfig().build?.phases || loadConfig().phases || [];
}

/** @returns {Object<string, string>} Feature ID → directory name overrides */
function getFeatureIdToDir() {
  return (
    loadConfig().build?.featureIdToDir || loadConfig().featureIdToDir || {}
  );
}

/** @returns {string} Agent team name (e.g. "alex") */
function getAgentName() {
  return (
    loadConfig().agents?.team?.name || loadConfig().agentTeam?.name || "alex"
  );
}

/** @returns {string} Agent team directory path */
function getAgentDir() {
  return path.join(PROJECT, ".claude", "agents", getAgentName());
}

/** @returns {Object} Full agent team config (name, identity, agents map) */
function getAgentTeam() {
  return (
    loadConfig().agents?.team ||
    loadConfig().agentTeam || { name: "alex", identity: "Alex", agents: {} }
  );
}

/** @returns {Object} Project source paths (components, lib, api, pages, extension) */
function getProjectPaths() {
  return loadConfig().projectPaths || {};
}

/** @returns {string} Project tech stack summary */
function getProjectStack() {
  const cfg = loadConfig();
  const stack = cfg.project?.techStack;
  return Array.isArray(stack)
    ? stack.join(" + ")
    : cfg.project?.framework || "";
}

/** @returns {string} WarpOS product slug (e.g. "jobzooka") */
function getWarpProduct() {
  return (
    loadConfig().project?.slug ||
    loadConfig().warpProduct ||
    getProjectName().toLowerCase()
  );
}

/** Clear cache (useful for tests or hot-reload) */
function clearCache() {
  _cache = null;
}

module.exports = {
  loadConfig,
  getProjectName,
  getFeatures,
  getFeatureIds,
  getDeps,
  getFoundationFiles,
  getFileOwnership,
  getProviders,
  getPaths,
  getBuildCommands,
  getPhases,
  getFeatureIdToDir,
  getAgentName,
  getAgentDir,
  getAgentTeam,
  getProjectPaths,
  getProjectStack,
  getWarpProduct,
  clearCache,
};
