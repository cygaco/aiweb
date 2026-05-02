#!/usr/bin/env node
/**
 * check-test-staleness.js — Print a report of features whose tests are
 * stale relative to their spec files.
 *
 * Reads:
 *   requirements/05-features/<feature>/*.md  (spec mtime)
 *   requirements/<feature>/tests/*.spec.ts (existence)
 *   .claude/runtime/test-runs/<feature>.json (last pass)
 *
 * Outputs a table:
 *   feature | spec last edit | test last pass | gap | suggested action
 *
 * Run:
 *   node scripts/check-test-staleness.js
 *   npm run test:stale-check
 */
const fs = require("fs");
const path = require("path");

const PROJECT = path.resolve(__dirname, "..");
const FEATURES_DIR = path.join(PROJECT, "docs", "05-features");
const REQUIREMENTS_DIR = path.join(PROJECT, "requirements");
const TEST_RUNS_DIR = path.join(PROJECT, ".claude", "runtime", "test-runs");

const FEATURE_DIR_OVERRIDES = { rockets: "rockets-economy" };
function dirForFeature(id) {
  return FEATURE_DIR_OVERRIDES[id] || id;
}
function idForDir(dir) {
  for (const [id, d] of Object.entries(FEATURE_DIR_OVERRIDES)) {
    if (d === dir) return id;
  }
  return dir;
}

function listFeatureFolders() {
  if (!fs.existsSync(FEATURES_DIR)) return [];
  return fs
    .readdirSync(FEATURES_DIR)
    .filter((f) => fs.statSync(path.join(FEATURES_DIR, f)).isDirectory());
}

function specMtime(featureDir) {
  const dir = path.join(FEATURES_DIR, featureDir);
  let latest = 0;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const m = fs.statSync(path.join(dir, file)).mtimeMs;
    if (m > latest) latest = m;
  }
  return latest || null;
}

function lastPass(featureId) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(TEST_RUNS_DIR, `${featureId}.json`), "utf8"),
    );
  } catch {
    return null;
  }
}

function hasTests(featureId) {
  const dir = path.join(REQUIREMENTS_DIR, featureId, "tests");
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some((f) => f.endsWith(".spec.ts"));
}

function fmt(ms) {
  if (!ms) return "—";
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

function gap(specMs, passMs) {
  if (!passMs) return "never-passed";
  if (specMs <= passMs) return "fresh";
  const hours = (specMs - passMs) / 3_600_000;
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function main() {
  const folders = listFeatureFolders();
  const rows = [];

  for (const folder of folders) {
    const featureId = idForDir(folder);
    const specMs = specMtime(folder);
    const tests = hasTests(featureId);
    const pass = lastPass(featureId);
    const passMs = pass?.last_pass ? new Date(pass.last_pass).getTime() : null;

    if (!specMs) continue; // no spec files at all
    const stale = !passMs || specMs > passMs;
    rows.push({
      feature: featureId,
      hasTests: tests,
      specMs,
      passMs,
      stale,
      action: !tests
        ? `write tests (Phase D): npm run test:${featureId}`
        : !passMs
          ? `tests never passed: npm run test:${featureId}`
          : stale
            ? `re-run: npm run test:${featureId}`
            : `up-to-date`,
    });
  }

  rows.sort((a, b) => {
    if (a.stale !== b.stale) return a.stale ? -1 : 1;
    if (!a.hasTests !== !b.hasTests) return !a.hasTests ? -1 : 1;
    return (b.specMs || 0) - (a.specMs || 0);
  });

  const COL = (s, w) => String(s).padEnd(w).slice(0, w);
  const W = { feat: 22, spec: 16, pass: 16, gap: 14, action: 50 };
  const sep = "─".repeat(W.feat + W.spec + W.pass + W.gap + W.action + 8);

  process.stdout.write("\n");
  process.stdout.write(
    `  ${COL("feature", W.feat)} ${COL("spec last edit", W.spec)} ${COL(
      "test last pass",
      W.pass,
    )} ${COL("gap", W.gap)} action\n`,
  );
  process.stdout.write(`  ${sep}\n`);
  let staleCount = 0;
  let noTestsCount = 0;
  for (const r of rows) {
    if (r.stale) staleCount += 1;
    if (!r.hasTests) noTestsCount += 1;
    const flag = !r.hasTests ? "✗" : r.stale ? "!" : "✓";
    process.stdout.write(
      `${flag} ${COL(r.feature, W.feat)} ${COL(fmt(r.specMs), W.spec)} ${COL(
        fmt(r.passMs),
        W.pass,
      )} ${COL(gap(r.specMs, r.passMs), W.gap)} ${r.action}\n`,
    );
  }
  process.stdout.write(`  ${sep}\n`);
  process.stdout.write(
    `  ${rows.length} features · ${noTestsCount} no-tests · ${staleCount} stale · ${
      rows.length - staleCount
    } fresh\n\n`,
  );
}

main();
