/**
 * graph-load.js — Read requirements.graph.json + helper queries.
 *
 * Phase 3A + 3K artifact. Imported by edit-watcher, gate.js, classify-drift,
 * resolve-impact, /check:requirements wrapper.
 */

const fs = require("fs");
const path = require("path");
const { GRAPH_FILE } = require("./config");

let cached = null;
let cachedMtime = 0;

function loadGraph(opts) {
  const force = opts && opts.force;
  if (!fs.existsSync(GRAPH_FILE)) return null;
  const stat = fs.statSync(GRAPH_FILE);
  if (cached && !force && stat.mtimeMs === cachedMtime) return cached;
  try {
    cached = JSON.parse(fs.readFileSync(GRAPH_FILE, "utf8"));
    cachedMtime = stat.mtimeMs;
    return cached;
  } catch (e) {
    return null;
  }
}

/**
 * Find every requirement that lists `relFile` in its implementedBy or any feature
 * whose Section 13 lists the file.
 *
 * @param relFile  path relative to repo root, forward slashes
 * @returns { requirements: string[], features: string[] }
 */
function findByImplementedFile(relFile) {
  const g = loadGraph();
  if (!g) return { requirements: [], features: [] };
  const norm = String(relFile).replace(/\\/g, "/");
  const fileRecord = g.files[norm];
  if (fileRecord) {
    return {
      requirements: fileRecord.implements.slice(),
      features: fileRecord.features.slice(),
    };
  }
  // Fallback: heuristic substring match for files in implementation maps that
  // include trailing slash patterns (e.g. `services/backend/src/admin/`).
  const matchedReqs = new Set();
  const matchedFeatures = new Set();
  for (const [k, v] of Object.entries(g.files)) {
    if (norm.startsWith(k.replace(/\/$/, "") + "/") || k === norm) {
      v.implements.forEach((id) => matchedReqs.add(id));
      v.features.forEach((f) => matchedFeatures.add(f));
    }
  }
  return {
    requirements: Array.from(matchedReqs),
    features: Array.from(matchedFeatures),
  };
}

function findFeatureByPrefix(prefix) {
  const g = loadGraph();
  if (!g) return null;
  // Walk requirements; whichever feature has stories starting with this prefix wins.
  const counts = {};
  for (const r of Object.values(g.requirements)) {
    const m = r.id.match(/^(?:GS|HL)-([A-Z][A-Z0-9]{1,12})-\d{2,3}$/);
    if (m && m[1] === prefix) {
      counts[r.feature] = (counts[r.feature] || 0) + 1;
    }
  }
  let best = null;
  let bestCount = 0;
  for (const [f, c] of Object.entries(counts)) {
    if (c > bestCount) {
      best = f;
      bestCount = c;
    }
  }
  return best;
}

function getRequirement(id) {
  const g = loadGraph();
  if (!g) return null;
  return g.requirements[id] || null;
}

function getFeature(name) {
  const g = loadGraph();
  if (!g) return null;
  return g.features[name] || null;
}

function listContracts() {
  const g = loadGraph();
  if (!g) return {};
  return g.contracts || {};
}

module.exports = {
  loadGraph,
  findByImplementedFile,
  findFeatureByPrefix,
  getRequirement,
  getFeature,
  listContracts,
};
