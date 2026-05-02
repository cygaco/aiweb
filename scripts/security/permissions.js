#!/usr/bin/env node
/**
 * Permission model for tool actions.
 */

const MODEL = {
  0: { name: "read-only", review: "none", examples: ["Read", "Grep", "git status"] },
  1: { name: "local-edit", review: "normal", examples: ["Edit source", "run tests"] },
  2: { name: "dependency-or-schema", review: "Class B review", examples: ["package.json", "schema change"] },
  3: { name: "security-or-production", review: "security review required", examples: ["auth", "secrets", "payments", "prod data"] },
  4: { name: "external-or-destructive", review: "human approval required", examples: ["purchase", "push", "delete backup", "force push"] },
};

function classify(action) {
  const text = String(action || "").toLowerCase();
  if (/\b(push|force|purchase|signup|sign up|delete backup|reset --hard)\b/.test(text)) return 4;
  if (/\b(secret|credential|jwt|oauth|stripe|prod|production|payment|auth)\b/.test(text)) return 3;
  if (/\b(package\.json|package-lock|npm install|dependency|schema|migration)\b/.test(text)) return 2;
  if (/\b(edit|write|apply_patch|commit)\b/.test(text)) return 1;
  return 0;
}

function check() {
  const findings = [];
  if (classify("git push origin main") !== 4) findings.push("push must be Class 4");
  if (classify("edit auth route") !== 3) findings.push("auth edits must be Class 3");
  if (classify("npm install foo") !== 2) findings.push("dependency adds must be Class 2");
  return { ok: findings.length === 0, model: MODEL, findings };
}

if (require.main === module) {
  const result = check();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 2);
}

module.exports = { MODEL, classify, check };
