/**
 * gate-schema.js — Shared GATE_CHECK validation.
 *
 * Used by both gauntlet-gate.js and store-validator.js to ensure
 * consistent validation of GATE_CHECK entries.
 *
 * Usage:
 *   const { validateGateCheck, VALID_PREFIXES, INVALID_PREFIXES } = require("./lib/gate-schema");
 */

// Accepted status prefixes for GATE_CHECK reviewer fields
const VALID_PREFIXES = ["pass", "done", "impossible"];

// Rejected status prefixes — indicate incomplete or failed review
const INVALID_PREFIXES = [
  "pending",
  "skipped",
  "running",
  "codex-pending",
  "fail",
];

/**
 * Validate a single GATE_CHECK entry.
 * @param {object} entry - A GATE_CHECK entry from store.json runLog
 * @returns {{ valid: boolean, issues: string[] }}
 */
function validateGateCheck(entry) {
  const issues = [];

  if (!entry) {
    return { valid: false, issues: ["Entry is null/undefined"] };
  }

  // Must have at least one reviewer field
  const hasAnyReviewer = entry.evaluator || entry.security || entry.compliance;
  if (!hasAnyReviewer) {
    issues.push(
      "GATE_CHECK has no reviewer fields (evaluator/security/compliance)",
    );
  }

  // Validate each reviewer field
  for (const field of ["evaluator", "security", "compliance"]) {
    const val = entry[field];
    if (!val) continue;

    const lower = String(val).toLowerCase();

    // Check for invalid prefixes
    for (const prefix of INVALID_PREFIXES) {
      if (lower.startsWith(prefix)) {
        issues.push(
          `${field}="${val}" starts with invalid prefix "${prefix}". ` +
            `Must be: ${VALID_PREFIXES.join(", ")}`,
        );
        break;
      }
    }

    // Check it starts with a valid prefix (if not invalid)
    const isValid = VALID_PREFIXES.some((p) => lower.startsWith(p));
    const isInvalid = INVALID_PREFIXES.some((p) => lower.startsWith(p));
    if (!isValid && !isInvalid) {
      // Unknown prefix — warn but don't block (could be new format)
      issues.push(
        `${field}="${val}" has unknown prefix. Expected: ${VALID_PREFIXES.join(", ")}`,
      );
    }
  }

  // For features marked done: all 3 reviewers should be present
  // (caller checks this contextually — we just validate format here)

  return { valid: issues.length === 0, issues };
}

/**
 * Check if a reviewer value indicates passing status.
 * @param {string} val - The reviewer field value
 * @returns {boolean}
 */
function isPassingStatus(val) {
  if (!val || typeof val !== "string") return false;
  const lower = val.toLowerCase();
  return VALID_PREFIXES.some((p) => lower.startsWith(p));
}

/**
 * Compute a deterministic hash of a GATE_CHECK entry for immutability checking.
 * @param {object} entry - GATE_CHECK entry
 * @returns {string} Hash string
 */
function hashGateCheck(entry) {
  const crypto = require("crypto");
  const normalized = JSON.stringify({
    feature: entry.feature || "",
    phase: entry.phase || "",
    evaluator: entry.evaluator || "",
    security: entry.security || "",
    compliance: entry.compliance || "",
  });
  return crypto
    .createHash("sha256")
    .update(normalized)
    .digest("hex")
    .slice(0, 16);
}

module.exports = {
  validateGateCheck,
  isPassingStatus,
  hashGateCheck,
  VALID_PREFIXES,
  INVALID_PREFIXES,
};
