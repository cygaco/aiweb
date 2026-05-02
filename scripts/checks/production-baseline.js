#!/usr/bin/env node
/**
 * Production-readiness baseline checker.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

const DOCS = [
  {
    rel: "requirements/04-architecture/PRODUCTION_BASELINE.md",
    terms: [
      "Auth and sessions",
      "Authorization",
      "Data ownership",
      "Migrations",
      "Error handling",
      "Logging and observability",
      "Security headers",
      "Secrets management",
      "Backup and restore",
      "Test strategy",
      "Accessibility",
      "Deployment and rollback",
      "Rate limiting",
      "Privacy and retention",
    ],
  },
  {
    rel: "requirements/04-architecture/ACCESSIBILITY_BASELINE.md",
    terms: [
      "Keyboard navigation",
      "Focus states",
      "Semantic labels",
      "Contrast",
      "Form errors",
      "Screen-reader state",
    ],
  },
  {
    rel: "requirements/04-architecture/ANALYTICS.md",
    terms: [
      "user_signed_up",
      "workspace_created",
      "invite_sent",
      "checkout_started",
      "feature_completed",
      "error_seen",
    ],
  },
  {
    rel: "requirements/04-architecture/DISASTER_RECOVERY.md",
    terms: ["Backup scope", "Restore procedure", "RPO", "RTO", "Data deletion", "Incident contact"],
  },
  {
    rel: "requirements/04-architecture/RELEASE_READINESS.md",
    terms: ["Tests pass", "Security pass", "Requirements fresh", "Rollback available"],
  },
  {
    rel: "requirements/04-architecture/DEPRECATION_POLICY.md",
    terms: ["Deprecated", "Sunset pending", "Removed", "Minimum Deprecation Record"],
  },
];

function read(rel) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8");
}

function check() {
  const findings = [];
  for (const doc of DOCS) {
    const body = read(doc.rel);
    if (!body) {
      findings.push({
        severity: "red",
        file: doc.rel,
        message: "required production-readiness doc is missing",
      });
      continue;
    }
    for (const term of doc.terms) {
      if (!body.includes(term)) {
        findings.push({
          severity: "red",
          file: doc.rel,
          message: `missing required area: ${term}`,
        });
      }
    }
  }
  return {
    ok: findings.length === 0,
    checked: DOCS.length,
    findings,
  };
}

if (require.main === module) {
  const result = check();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`production-baseline: ok (${result.checked} docs)`);
  } else {
    console.log(`production-baseline: ${result.findings.length} finding(s)`);
    for (const f of result.findings) console.log(`  [${f.severity}] ${f.file}: ${f.message}`);
  }
  process.exit(result.ok ? 0 : 2);
}

module.exports = { check };
