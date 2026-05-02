#!/usr/bin/env node
/**
 * /paths:* command backend.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const REGISTRY = path.join(ROOT, "warpos", "paths.registry.json");

function registry() {
  return JSON.parse(fs.readFileSync(REGISTRY, "utf8"));
}

function runNode(args) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function doctor() {
  const gate = runNode(["scripts/paths/gate.js"]);
  return { ok: gate.status === 0, gate };
}

function coverage() {
  const reg = registry();
  const keys = Object.keys(reg.paths || {});
  const docs = fs.existsSync(path.join(ROOT, "docs", "04-architecture", "PATH_KEYS.md"))
    ? fs.readFileSync(path.join(ROOT, "docs", "04-architecture", "PATH_KEYS.md"), "utf8")
    : "";
  const documented = keys.filter((k) => docs.includes("`" + k + "`"));
  return { ok: documented.length === keys.length, total: keys.length, documented: documented.length };
}

function explain(key) {
  const entry = registry().paths[key];
  if (!entry) return { ok: false, error: `unknown path key ${key}` };
  return { ok: true, key, ...entry };
}

function main() {
  const [cmd, arg] = process.argv.slice(2);
  let result;
  if (!cmd || cmd === "doctor") result = doctor();
  else if (cmd === "coverage") result = coverage();
  else if (cmd === "explain") result = explain(arg);
  else if (cmd === "add" || cmd === "rename" || cmd === "convert") {
    result = { ok: true, message: `${cmd} is a guarded registry edit flow: edit warpos/paths.registry.json, run node scripts/paths/build.js, then node scripts/paths/gate.js.` };
  } else result = { ok: false, error: `unknown command ${cmd}` };
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = { doctor, coverage, explain };
