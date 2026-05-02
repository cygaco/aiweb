#!/usr/bin/env node
/**
 * Checks learning entries for provenance and freshness fields.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

function loadPaths() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, ".claude", "paths.json"), "utf8"));
  } catch {
    return {};
  }
}

function learningFile() {
  const paths = loadPaths();
  return path.join(ROOT, paths.learningsFile || ".claude/project/memory/learnings.jsonl");
}

function readLearnings() {
  const file = learningFile();
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, idx) => {
      try {
        return JSON.parse(line);
      } catch (e) {
        return { _invalid: true, line: idx + 1, error: e.message };
      }
    });
}

function normalize(entry) {
  if (!entry || entry._invalid) return entry;
  return {
    source: entry.source || "legacy",
    confidence: typeof entry.confidence === "number" ? entry.confidence : entry.score !== undefined ? Math.max(0, Math.min(1, Number(entry.score) / 4)) : 0.5,
    status: entry.status || "logged",
    lastVerified: entry.lastVerified || entry.verified_at || entry.ts || null,
    expiresAfter: entry.expiresAfter || null,
    contradictedBy: Array.isArray(entry.contradictedBy) ? entry.contradictedBy : [],
    ...entry,
  };
}

function check() {
  const entries = readLearnings();
  const findings = [];
  for (const [idx, raw] of entries.entries()) {
    if (raw._invalid) {
      findings.push({ severity: "red", message: `invalid learning line ${raw.line}: ${raw.error}` });
      continue;
    }
    const entry = normalize(raw);
    for (const key of ["source", "confidence", "status", "lastVerified", "contradictedBy"]) {
      if (entry[key] === undefined || entry[key] === null) {
        findings.push({ severity: "yellow", message: `learning line ${idx + 1} missing ${key}` });
      }
    }
  }
  return {
    ok: findings.every((f) => f.severity !== "red"),
    entries: entries.length,
    missingProvenance: findings.length,
    findings: findings.slice(0, 20),
  };
}

if (require.main === module) {
  const result = check();
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    for (const f of result.findings) console.log(`[${f.severity.toUpperCase()}] ${f.message}`);
    console.log(`memory-provenance: ${result.entries} entries, ${result.missingProvenance} findings`);
  }
  process.exit(result.ok ? 0 : 2);
}

module.exports = { check, normalize, readLearnings };
