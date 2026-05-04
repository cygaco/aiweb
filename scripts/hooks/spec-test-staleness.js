#!/usr/bin/env node
/**
 * spec-test-staleness.js — PostToolUse hook (Edit|Write).
 *
 * When a feature spec is edited (PRD.md, STORIES.md, COPY.md, INPUTS.md,
 * HL-STORIES.md inside _requirements/04-features/<feature>/), check whether the
 * matching tests at _requirements/<feature>/tests/*.spec.ts have been
 * validated SINCE this edit. If not, emit a `test.stale` event.
 *
 * Last-pass timestamps live at:
 *   .claude/runtime/test-runs/<feature>.json
 *     { "feature": "<id>", "last_pass": "<ISO>",
 *       "last_pass_commit": "<sha>", "spec_files_at_pass": [...] }
 *
 * Written by the test-runner agent on PASS; consumed here.
 *
 * Fail-open: any error in this hook silently exits 0 so it never blocks
 * an edit. The signal is informational, not enforcement.
 */
const fs = require("fs");
const path = require("path");

const PROJECT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Resolve specsRoot from paths registry. Phase 1 final-A renamed the spec
// home (the deprecated alias is recorded in the path registry — path-literal-allowed)
// to _requirements/04-features; this hook used to hardcode the old path
// (still flagged stale even after the rename) and silently no-op'd against
// current edits.
const { PATHS } = (() => {
  try {
    return require("./lib/paths");
  } catch {
    return { PATHS: null };
  }
})();
const SPECS_ROOT_REL = (
  PATHS && PATHS.specsRoot
    ? path.relative(PROJECT, PATHS.specsRoot)
    : "_requirements/04-features"
).replace(/\\/g, "/");
const SPECS_DIR = path.join(PROJECT, SPECS_ROOT_REL);
const REQUIREMENTS_DIR = path.join(PROJECT, "requirements");
const TEST_RUNS_DIR = path.join(PROJECT, ".claude", "runtime", "test-runs");

// Feature ID → feature folder under <specsRoot>/. The same alternate
// mapping the orchestrator uses (rockets ↔ rockets-economy).
const FEATURE_DIR_OVERRIDES = {
  rockets: "rockets-economy",
};

function readToolPayload() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function detectFeatureFromPath(filePath) {
  if (!filePath) return null;
  const norm = filePath.replace(/\\/g, "/");
  const escapedRoot = SPECS_ROOT_REL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escapedRoot}/([^/]+)/[A-Z][A-Z-]*\\.md$`);
  const m = norm.match(re);
  if (!m) return null;
  const featureDir = m[1];
  // Reverse the alternate mapping
  for (const [id, dir] of Object.entries(FEATURE_DIR_OVERRIDES)) {
    if (dir === featureDir) return id;
  }
  return featureDir;
}

function logStale(record) {
  // Append to the central event log via the project's logger if available.
  try {
    const { log } = require("./lib/logger");
    log(
      "spec",
      { kind: "test.stale", ...record },
      { actor: "spec-test-staleness" },
    );
    return;
  } catch {
    // Fall through to direct append
  }
  // Fallback: direct JSONL append to events file
  try {
    const eventsFile = path.join(
      PROJECT,
      ".claude",
      "project",
      "events",
      "events.jsonl",
    );
    fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        cat: "spec",
        kind: "test.stale",
        ...record,
      }) + "\n";
    fs.appendFileSync(eventsFile, line);
  } catch {
    // Fail open — do nothing
  }
}

function main() {
  const payload = readToolPayload();
  if (!payload) return;

  // Only act on Edit|Write tools.
  const tool = payload.tool_name || payload.tool || "";
  if (tool !== "Edit" && tool !== "Write" && tool !== "MultiEdit") return;

  const filePath =
    payload.tool_input?.file_path ||
    payload.tool_response?.filePath ||
    payload.file_path ||
    "";

  const featureId = detectFeatureFromPath(filePath);
  if (!featureId) return;

  const testsDir = path.join(REQUIREMENTS_DIR, featureId, "tests");
  if (!fs.existsSync(testsDir)) return; // no tests yet — Phase D coverage gap, separate concern
  const testFiles = fs
    .readdirSync(testsDir)
    .filter((f) => f.endsWith(".spec.ts"));
  if (testFiles.length === 0) return;

  const lastRunFile = path.join(TEST_RUNS_DIR, `${featureId}.json`);
  let lastRun = null;
  try {
    lastRun = JSON.parse(fs.readFileSync(lastRunFile, "utf8"));
  } catch {
    // No record — every existing test is stale relative to this edit
    lastRun = null;
  }

  const now = new Date();
  const editedAt = now.toISOString();

  const lastPassAt = lastRun?.last_pass || null;
  const lastPassMs = lastPassAt ? new Date(lastPassAt).getTime() : 0;
  const editMs = now.getTime();
  const gapHours = lastPassMs ? (editMs - lastPassMs) / 3_600_000 : null;

  // Stale if no record OR edit is newer than last pass.
  const stale = !lastPassAt || editMs > lastPassMs;
  if (!stale) return;

  logStale({
    feature: featureId,
    spec_file: filePath,
    spec_changed_at: editedAt,
    last_pass_at: lastPassAt,
    last_pass_commit: lastRun?.last_pass_commit || null,
    gap_hours:
      gapHours === null ? "never-passed" : Math.round(gapHours * 10) / 10,
    test_files: testFiles.map((f) =>
      path.join("requirements", featureId, "tests", f).replace(/\\/g, "/"),
    ),
    suggestion: lastPassAt
      ? `Re-run: npm run test:${featureId}`
      : `Tests have never passed. Run: npm run test:${featureId}`,
  });
}

try {
  main();
} catch {
  // Fail open
}
process.exit(0);
