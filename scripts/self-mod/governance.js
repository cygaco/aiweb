#!/usr/bin/env node
/**
 * Self-modification governance for framework-owned surfaces.
 */

const FRAMEWORK_SURFACES = [
  ".claude/",
  "scripts/hooks/",
  "scripts/warpos/",
  "scripts/paths/",
  "scripts/agents/",
  "install.ps1",
  "version.json",
  "warpos/paths.registry.json",
];

function isFrameworkPath(rel) {
  return FRAMEWORK_SURFACES.some((p) => rel === p || rel.startsWith(p));
}

function requiredGates(files) {
  const touched = (files || []).filter(isFrameworkPath);
  if (touched.length === 0) return [];
  return [
    "node scripts/paths/gate.js",
    "node scripts/hooks/test.js --all",
    "node scripts/generate-framework-manifest.js --check",
    "node scripts/warpos/safety.js",
  ];
}

function check(files) {
  const gates = requiredGates(files);
  return { ok: true, frameworkFiles: (files || []).filter(isFrameworkPath), requiredGates: gates };
}

if (require.main === module) {
  const result = check(process.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { isFrameworkPath, requiredGates, check };
