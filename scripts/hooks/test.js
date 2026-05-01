#!/usr/bin/env node
/**
 * Hook fixture runner. Expands settings.json registrations into a hook
 * manifest, then runs synthetic payloads through each hook deterministically.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const SETTINGS = path.join(ROOT, ".claude", "settings.json");
const MANIFEST = path.join(ROOT, "scripts", "hooks", "hook-manifest.json");

const SPECIAL_FIXTURES = {
  "event-contract.js": ["fixtures/hooks/event-contract/orphan-event.json"],
  "response-size-guard.js": ["fixtures/hooks/response-size-guard/oversized-agent.json"],
  "retro-presence-check.js": ["fixtures/hooks/retro-presence-check/stop.json"],
  "worktree-preflight.js": ["fixtures/hooks/worktree-preflight/non-builder-agent.json"],
};

const STATIC_ONLY = new Set([
  // This hook creates a real git worktree by design. The fixture runner checks
  // registration + fixture presence but does not execute it.
  "create-worktree-from-head.js",
  // This hook writes handoff artifacts. Registration/fixture coverage is enough
  // for the deterministic hook gate; session behavior is covered manually.
  "session-stop.js",
]);

const FAIL_CLOSED = new Set([
  "merge-guard.js",
  "memory-guard.js",
  "framework-manifest-guard.js",
  "path-registry-guard.js",
  "secret-guard.js",
  "foundation-guard.js",
  "ownership-guard.js",
  "store-validator.js",
  "path-guard.js",
  "step-registry-guard.js",
  "extension-edit-guard.js",
  "dependency-admission-guard.js",
  "scope-contract-guard.js",
  "team-guard.js",
  "gate-check.js",
  "gauntlet-gate.js",
  "cycle-enforcer.js",
  "prompt-validator.js",
  "beta-gate.js",
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function extractScript(command) {
  const normalized = command.replace(/\\/g, "/");
  const m = normalized.match(/scripts\/hooks\/[^"'\s]+\.js/);
  return m ? m[0] : null;
}

function defaultFixtureFor(hookEvent, matcher) {
  if (hookEvent === "PostToolUse" && matcher === "Agent") return "fixtures/hooks/default/post-agent.json";
  if (hookEvent === "PostToolUse") return "fixtures/hooks/default/post-edit.json";
  if (hookEvent === "PreToolUse" && matcher === "Bash") return "fixtures/hooks/default/bash-safe.json";
  if (hookEvent === "PreToolUse" && matcher === "Agent") return "fixtures/hooks/default/agent-scoped.json";
  if (hookEvent === "PreToolUse" && matcher === "Edit|Write") return "fixtures/hooks/default/edit-text.json";
  if (hookEvent === "PreToolUse" && matcher === "Read|Grep|Glob") return "fixtures/hooks/default/read.json";
  if (hookEvent === "UserPromptSubmit") return "fixtures/hooks/default/user-prompt.json";
  if (hookEvent === "Stop" || hookEvent === "SessionEnd" || hookEvent === "StopFailure") return "fixtures/hooks/default/stop.json";
  if (hookEvent === "SessionStart") return "fixtures/hooks/default/session-start.json";
  return "fixtures/hooks/default/noop.json";
}

function discover() {
  const settings = readJson(SETTINGS);
  const hooks = {};
  for (const [hookEvent, registrations] of Object.entries(settings.hooks || {})) {
    for (const reg of registrations || []) {
      const matcher = reg.matcher || "";
      for (const h of reg.hooks || []) {
        const script = extractScript(h.command || "");
        if (!script) continue;
        const name = path.basename(script);
        if (!hooks[name]) {
          hooks[name] = {
            script,
            events: [],
            failMode: FAIL_CLOSED.has(name) ? "fail-closed" : "fail-open",
            blocks: [],
            testFixtures: SPECIAL_FIXTURES[name] || [defaultFixtureFor(hookEvent, matcher)],
          };
        }
        hooks[name].events.push({ hookEvent, matcher });
      }
    }
  }
  if (hooks["event-contract.js"]) {
    hooks["event-contract.js"].blocks = ["orphan jz:* listener/dispatcher warnings"];
  }
  if (hooks["response-size-guard.js"]) {
    hooks["response-size-guard.js"].blocks = ["oversized build-chain response warnings"];
  }
  if (hooks["retro-presence-check.js"]) {
    hooks["retro-presence-check.js"].blocks = ["missing run retro warning/enforcement"];
  }
  return {
    $schema: "warpos/hook-manifest/v1",
    generatedFrom: ".claude/settings.json",
    updatedAt: new Date().toISOString(),
    hooks,
  };
}

function writeManifest() {
  fs.writeFileSync(MANIFEST, JSON.stringify(discover(), null, 2) + "\n", "utf8");
  console.log(`hook-manifest: wrote ${path.relative(ROOT, MANIFEST)}`);
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST)) return null;
  return readJson(MANIFEST);
}

function runFixture(scriptRel, fixtureRel) {
  const script = path.join(ROOT, scriptRel);
  const fixture = path.join(ROOT, fixtureRel);
  if (!fs.existsSync(script)) return { ok: false, status: null, message: `missing script ${scriptRel}` };
  if (!fs.existsSync(fixture)) return { ok: false, status: null, message: `missing fixture ${fixtureRel}` };
  if (STATIC_ONLY.has(path.basename(scriptRel))) {
    return { ok: true, status: 0, ms: 0, stdout: "", stderr: "", message: "static fixture registered" };
  }
  const payload = fs.readFileSync(fixture, "utf8");
  const started = Date.now();
  const r = spawnSync(process.execPath, [script], {
    cwd: ROOT,
    input: payload,
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, DISABLE_SMART_CONTEXT: "1" },
  });
  const ms = Date.now() - started;
  const ok = r.status === 0 || r.status === 2;
  return {
    ok,
    status: r.status,
    ms,
    stdout: (r.stdout || "").slice(0, 200),
    stderr: (r.stderr || "").slice(0, 200),
    message: ok ? "ok" : `exit ${r.status}`,
  };
}

function testAll() {
  const manifest = loadManifest();
  if (!manifest) return { ok: false, red: 1, yellow: 0, results: [{ hook: "manifest", ok: false, message: "scripts/hooks/hook-manifest.json missing" }] };
  const expected = discover();
  const results = [];
  for (const [name, entry] of Object.entries(expected.hooks)) {
    const actual = manifest.hooks && manifest.hooks[name];
    if (!actual) {
      results.push({ hook: name, ok: false, severity: "red", message: "missing manifest entry" });
      continue;
    }
    if (!actual.testFixtures || actual.testFixtures.length === 0) {
      results.push({ hook: name, ok: false, severity: "red", message: "missing testFixtures" });
      continue;
    }
    for (const fixture of actual.testFixtures) {
      const r = runFixture(actual.script, fixture);
      results.push({ hook: name, fixture, severity: r.ok ? "green" : "red", ...r });
    }
  }
  const red = results.filter((r) => r.severity === "red").length;
  const yellow = results.filter((r) => r.severity === "yellow").length;
  return { ok: red === 0, green: results.length - red - yellow, yellow, red, results };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--write-manifest")) {
    writeManifest();
    return;
  }
  const result = testAll();
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    for (const r of result.results) {
      const tag = r.severity === "red" ? "RED" : r.severity === "yellow" ? "YEL" : "GRN";
      console.log(`[${tag}] ${r.hook}${r.fixture ? ` ${r.fixture}` : ""}: ${r.message} (${r.ms || 0}ms)`);
    }
    console.log(`${result.green || 0} green, ${result.yellow || 0} yellow, ${result.red || 0} red`);
  }
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = { discover, testAll, runFixture };
