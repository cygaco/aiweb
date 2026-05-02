#!/usr/bin/env node
/**
 * Path usage audit for keys previously suspected as zero-consumer.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const REGISTRY = path.join(ROOT, "warpos", "paths.registry.json");

const TARGET_KEYS = ["content", "oneshotSystem", "toolsFile", "requirementsFile", "loggerLib"];
const EXCLUDE = [
  "warpos/paths.registry.json",
  ".claude/paths.json",
  "scripts/hooks/lib/paths.generated.js",
  "scripts/path-lint.rules.generated.json",
  "schemas/paths.schema.json",
  "docs/04-architecture/PATH_KEYS.md",
  ".claude/framework-manifest.json",
  ".claude/framework-installed.json",
];

function files() {
  return execSync("git ls-files", { cwd: ROOT, encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((f) => !EXCLUDE.includes(f))
    .filter((f) => !f.startsWith("warpos/releases/"));
}

function readAll() {
  return files()
    .map((f) => {
      try {
        return { file: f, body: fs.readFileSync(path.join(ROOT, f), "utf8") };
      } catch {
        return { file: f, body: "" };
      }
    })
    .filter((x) => x.body);
}

function check(keys) {
  const registry = JSON.parse(fs.readFileSync(REGISTRY, "utf8")).paths || {};
  const corpus = readAll();
  const results = [];
  for (const key of keys) {
    const entry = registry[key];
    if (!entry || entry.removedIn) {
      results.push({ key, ok: false, reason: "missing or removed from registry", consumers: [] });
      continue;
    }
    const tokens = [`paths.${key}`, `PATHS.${key}`, `"${key}"`, `'${key}'`, entry.path];
    const consumers = [];
    for (const item of corpus) {
      if (tokens.some((token) => item.body.includes(token))) consumers.push(item.file);
    }
    results.push({
      key,
      path: entry.path,
      ok: consumers.length > 0,
      consumers: [...new Set(consumers)].slice(0, 10),
      count: new Set(consumers).size,
    });
  }
  return {
    ok: results.every((r) => r.ok),
    checked: keys,
    results,
  };
}

if (require.main === module) {
  const keys = process.argv.includes("--all")
    ? Object.keys(JSON.parse(fs.readFileSync(REGISTRY, "utf8")).paths || {})
    : TARGET_KEYS;
  const result = check(keys);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`path-usage: ${result.ok ? "ok" : "FAIL"} (${result.results.length} keys checked)`);
    for (const r of result.results) {
      console.log(`  ${r.ok ? "ok  " : "MISS"} ${r.key} -> ${r.path || ""} (${r.count || 0} consumer files)`);
      for (const c of r.consumers || []) console.log(`       ${c}`);
    }
  }
  process.exit(result.ok ? 0 : 2);
}

module.exports = { check };
