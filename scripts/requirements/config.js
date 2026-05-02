/**
 * Requirements engine config — single source for paths, regex patterns, enum values.
 *
 * Phase 3K artifact. Centralizes constants so graph-build, gate, edit-watcher,
 * and the slash-command wrapper agree on identifiers and storage locations.
 */

const path = require("path");
const { PATHS } = require("../hooks/lib/paths");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
// PATHS values are already resolved to absolute paths by paths.js; do not
// re-prefix with REPO_ROOT or you get C:\...\C:\... double-pathing on Windows.
const SPECS_ROOT =
  PATHS.specsRoot || path.join(REPO_ROOT, "requirements", "05-features");
const REQUIREMENTS_ROOT =
  PATHS.requirementsRoot || path.join(REPO_ROOT, "requirements");
const INDEX_DIR = path.join(REQUIREMENTS_ROOT, "_index");
const CONTRACTS_DIR = path.join(
  REQUIREMENTS_ROOT,
  "04-architecture",
  "contracts",
);

const GRAPH_FILE = path.join(INDEX_DIR, "requirements.graph.json");
const STATUS_FILE = path.join(INDEX_DIR, "requirements.status.json");
const COVERAGE_FILE = path.join(INDEX_DIR, "requirements.coverage.json");
const STAGED_FILE =
  PATHS.requirementsStagedFile ||
  path.join(
    REPO_ROOT,
    ".claude",
    "project",
    "events",
    "requirements-staged.jsonl",
  );

// Identifier regexes. Match the actual format used by jobzooka specs:
//   GS-<feature-short>-<NN>     granular story
//   HL-<feature-short>-<NN>     high-level story
//   CS-<NNN>                    cross-cutting standard (e.g., "Inherits: CS-003")
//   REQ-<feature>-<topic>-<NNN> alternate spec form (allowed by plan, not in current corpus)
const ID_PATTERNS = {
  granularStory: /\bGS-([A-Z][A-Z0-9]{1,12})-(\d{2,3})\b/g,
  highLevelStory: /\bHL-([A-Z][A-Z0-9]{1,12})-(\d{2,3})\b/g,
  crossStandard: /\bCS-(\d{3})\b/g,
  reqStandard: /\bREQ-([a-z0-9-]+)-([a-z0-9-]+)-(\d{3})\b/g,
};

// VerificationStatus enum (3I)
const VERIFICATION_STATUS = Object.freeze({
  VERIFIED_BY_TEST: "verified_by_test",
  VERIFIED_BY_MANUAL_CHECK: "verified_by_manual_check",
  UNVERIFIED_ALLOWED_TEMPORARILY: "unverified_allowed_temporarily",
  DEPRECATED: "deprecated",
  STALE_PENDING_REVIEW: "stale_pending_review",
});

// Lifecycle status (separate from verification status)
const LIFECYCLE_STATUS = Object.freeze({
  ACTIVE: "active",
  DEPRECATED: "deprecated",
  REPLACED: "replaced",
  PROPOSED: "proposed",
});

// Drift risk class (3D) — reuses decision-policy A/B/C
const DRIFT_CLASS = Object.freeze({
  A: "A", // mechanical, same-feature
  B: "B", // behavior, same-feature
  C: "C", // cross-feature contract / pricing / privacy / auth / golden-path
});

// Feature directories that should be parsed. Excludes _shared, _standards, _index.
function listFeatureDirs() {
  const fs = require("fs");
  if (!fs.existsSync(SPECS_ROOT)) return [];
  return fs
    .readdirSync(SPECS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name)
    .sort();
}

// Files that must contain a feature short-code prefix mapping to ID_PATTERNS.granularStory[1]
// Example: feature "auth" uses ATH; feature "onboarding" uses ONB.
// We don't enforce this — graph-build derives the mapping from observed IDs in STORIES.md.

module.exports = {
  REPO_ROOT,
  SPECS_ROOT,
  REQUIREMENTS_ROOT,
  INDEX_DIR,
  CONTRACTS_DIR,
  GRAPH_FILE,
  STATUS_FILE,
  COVERAGE_FILE,
  STAGED_FILE,
  ID_PATTERNS,
  VERIFICATION_STATUS,
  LIFECYCLE_STATUS,
  DRIFT_CLASS,
  listFeatureDirs,
};
