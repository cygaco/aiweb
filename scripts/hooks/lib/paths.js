/**
 * Shared path utilities for hook scripts.
 *
 * Solves the Windows path normalization bug: CLAUDE_PROJECT_DIR may be
 * unset (defaults to "."), but Claude Code sends absolute Windows paths
 * like C:\Users\...\file.ts. Without path.resolve(), startsWith() fails
 * and all path-based matching breaks silently.
 *
 * Usage:
 *   const { PROJECT, relPath } = require("./lib/paths");
 */

const path = require("path");
const fs = require("fs");

const PROJECT = path.resolve(process.env.CLAUDE_PROJECT_DIR || ".");

// ── Centralized path registry ──────────────────────────────
// All hooks read paths from .claude/paths.json instead of hardcoding.
// To move a folder, update paths.json — all consumers follow automatically.
let PATHS = {};
try {
  const raw = JSON.parse(
    fs.readFileSync(path.join(PROJECT, ".claude", "paths.json"), "utf8"),
  );
  PATHS = Object.fromEntries(
    Object.entries(raw)
      .filter(([k]) => k !== "version")
      .map(([k, v]) => [k, path.join(PROJECT, v)]),
  );
} catch {
  // Fallback: paths.json missing — use defaults matching the install layout
  PATHS = {
    events: path.join(PROJECT, ".claude", "project", "events"),
    memory: path.join(PROJECT, ".claude", "project", "memory"),
    maps: path.join(PROJECT, ".claude", "project", "maps"),
    reference: path.join(PROJECT, ".claude", "project", "reference"),
    runtime: path.join(PROJECT, ".claude", "runtime"),
    logs: path.join(PROJECT, ".claude", "runtime", "logs"),
    handoffs: path.join(PROJECT, ".claude", "runtime", "handoffs"),
    handoffLatest: path.join(PROJECT, ".claude", "runtime", "handoff.md"),
    plans: path.join(PROJECT, ".claude", "runtime", "plans"),
    agents: path.join(PROJECT, ".claude", "agents"),
    agentSystem: path.join(PROJECT, ".claude", "agents", "00-alex", ".system"),
    betaSystem: path.join(
      PROJECT,
      ".claude",
      "agents",
      "00-alex",
      ".system",
      "beta",
    ),
    commands: path.join(PROJECT, ".claude", "commands"),
    content: path.join(PROJECT, ".claude", "content"),
    dreams: path.join(PROJECT, ".claude", "dreams"),
    favorites: path.join(PROJECT, ".claude", "content", "favorites"),
    hooks: path.join(PROJECT, "scripts", "hooks"),
    hookLib: path.join(PROJECT, "scripts", "hooks", "lib"),
    patterns: path.join(PROJECT, "patterns"),
    requirements: path.join(PROJECT, "requirements"),
    manifest: path.join(PROJECT, ".claude", "manifest.json"),
    settings: path.join(PROJECT, ".claude", "settings.json"),
    store: path.join(PROJECT, ".claude", "agents", "store.json"),
    eventsFile: path.join(
      PROJECT,
      ".claude",
      "project",
      "events",
      "events.jsonl",
    ),
    toolsFile: path.join(
      PROJECT,
      ".claude",
      "project",
      "events",
      "tools.jsonl",
    ),
    requirementsFile: path.join(
      PROJECT,
      ".claude",
      "project",
      "events",
      "requirements.jsonl",
    ),
    requirementsStagedFile: path.join(
      PROJECT,
      ".claude",
      "project",
      "events",
      "requirements-staged.jsonl",
    ),
    learningsFile: path.join(
      PROJECT,
      ".claude",
      "project",
      "memory",
      "learnings.jsonl",
    ),
    tracesFile: path.join(
      PROJECT,
      ".claude",
      "project",
      "memory",
      "traces.jsonl",
    ),
    systemsFile: path.join(
      PROJECT,
      ".claude",
      "project",
      "memory",
      "systems.jsonl",
    ),
    specGraph: path.join(
      PROJECT,
      ".claude",
      "project",
      "maps",
      "SPEC_GRAPH.json",
    ),
    judgmentModel: path.join(
      PROJECT,
      ".claude",
      "agents",
      "00-alex",
      ".system",
      "beta",
      "judgement-model.md",
    ),
    judgmentRecommendations: path.join(
      PROJECT,
      ".claude",
      "agents",
      "00-alex",
      ".system",
      "beta",
      "judgement-model-recommendations.md",
    ),
    betaSourceData: path.join(
      PROJECT,
      ".claude",
      "agents",
      "00-alex",
      ".system",
      "beta",
      "beta-source-data.md",
    ),
    betaEvents: path.join(
      PROJECT,
      ".claude",
      "agents",
      "00-alex",
      ".system",
      "beta",
      "events.jsonl",
    ),
    lexicon: path.join(
      PROJECT,
      ".claude",
      "agents",
      "00-alex",
      ".system",
      "lexicon.md",
    ),
    pathsLib: path.join(PROJECT, "scripts", "hooks", "lib", "paths.js"),
    loggerLib: path.join(PROJECT, "scripts", "hooks", "lib", "logger.js"),
  };
}

/**
 * Convert an absolute file path to a project-relative path with forward slashes.
 * Handles Windows backslashes, absolute paths, and the unset CLAUDE_PROJECT_DIR case.
 *
 * @param {string} filePath - Absolute or relative file path from Claude Code
 * @returns {string} Relative path with forward slashes (e.g., "scripts/hooks/edit-watcher.js")
 */
function relPath(filePath) {
  const abs = path.resolve(filePath);
  const proj = path.resolve(PROJECT);
  if (abs.startsWith(proj)) {
    return abs
      .slice(proj.length)
      .replace(/^[/\\]+/, "")
      .replace(/\\/g, "/");
  }
  return abs.replace(/\\/g, "/");
}

module.exports = { PROJECT, relPath, PATHS };
