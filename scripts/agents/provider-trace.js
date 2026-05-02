#!/usr/bin/env node
/**
 * Records expected vs actual provider use for cross-provider review.
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

function tracePath() {
  const paths = loadPaths();
  return path.join(ROOT, paths.providerTrace || ".claude/project/decisions/provider-trace.jsonl");
}

function record(entry) {
  const file = tracePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const line = {
    ts: new Date().toISOString(),
    role: entry.role || "unknown",
    expectedProvider: entry.expectedProvider || entry.provider || "unknown",
    actualProvider: entry.actualProvider || entry.provider || "unknown",
    model: entry.model || null,
    fellBack: Boolean(entry.fellBack || entry.fallback),
    fallbackReason: entry.fallbackReason || entry.error || null,
    promptBytes: entry.promptBytes || null,
    ok: entry.ok !== false,
  };
  fs.appendFileSync(file, JSON.stringify(line) + "\n", "utf8");
  return line;
}

function readTrace() {
  const file = tracePath();
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function check() {
  let manifest = {};
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude", "manifest.json"), "utf8"));
  } catch {
    return { ok: false, findings: ["manifest missing"] };
  }
  const providers = manifest.agentProviders || {};
  const reviewRoles = ["reviewer", "compliance", "qa", "redteam"];
  const expected = new Set(reviewRoles.map((r) => providers[r]).filter(Boolean));
  const findings = [];
  if (!expected.has("openai")) findings.push("review roles do not include openai");
  if (!expected.has("gemini")) findings.push("review roles do not include gemini");
  return { ok: findings.length === 0, expectedProviders: [...expected], findings, traceEntries: readTrace().length };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes("--record")) {
    const raw = args[args.indexOf("--record") + 1] || "{}";
    console.log(JSON.stringify(record(JSON.parse(raw)), null, 2));
    process.exit(0);
  }
  const result = check();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 2);
}

module.exports = { record, readTrace, check, tracePath };
