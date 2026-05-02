/**
 * status.js — Read/write requirements/_index/requirements.status.json.
 *
 * Phase 3H + 3I artifact. Tracks which requirements are stale_pending_review
 * and which are verified. Banners in PRD/STORIES files are deprecated by this
 * machine-readable source of truth.
 *
 * Schema:
 * {
 *   "version": 1,
 *   "updatedAt": "...",
 *   "requirements": {
 *     "GS-ATH-01": {
 *       "verificationStatus": "verified_by_test|verified_by_manual_check|unverified_allowed_temporarily|deprecated|stale_pending_review",
 *       "lifecycleStatus": "active|deprecated|replaced|proposed",
 *       "lastChangedCommit": "<sha>",
 *       "lastVerifiedCommit": "<sha>",
 *       "openRcoIds": ["rco-..."]
 *     }
 *   }
 * }
 */

const fs = require("fs");
const path = require("path");
const {
  STATUS_FILE,
  COVERAGE_FILE,
  INDEX_DIR,
  VERIFICATION_STATUS,
  LIFECYCLE_STATUS,
} = require("./config");
const { loadGraph } = require("./graph-load");
const { listOpen } = require("./apply-rco");

function ensureIndexDir() {
  if (!fs.existsSync(INDEX_DIR)) fs.mkdirSync(INDEX_DIR, { recursive: true });
}

function loadStatus() {
  if (!fs.existsSync(STATUS_FILE)) {
    return { version: 1, updatedAt: null, requirements: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
  } catch {
    return { version: 1, updatedAt: null, requirements: {} };
  }
}

function saveStatus(status) {
  ensureIndexDir();
  status.updatedAt = new Date().toISOString();
  // Atomic write: tempfile + rename. On Windows, rename within the same
  // directory is atomic. Avoids a partially-written status file from
  // poisoning gate.js if a concurrent reader fires mid-write.
  const tmp = STATUS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(status, null, 2) + "\n");
  fs.renameSync(tmp, STATUS_FILE);
}

/**
 * Mark a list of requirement IDs as stale_pending_review and link them to an RCO.
 */
function markStale(requirementIds, rcoId) {
  if (!requirementIds || requirementIds.length === 0) return;
  const status = loadStatus();
  for (const id of requirementIds) {
    if (!status.requirements[id]) {
      status.requirements[id] = {
        verificationStatus: VERIFICATION_STATUS.UNVERIFIED_ALLOWED_TEMPORARILY,
        lifecycleStatus: LIFECYCLE_STATUS.ACTIVE,
        lastChangedCommit: null,
        lastVerifiedCommit: null,
        openRcoIds: [],
      };
    }
    const rec = status.requirements[id];
    rec.verificationStatus = VERIFICATION_STATUS.STALE_PENDING_REVIEW;
    // Defensive: legacy entries written before this field landed may be
    // missing openRcoIds. Default to empty list so .includes / .push work.
    if (!Array.isArray(rec.openRcoIds)) rec.openRcoIds = [];
    if (rcoId && !rec.openRcoIds.includes(rcoId)) {
      rec.openRcoIds.push(rcoId);
    }
  }
  saveStatus(status);
}

/**
 * Clear stale flag for a requirement when its RCO resolves.
 */
function clearStale(requirementIds, rcoId) {
  if (!requirementIds || requirementIds.length === 0) return;
  const status = loadStatus();
  for (const id of requirementIds) {
    const rec = status.requirements[id];
    if (!rec) continue;
    if (rcoId) {
      rec.openRcoIds = (rec.openRcoIds || []).filter((x) => x !== rcoId);
    }
    if ((rec.openRcoIds || []).length === 0) {
      // Revert to whatever it was before staleness; default unverified-allowed
      if (rec.verificationStatus === VERIFICATION_STATUS.STALE_PENDING_REVIEW) {
        rec.verificationStatus =
          VERIFICATION_STATUS.UNVERIFIED_ALLOWED_TEMPORARILY;
      }
    }
  }
  saveStatus(status);
}

/**
 * Recompute coverage.json from graph + status. Run during /check:requirements.
 */
