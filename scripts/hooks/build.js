#!/usr/bin/env node
/**
 * scripts/hooks/build.js — generate hook artifacts from framework/hooks.registry.json
 *
 * Inputs:
 *   framework/hooks.registry.json     (single source of truth — id, script, event/matcher,
 *                                   failMode, fixturesRequired)
 *
 * Outputs:
 *   scripts/hooks/hook-manifest.json    (programmatic introspection — settings.json shape,
 *                                        plus failMode + testFixtures + blocks)
 *   .claude/settings.json (hooks block) (the canonical distribution copy that warp-setup.js
 *                                        copies into target projects; preserves env +
 *                                        permissions blocks)
 *
 * Run:
 *   node scripts/hooks/build.js                      regenerate all
 *   node scripts/hooks/build.js --check              exit 1 if any artifact stale
 *
 * Pre-0.1.2 there was no registry. Hook truth was split across:
 *   - .claude/settings.json (per-event block — what Claude Code reads)
 *   - scripts/hooks/hook-manifest.json (derived FROM settings, not from a registry)
 *   - scripts/warp-setup.js (hardcoded hookConfig — the third source)
 *   - scripts/hooks/test.js (FAIL_CLOSED set + fixture map — fourth source)
 *
 * Adding a hook required editing all four. Now: edit registry, run build.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const REGISTRY_FILE = path.join(ROOT, "framework", "hooks.registry.json");
const CHECK_MODE = process.argv.includes("--check");

const OUT_HOOK_MANIFEST = path.join(
  ROOT,
  "scripts",
  "hooks",
  "hook-manifest.json",
);
const OUT_SETTINGS = path.join(ROOT, ".claude", "settings.json");

function readRegistry() {
  const raw = fs.readFileSync(REGISTRY_FILE, "utf8");
  const reg = JSON.parse(raw);
  if (reg.$schema !== "warpos/hooks-registry/v1") {
    throw new Error(`Unexpected registry $schema: ${reg.$schema}`);
  }
  return reg;
}

/**
 * scripts/hooks/hook-manifest.json — keyed by basename, shape mirrors what
 * downstream tooling already expected (Phase 4-era schema). Adds owner +
 * fixturesRequired so test.js can fail correctly when a fail-closed hook
 * forgot its fixture.
 */
function buildHookManifest(registry) {
  const hooks = {};
  for (const h of registry.hooks) {
    if (
      h.enabled === false &&
      (!h.registrations || h.registrations.length === 0)
    ) {
      // Hooks with no registrations and disabled stay out of the manifest;
      // they exist only as dispatched scripts (e.g. create-worktree-from-head).
      continue;
    }
    const basename = path.basename(h.script);
    hooks[basename] = {
      script: h.script,
      events: (h.registrations || []).map((r) => ({
        hookEvent: r.event,
        matcher: r.matcher || "",
      })),
      failMode: h.failMode,
      blocks: h.blocks || [],
      testFixtures: h.testFixtures || [],
      owner: h.owner,
      fixturesRequired: !!h.fixturesRequired,
      enabled: h.enabled !== false,
    };
  }
  // updatedAt is derived from the registry's mtime, NOT Date.now(), so
  // back-to-back build runs produce identical output and `--check` does
  // not flap. (Date.now() in the manifest made every check stale because
  // the timestamp moved between writes.)
  let updatedAt = null;
  try {
    updatedAt = fs.statSync(REGISTRY_FILE).mtime.toISOString();
  } catch {
    /* fall through */
  }
  return {
    $schema: "warpos/hook-manifest/v1",
    generatedFrom: "framework/hooks.registry.json",
    updatedAt,
    hooks,
  };
}

/**
 * .claude/settings.json hooks block. Preserves any unrelated keys (env,
 * permissions, statusLine) the canonical settings file already has — we
 * only own settings.hooks.
 */
function buildSettingsHooks(registry) {
  // Group enabled registrations by (event, matcher).
  const byEvent = {};
  for (const h of registry.hooks) {
    if (h.enabled === false) continue;
    for (const reg of h.registrations || []) {
      const event = reg.event;
      const matcher = reg.matcher || "";
      byEvent[event] = byEvent[event] || {};
      byEvent[event][matcher] = byEvent[event][matcher] || [];
      byEvent[event][matcher].push({
        type: "command",
        command: `node "$CLAUDE_PROJECT_DIR/${h.script}"`,
      });
    }
  }
  const out = {};
  for (const [event, byMatcher] of Object.entries(byEvent)) {
    out[event] = Object.entries(byMatcher).map(([matcher, hooks]) => {
      const block = { hooks };
      if (matcher) block.matcher = matcher;
      else block.matcher = "";
      return block;
    });
  }
  return out;
}

function readJsonOr(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeIfChanged(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let prior = "";
  try {
    prior = fs.readFileSync(file, "utf8");
  } catch {
    /* didn't exist */
  }
  if (prior === content) return { changed: false, file };
  if (CHECK_MODE) {
    return { changed: true, file, stale: true };
  }
  fs.writeFileSync(file, content);
  return { changed: true, file };
}

function fmtJson(obj) {
  return JSON.stringify(obj, null, 2) + "\n";
}

function main() {
  const registry = readRegistry();

  // Hook manifest is fully owned by us; overwrite.
  const manifest = buildHookManifest(registry);
  const manifestRes = writeIfChanged(OUT_HOOK_MANIFEST, fmtJson(manifest));

  // Settings: preserve everything except settings.hooks.
  const existing = readJsonOr(OUT_SETTINGS, {});
  const merged = { ...existing, hooks: buildSettingsHooks(registry) };
  const settingsRes = writeIfChanged(OUT_SETTINGS, fmtJson(merged));

  console.log(`\nscripts/hooks/build.js — registry v${registry.version}`);
  for (const r of [manifestRes, settingsRes]) {
    const rel = path.relative(ROOT, r.file).replace(/\\/g, "/");
    if (CHECK_MODE) {
      console.log(`  ${r.stale ? "STALE" : "ok   "}  ${rel}`);
    } else if (r.changed) {
      console.log(`  wrote  ${rel}`);
    } else {
      console.log(`  ok     ${rel}`);
    }
  }

  if (CHECK_MODE && [manifestRes, settingsRes].some((r) => r.stale)) {
    console.error(`\nHook artifacts stale. Run: node scripts/hooks/build.js`);
    process.exit(1);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`hooks/build: ${e.message}`);
    process.exit(2);
  }
}

module.exports = { buildHookManifest, buildSettingsHooks };
