#!/usr/bin/env node
/**
 * framework-manifest-guard.js — PreToolUse Bash hook.
 *
 * Fires on `git commit` commands. If the commit includes changes to files
 * the framework-manifest tracks, the manifest itself must also be staged
 * (or regenerate-and-stage first). Otherwise: block with a clear message.
 *
 * Goal: prevent "I added a new skill but forgot to regenerate the manifest"
 * → install gaps in the next release.
 *
 * Design: β DECIDE 2026-04-18 (0.91) — "guards that block, not guards that
 * mutate." This hook never runs the generator. It refuses the commit and
 * tells the user what to do.
 *
 * Only active inside the WarpOS repo itself. Detects via presence of
 * .claude/framework-manifest.json at CLAUDE_PROJECT_DIR root. In consumer
 * projects, the file does exist (copied during install), but framework
 * edits there aren't expected — so the guard still applies symmetrically.
 * Set WARPOS_MANIFEST_GUARD=off to disable globally.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const MANIFEST_PATH = path.join(
  PROJECT_DIR,
  ".claude",
  "framework-manifest.json",
);

// Kill switch for emergencies
if (process.env.WARPOS_MANIFEST_GUARD === "off") process.exit(0);

// Skip if this project doesn't have a framework-manifest (not WarpOS or
// pre-manifest install)
if (!fs.existsSync(MANIFEST_PATH)) process.exit(0);

// Dirs the manifest tracks. Edits under any of these require the manifest
// to be regenerated + staged.
const TRACKED_PREFIXES = [
  ".claude/agents/",
  ".claude/commands/",
  ".claude/project/reference/",
  ".claude/project/maps/",
  "scripts/hooks/",
  "scripts/tools/",
  "requirements/",
  "patterns/",
];
const TRACKED_TOP_LEVEL = [
  "scripts/path-lint.js",
  "scripts/dispatch-agent.js",
  "scripts/generate-maps.js",
  "scripts/generate-framework-manifest.js",
  "CLAUDE.md",
  "AGENTS.md",
];

// Phase 2A: paths-related files. When any of these are staged, also require
// scripts/paths/gate.js to pass. Reuses the same fail-closed semantics as
// the manifest staging check.
const PATHS_RELATED = [
  "warpos/paths.registry.json",
  ".claude/paths.json",
  "scripts/hooks/lib/paths.generated.js",
  "scripts/path-lint.rules.generated.json",
  "schemas/paths.schema.json",
  "docs/04-architecture/PATH_KEYS.md",
  "scripts/paths/build.js",
  "scripts/paths/gate.js",
];

function block(reason) {
  try {
    const { logEvent } = require("./lib/logger");
    logEvent("block", "system", "framework-manifest-guard", "", reason);
  } catch {
    /* skip logging */
  }
  console.log(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

function isTracked(relPath) {
  for (const prefix of TRACKED_PREFIXES) {
    if (relPath.startsWith(prefix)) return true;
  }
  return TRACKED_TOP_LEVEL.includes(relPath);
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    if (event.tool_name !== "Bash") process.exit(0);
    if (event.tool_response !== undefined) process.exit(0); // PostToolUse — skip

    const cmd = ((event.tool_input || {}).command || "").trim();
    if (!cmd) process.exit(0);
    if (!/\bgit\s+commit\b/.test(cmd)) process.exit(0);

    // Get staged files
    let staged = [];
    try {
      staged = execSync("git diff --cached --name-only", {
        cwd: PROJECT_DIR,
        encoding: "utf8",
      })
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {
      process.exit(0); // not a git repo or git unavailable — skip
    }

    const stagedTracked = staged.filter(isTracked);
    const stagedPaths = staged.filter((f) => PATHS_RELATED.includes(f));

    // Phase 2A: when paths-related files are staged, the path coherence
    // gate must pass before commit. Run it synchronously; block on failure.
    // Independent from manifest-staging check below — both can fire.
    if (stagedPaths.length > 0) {
      const { spawnSync } = require("child_process");
      const result = spawnSync(
        process.execPath,
        [path.join(PROJECT_DIR, "scripts", "paths", "gate.js")],
        { cwd: PROJECT_DIR, encoding: "utf8" },
      );
      if (result.status !== 0) {
        const out = (result.stdout || "").split("\n").slice(-12).join("\n");
        block(
          [
            "framework-manifest-guard: path coherence gate failed.",
            "Staged paths-related files require scripts/paths/gate.js to pass:",
            "",
            ...stagedPaths.map((f) => `  - ${f}`),
            "",
            "Gate output (tail):",
            out,
            "",
            "Fix the findings or run: node scripts/paths/build.js",
          ].join("\n"),
        );
      }
    }

    if (stagedTracked.length === 0) process.exit(0); // no tracked changes

    const manifestStaged = staged.includes(".claude/framework-manifest.json");

    if (manifestStaged) {
      // User knows what they're doing — trust them
      process.exit(0);
    }

    // Tracked assets changed but manifest not staged
    const list = stagedTracked.slice(0, 6).join("\n  - ");
    const extra =
      stagedTracked.length > 6
        ? `\n  ... and ${stagedTracked.length - 6} more`
        : "";
    block(
      [
        "framework-manifest-guard: staged changes to WarpOS-tracked assets,",
        "but .claude/framework-manifest.json is NOT staged. Regenerate it:",
        "",
        "  node scripts/generate-framework-manifest.js",
        "  git add .claude/framework-manifest.json",
        "",
        `Affected files (${stagedTracked.length}):`,
        `  - ${list}${extra}`,
        "",
        "Set WARPOS_MANIFEST_GUARD=off to bypass (use sparingly).",
      ].join("\n"),
    );
  } catch (e) {
    // Fail-open on parse errors — don't block the user for guard bugs
    process.exit(0);
  }
});
