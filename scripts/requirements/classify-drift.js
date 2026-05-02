/**
 * classify-drift.js — Map an RCO (Requirements Change Object) to A/B/C class.
 *
 * Phase 3D + 3K artifact. Reuses decision-policy A/B/C taxonomy (paths.decisionPolicy).
 *
 * Rules (in order — first match wins):
 *   C  — touches a shared contract / pricing / privacy / auth / golden-path
 *   C  — affects multiple features whose dependsOn relation crosses a contract
 *   B  — same-feature behavior change (story acceptance criteria text changed)
 *   B  — adds/removes a public route, env var, or storage schema field
 *   A  — same-feature mechanical change (rename, refactor, formatting, comments)
 *   A  — default if no behavior signal detected
 */

const path = require("path");
const { DRIFT_CLASS } = require("./config");

const CONTRACT_KEYWORDS = [
  "session",
  "auth",
  "authentication",
  "authorization",
  "permission",
  "role",
  "scope",
  "payment",
  "checkout",
  "rocket",
  "billing",
  "pricing",
  "tier",
  "subscription",
  "privacy",
  "gdpr",
  "consent",
  "pii",
  "routing",
  "redirect",
  "middleware",
  "csrf",
  "cookie",
  "token",
  "jwt",
];

const GOLDEN_PATH_PATHS = [
  "src/app/page.tsx",
  "src/lib/auth",
  "src/lib/storage",
  "services/backend/src/middleware",
  "services/backend/src/routes/auth",
  "packages/shared/auth",
];

function looksLikeContractTouch(rco) {
  // Fix-forward (gemini Phase 3 review 2026-04-30): include actual diff text
  // (`oldString` + `newString`) in the haystack, not just metadata. A Class C
  // change wrapped in a generic "refactor" summary in a generic file path
  // would previously evade detection. Cap diff text at 32KB per side to avoid
  // pathological large pastes.
  const cap = (s) => (typeof s === "string" ? s.slice(0, 32 * 1024) : "");
  const haystack = [
    ...(rco.changedFiles || []),
    ...(rco.impactedRequirements || []),
    rco.summary || "",
    rco.diffSummary || "",
    cap(rco.oldString),
    cap(rco.newString),
    cap(rco.diffText),
  ]
    .join(" ")
    .toLowerCase();

  if ((rco.sharedContractsTouched || []).length > 0) return true;

  for (const kw of CONTRACT_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`);
    if (re.test(haystack)) return true;
  }
  for (const gp of GOLDEN_PATH_PATHS) {
    if (haystack.includes(gp.toLowerCase())) return true;
  }
  return false;
}

function looksLikeBehaviorChange(rco) {
  // Fix-forward (gemini Phase 3 review): include actual diff text alongside
  // diffSummary so that behavior signals in the code itself surface even when
  // the metadata says "trivial."
  const cap = (s) => (typeof s === "string" ? s.slice(0, 16 * 1024) : "");
  const haystack = [
    rco.diffSummary || "",
    cap(rco.oldString),
    cap(rco.newString),
    cap(rco.diffText),
  ]
    .join(" ")
    .toLowerCase();
  // Behavior signals: route added/removed, env var, schema, status code change.
  const behaviorPatterns = [
    /\broute\b/,
    /\bendpoint\b/,
    /\bstatus\s*code\b/,
    /\benv\s*var\b/,
    /\bschema\b/,
    /\bmigration\b/,
    /\bvalidation\b/,
    /\berror\s*message\b/,
    /\bredirect\b/,
    /\bregex\b/,
  ];
  for (const re of behaviorPatterns) {
    if (re.test(haystack)) return true;
  }
  // Signal from acceptance-criteria diff (caller fills `criteriaDiff` if it parses)
  if (rco.criteriaDiff && rco.criteriaDiff.length > 0) return true;
  return false;
}

function isCrossFeature(rco) {
  const features = new Set(rco.impactedFeatures || []);
  return features.size > 1;
}

/**
 * @param rco  RequirementsChangeObject (see stage-rco.js for shape)
 * @returns "A" | "B" | "C"
 */
function classify(rco) {
  if (looksLikeContractTouch(rco)) return DRIFT_CLASS.C;
  if (isCrossFeature(rco) && (rco.sharedContractsTouched || []).length === 0) {
    // cross-feature without explicit contract touch is still B by default
    return DRIFT_CLASS.B;
  }
  if (looksLikeBehaviorChange(rco)) return DRIFT_CLASS.B;
  return DRIFT_CLASS.A;
}

/**
 * Recommend updates for the RCO based on class + signals.
 */
function recommend(rco, drClass) {
  const recs = {
    recommendedSpecUpdate: null,
    recommendedTestUpdate: null,
    requiresHuman: drClass === DRIFT_CLASS.C,
  };
  if (drClass === DRIFT_CLASS.A) {
    recs.recommendedSpecUpdate = "no_update_needed";
    recs.recommendedTestUpdate = "no_update_needed";
  } else if (drClass === DRIFT_CLASS.B) {
    recs.recommendedSpecUpdate = "update_acceptance_criteria";
    recs.recommendedTestUpdate = "add_or_update_test";
  } else {
    recs.recommendedSpecUpdate = "update_contract_and_dependents";
    recs.recommendedTestUpdate = "add_contract_test";
  }
  return recs;
}

module.exports = {
  classify,
  recommend,
  CONTRACT_KEYWORDS,
};