function rebuildCoverage() {
  const g = loadGraph();
  if (!g) return null;
  const status = loadStatus();
  ensureIndexDir();
  const out = {
    version: 1,
    updatedAt: new Date().toISOString(),
    counts: {
      total: 0,
      verified_by_test: 0,
      verified_by_manual_check: 0,
      unverified_allowed_temporarily: 0,
      deprecated: 0,
      stale_pending_review: 0,
    },
    byFeature: {},
  };
  for (const [name] of Object.entries(g.features)) {
    out.byFeature[name] = {
      total: 0,
      verified_by_test: 0,
      verified_by_manual_check: 0,
      unverified_allowed_temporarily: 0,
      deprecated: 0,
      stale_pending_review: 0,
    };
  }
  for (const r of Object.values(g.requirements)) {
    const featureBucket = out.byFeature[r.feature];
    if (!featureBucket) continue;
    featureBucket.total += 1;
    out.counts.total += 1;
    const persisted = (status.requirements[r.id] || {}).verificationStatus;
    const verState =
      persisted ||
      r.verificationStatus ||
      VERIFICATION_STATUS.UNVERIFIED_ALLOWED_TEMPORARILY;
    if (out.counts[verState] !== undefined) {
      out.counts[verState] += 1;
    }
    if (featureBucket[verState] !== undefined) {
      featureBucket[verState] += 1;
    }
  }
  fs.writeFileSync(COVERAGE_FILE, JSON.stringify(out, null, 2) + "\n");
  return out;
}

/**
 * Reconcile status.json against the open RCO log + the graph.
 * Removes status entries for requirements that no longer exist in the graph.
 * Re-applies stale_pending_review for requirements still referenced by open RCOs.
 */
function reconcile() {
  const g = loadGraph();
  if (!g) return { added: 0, removed: 0, refreshed: 0 };
  const status = loadStatus();
  const open = listOpen();

  // Build set of requirement IDs referenced by open RCOs
  const stillStale = new Map(); // id → set of rcoIds
  for (const rco of open) {
    for (const id of rco.impactedRequirements || []) {
      if (!stillStale.has(id)) stillStale.set(id, new Set());
      stillStale.get(id).add(rco.id);
    }
  }

  let added = 0;
  let removed = 0;
  let refreshed = 0;

  // Remove dead entries
  for (const id of Object.keys(status.requirements)) {
    if (!g.requirements[id]) {
      delete status.requirements[id];
      removed += 1;
    }
  }

  // Refresh stale flags
  for (const [id, rcoSet] of stillStale.entries()) {
    if (!g.requirements[id]) continue; // dead anyway
    if (!status.requirements[id]) {
      status.requirements[id] = {
        verificationStatus: VERIFICATION_STATUS.STALE_PENDING_REVIEW,
        lifecycleStatus: LIFECYCLE_STATUS.ACTIVE,
        lastChangedCommit: null,
        lastVerifiedCommit: null,
        openRcoIds: Array.from(rcoSet),
      };
      added += 1;
    } else {
      const rec = status.requirements[id];
      rec.verificationStatus = VERIFICATION_STATUS.STALE_PENDING_REVIEW;
      rec.openRcoIds = Array.from(rcoSet);
      refreshed += 1;
    }
  }

  // Clear stale flags for entries no longer referenced by any open RCO
  for (const [id, rec] of Object.entries(status.requirements)) {
    if (rec.verificationStatus !== VERIFICATION_STATUS.STALE_PENDING_REVIEW)
      continue;
    if (stillStale.has(id)) continue;
    rec.openRcoIds = [];
    rec.verificationStatus = VERIFICATION_STATUS.UNVERIFIED_ALLOWED_TEMPORARILY;
    refreshed += 1;
  }

  saveStatus(status);
  rebuildCoverage();
  return { added, removed, refreshed };
}

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === "--reconcile") {
    const r = reconcile();
    console.log(
      `Reconciled status.json: added=${r.added} removed=${r.removed} refreshed=${r.refreshed}`,
    );
  } else if (cmd === "--rebuild-coverage") {
    const r = rebuildCoverage();
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.error(
      "Usage: node scripts/requirements/status.js [--reconcile|--rebuild-coverage]",
    );
    process.exit(2);
  }
}

module.exports = {
  loadStatus,
  saveStatus,
  markStale,
  clearStale,
  rebuildCoverage,
  reconcile,
};
