#!/usr/bin/env node
/**
 * Runtime data governance: classifies mutable stores and checks git policy.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

const DATA_CLASSES = [
  { id: "events", pathKey: "events", retentionDays: 90, redaction: "required", publicCommit: "no" },
  { id: "memory", pathKey: "memory", retentionDays: 365, redaction: "required", publicCommit: "digest-only" },
  { id: "decisions", pathKey: "decisions", retentionDays: 365, redaction: "required", publicCommit: "ledger-only" },
  { id: "runtime", pathKey: "runtime", retentionDays: 14, redaction: "required", publicCommit: "no" },
  { id: "builds", path: ".claude/project/builds", retentionDays: 30, redaction: "required", publicCommit: "no" },
  { id: "agent-transcripts", path: ".claude/runtime/dispatch", retentionDays: 14, redaction: "required", publicCommit: "no" },
  { id: "provider-outputs", pathKey: "providerTrace", retentionDays: 90, redaction: "required", publicCommit: "no" },
];

function loadPaths() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, ".claude", "paths.json"), "utf8"));
  } catch {
    return {};
  }
}

function resolvePolicy() {
  const paths = loadPaths();
  return DATA_CLASSES.map((item) => ({
    ...item,
    path: item.path || paths[item.pathKey] || null,
  }));
}

function gitTracked(rel) {
  try {
    return execSync(`git ls-files -- ${JSON.stringify(rel)}`, { cwd: ROOT, encoding: "utf8" })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function check() {
  const policy = resolvePolicy();
  const findings = [];
  for (const item of policy) {
    if (!item.path) findings.push({ severity: "red", message: `${item.id} has no path` });
    if (item.publicCommit === "no") {
      const tracked = gitTracked(item.path);
      if (tracked.length > 0) {
        findings.push({
          severity: "yellow",
          message: `${item.id} has ${tracked.length} tracked runtime file(s)`,
          sample: tracked.slice(0, 5),
        });
      }
    }
  }
  return { ok: findings.every((f) => f.severity !== "red"), policy, findings };
}

if (require.main === module) {
  const result = check();
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    for (const p of result.policy) {
      console.log(`${p.id}: ${p.path} retention=${p.retentionDays}d public=${p.publicCommit}`);
    }
    for (const f of result.findings) console.log(`[${f.severity.toUpperCase()}] ${f.message}`);
  }
  process.exit(result.ok ? 0 : 2);
}

module.exports = { DATA_CLASSES, resolvePolicy, check };
