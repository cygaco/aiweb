#!/usr/bin/env node
/**
 * Dependency admission guard. New package.json deps require an admission record.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const RECORD_FILE = path.join(ROOT, ".claude", "project", "decisions", "dependency-admissions.jsonl");

function readRecords() {
  if (!fs.existsSync(RECORD_FILE)) return [];
  return fs
    .readFileSync(RECORD_FILE, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function parsePackageJson(text) {
  const pkg = JSON.parse(text);
  return {
    dependencies: pkg.dependencies || {},
    devDependencies: pkg.devDependencies || {},
    optionalDependencies: pkg.optionalDependencies || {},
  };
}

function addedDeps(oldText, newText) {
  const oldPkg = oldText ? parsePackageJson(oldText) : { dependencies: {}, devDependencies: {}, optionalDependencies: {} };
  const newPkg = parsePackageJson(newText);
  const adds = [];
  for (const bucket of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, version] of Object.entries(newPkg[bucket] || {})) {
      if (!oldPkg[bucket] || oldPkg[bucket][name] === undefined) adds.push({ bucket, name, version });
    }
  }
  return adds;
}

function hasAdmission(depName) {
  return readRecords().some((r) => r.name === depName && r.status !== "rejected");
}

function validateAdmission(record) {
  const required = ["name", "justification", "alternatives", "license", "security", "maintenance", "cost", "removalPlan"];
  const missing = required.filter((k) => !record[k]);
  return { ok: missing.length === 0, missing };
}

function append(record) {
  fs.mkdirSync(path.dirname(RECORD_FILE), { recursive: true });
  const normalized = { ts: new Date().toISOString(), status: "accepted", ...record };
  const v = validateAdmission(normalized);
  if (!v.ok) throw new Error(`missing fields: ${v.missing.join(", ")}`);
  fs.appendFileSync(RECORD_FILE, JSON.stringify(normalized) + "\n", "utf8");
  return normalized;
}

function checkPackageEdit(oldText, newText) {
  const adds = addedDeps(oldText, newText);
  const missing = adds.filter((d) => !hasAdmission(d.name));
  return { ok: missing.length === 0, added: adds, missing };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === "--add") {
    const record = JSON.parse(args[1] || "{}");
    console.log(JSON.stringify(append(record), null, 2));
    process.exit(0);
  }
  const pkg = fs.readFileSync(path.join(ROOT, "package.json"), "utf8");
  const result = { ok: true, currentDeps: Object.keys(parsePackageJson(pkg).dependencies).length, admissions: readRecords().length };
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { addedDeps, checkPackageEdit, append, validateAdmission, RECORD_FILE };
