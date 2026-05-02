#!/usr/bin/env node
/**
 * Phase 5T process fix-forward checks.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

function read(rel) {
  const file = path.join(ROOT, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function check() {
  const findings = [];
  const gitignore = read(".gitignore");
  const mergeGuard = read("scripts/hooks/merge-guard.js");
  const worktree = read("scripts/hooks/worktree-preflight.js");
  const reviewerPrompt = read("scripts/delta-build-reviewer-prompt.js");
  const dispatch = read("scripts/dispatch-agent.js");
  const manifest = JSON.parse(read(".claude/manifest.json") || "{}");

  if (!/^\/backups\/$/m.test(gitignore)) findings.push("F6: .gitignore must anchor /backups/");
  if (!/git\\s\+checkout\\s\+--/.test(mergeGuard) && !/wide git checkout blocked/.test(mergeGuard)) {
    findings.push("F3: merge-guard should explicitly block wide git checkout -- .");
  }
  if (!/Cleaned \${cleaned.length} orphan/.test(worktree) && !/orphan/.test(worktree)) {
    findings.push("F1: worktree preflight lacks stale cleanup");
  }
  if (!/Scope filter/.test(reviewerPrompt) || !/In-scope files/.test(reviewerPrompt)) {
    findings.push("F7: reviewer prompts lack scope filter");
  }
  if (!/75 \* 1024|76800|75KB/.test(dispatch)) {
    findings.push("F8: dispatch-agent lacks large redteam fallback");
  }
  const ownership = manifest.fileOwnership || {};
  const owners = new Map();
  for (const [feature, files] of Object.entries(ownership)) {
    for (const f of files || []) {
      if (!owners.has(f)) owners.set(f, []);
      owners.get(f).push(feature);
    }
  }
  const conflicts = [...owners.entries()].filter(([, list]) => list.length > 1);
  if (conflicts.length > 0) findings.push(`F5: ${conflicts.length} file ownership conflicts`);

  return { ok: findings.length === 0, findings };
}

if (require.main === module) {
  const result = check();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 2);
}

module.exports = { check };
