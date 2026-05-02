#!/usr/bin/env node
/**
 * System coherence graph and gate.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const GRAPH = path.join(ROOT, ".claude", "project", "maps", "system-coherence.graph.json");

const DRIFT_TYPES = [
  "spec",
  "path",
  "mode",
  "agent",
  "decision",
  "provider",
  "hook",
  "memory",
  "config",
  "install",
  "security",
  "test",
  "runtime",
  "pattern",
  "version",
];

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function readJson(rel, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  } catch {
    return fallback;
  }
}

function runNode(args) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", timeout: 120000 });
  return {
    status: r.status,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    ok: r.status === 0,
  };
}

function sev(status, message, details) {
  return { status, message, details: details || [] };
}

function withoutGeneratedAt(graph) {
  const copy = { ...graph };
  delete copy.generatedAt;
  return copy;
}

function checkSpec() {
  const r = runNode(["scripts/requirements/gate.js"]);
  if (r.status === 0) return sev("green", "requirements freshness gate passes");
  if (r.status === 1) return sev("yellow", "requirements gate has warnings", r.stdout.split(/\r?\n/).slice(-6));
  return sev("red", "requirements gate failed", (r.stdout + r.stderr).split(/\r?\n/).slice(-8));
}

function checkPath() {
  const r = runNode(["scripts/paths/gate.js"]);
  return r.status === 0
    ? sev("green", "path registry and generated artifacts are coherent")
    : sev("red", "path coherence gate failed", (r.stdout + r.stderr).split(/\r?\n/).slice(-8));
}

function checkMode() {
  const mode = readJson(".claude/runtime/mode.json", null);
  if (!mode) return sev("yellow", "mode marker missing; run node scripts/mode-set.js adhoc --by alpha");
  if (mode.$schema !== "warpos/mode-marker/v2") return sev("red", "mode marker schema is not v2");
  return sev("green", `mode marker present: ${mode.mode}`);
}

function checkAgent() {
  const gamma = fs.readFileSync(path.join(ROOT, ".claude", "agents", "00-alex", "gamma.md"), "utf8");
  const stale = [".claude/agents/.system/agent-system.md", ".claude/agents/.system/adhoc/protocol.md"].filter((s) => gamma.includes(s));
  if (stale.length > 0) return sev("red", "Gamma still references stale agent-system paths", stale);
  return sev("green", "agent startup paths and canonical dispatch callouts are current");
}

function checkDecision() {
  const r = runNode(["scripts/decisions/ledger.js", "--json"]);
  return r.status === 0
    ? sev("green", "decision ledger has valid Class B/C entries")
    : sev("red", "decision ledger check failed", (r.stdout + r.stderr).split(/\r?\n/).slice(-8));
}

function checkProvider() {
  const r = runNode(["scripts/agents/provider-trace.js"]);
  return r.status === 0 ? sev("green", "provider diversity policy includes OpenAI and Gemini") : sev("red", "provider diversity check failed", r.stdout.split(/\r?\n/).slice(-8));
}

function checkHook() {
  const r = runNode(["scripts/hooks/test.js", "--all", "--json"]);
  if (r.status === 0) return sev("green", "all registered hooks have fixture tests");
  return sev("red", "hook fixture test gate failed", (r.stdout + r.stderr).split(/\r?\n/).slice(-12));
}

function checkMemory() {
  const r = runNode(["scripts/memory/provenance.js", "--json"]);
  if (r.status === 0) return sev("green", "memory provenance check has no red findings");
  return sev("red", "memory provenance has invalid JSON", r.stdout.split(/\r?\n/).slice(-8));
}

function checkConfig() {
  const r = runNode(["scripts/schemas/validate.js", "--strict"]);
  return r.status === 0 ? sev("green", "config schemas validate") : sev("red", "config schema validation failed", (r.stdout + r.stderr).split(/\r?\n/).slice(-8));
}

function checkInstall() {
  const r = runNode(["scripts/warpos/snapshot-installed.js", "--check"]);
  if (!exists("install.ps1") || !exists("version.json")) return sev("red", "install.ps1 or version.json missing");
  return r.status === 0 ? sev("green", "installer, version, and installed snapshot are present") : sev("red", "installed snapshot check failed", (r.stdout + r.stderr).split(/\r?\n/).slice(-8));
}

function checkSecurity() {
  const r = runNode(["scripts/security/permissions.js", "--check"]);
  return r.status === 0 ? sev("green", "permission model classifies sensitive actions") : sev("red", "permission model check failed", r.stdout.split(/\r?\n/).slice(-8));
}

function checkTest() {
  const pkg = readJson("package.json", {});
  const scripts = pkg.scripts || {};
  if (!scripts.build || !scripts.test) return sev("red", "package build/test scripts missing");
  if (!exists(".github/workflows/test.yml")) return sev("red", "CI parity workflow missing");
  return sev("green", "local build/test scripts and CI parity workflow exist");
}

function checkRuntime() {
  const r = runNode(["scripts/runtime/governance.js", "--json"]);
  if (r.status === 0) return sev("green", "runtime governance policy is declared");
  return sev("red", "runtime governance has red findings", r.stdout.split(/\r?\n/).slice(-8));
}

function checkPattern() {
  if (!exists("patterns/README.md")) return sev("red", "patterns/README.md missing");
  if (!exists("patterns/ADMISSION.md")) return sev("yellow", "pattern admission policy remains Phase 6 scope");
  const patternDir = path.join(ROOT, "patterns");
  const content = fs
    .readdirSync(patternDir)
    .filter((f) => f.endsWith(".md") && !["README.md", "ADMISSION.md"].includes(f));
  if (content.length < 3) return sev("yellow", "pattern library has admission policy but not enough canonical content");
  return sev("green", `pattern library has admission policy and ${content.length} canonical patterns`);
}

function checkVersion() {
  const version = readJson("version.json", {});
  const manifest = readJson(".claude/framework-manifest.json", {});
  const release = readJson(`warpos/releases/${version.version}/release.json`, {});
  if (!version.version || version.version !== manifest.version || version.version !== release.version) {
    return sev("red", "version.json, framework manifest, and release capsule disagree");
  }
  return sev("green", `version sources agree on ${version.version}`);
}

function buildGraph() {
  const checks = {
    spec: checkSpec(),
    path: checkPath(),
    mode: checkMode(),
    agent: checkAgent(),
    decision: checkDecision(),
    provider: checkProvider(),
    hook: checkHook(),
    memory: checkMemory(),
    config: checkConfig(),
    install: checkInstall(),
    security: checkSecurity(),
    test: checkTest(),
    runtime: checkRuntime(),
    pattern: checkPattern(),
    version: checkVersion(),
  };
  const nodes = DRIFT_TYPES.map((type) => ({ id: type, type: "driftType", ...checks[type] }));
  const red = nodes.filter((n) => n.status === "red").length;
  const yellow = nodes.filter((n) => n.status === "yellow").length;
  const graph = {
    $schema: "warpos/system-coherence-graph/v1",
    generatedAt: new Date().toISOString(),
    driftTypes: DRIFT_TYPES,
    summary: { green: nodes.length - red - yellow, yellow, red, ok: red === 0 },
    nodes,
    edges: [
      { from: "path", to: "config", relation: "feeds" },
      { from: "hook", to: "security", relation: "enforces" },
      { from: "decision", to: "agent", relation: "guides" },
      { from: "runtime", to: "install", relation: "excluded-from-release" },
    ],
  };
  if (fs.existsSync(GRAPH)) {
    try {
      const previous = JSON.parse(fs.readFileSync(GRAPH, "utf8"));
      if (
        JSON.stringify(withoutGeneratedAt(previous)) ===
        JSON.stringify(withoutGeneratedAt(graph))
      ) {
        graph.generatedAt = previous.generatedAt || graph.generatedAt;
      }
    } catch {
      // Rewrite malformed graph below.
    }
  }
  fs.mkdirSync(path.dirname(GRAPH), { recursive: true });
  const body = JSON.stringify(graph, null, 2) + "\n";
  if (!fs.existsSync(GRAPH) || fs.readFileSync(GRAPH, "utf8") !== body) {
    fs.writeFileSync(GRAPH, body, "utf8");
  }
  return graph;
}

function main() {
  const args = process.argv.slice(2);
  const graph = buildGraph();
  if (args.includes("--json")) console.log(JSON.stringify(graph, null, 2));
  else {
    for (const node of graph.nodes) {
      const tag = node.status === "red" ? "RED" : node.status === "yellow" ? "YEL" : "GRN";
      console.log(`[${tag}] ${node.id}: ${node.message}`);
      for (const d of (node.details || []).slice(0, 4)) console.log(`      ${d}`);
    }
    console.log(`Summary: ${graph.summary.green} green, ${graph.summary.yellow} yellow, ${graph.summary.red} red`);
  }
  process.exit(graph.summary.red === 0 ? 0 : 2);
}

if (require.main === module) main();

module.exports = { buildGraph, DRIFT_TYPES, GRAPH };
