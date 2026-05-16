#!/usr/bin/env node
/**
 * framework-manifest-guard.js — PreToolUse Bash hook.
 *
 * Fires on `git commit` commands. If the commit includes changes to files
 * the framework-manifest tracks, the manifest itself must also be staged
 * (or regenerate-and-stage first). Otherwise: block (canonical) or warn
 * (product with gitignored .claude/) with a clear message.
 *
 * Goal: prevent "I added a new skill but forgot to regenerate the manifest"
 * → install gaps in the next release.
 *
 * Design: β DECIDE 2026-04-18 (0.91) — "guards that block, not guards that
 * mutate." This hook never runs the generator. It refuses the commit and
 * tells the user what to do.
 *
 * Phase 0 workstream G — canonical-vs-product detection:
 *   The hook now distinguishes:
 *     - canonical WarpOS framework clone (full block on missing manifest stage)
 *     - product install with .claude/ gitignored (warn-only; cannot stage)
 *     - product install without gitignored .claude/ (block, like canonical)
 *
 *   Escape hatches:
 *     - env: WARPOS_MANIFEST_GUARD=off (set in the harness env, not Bash-inline)
 *     - sentinel: .warpos/manifest-guard-disable on disk (gitignored escape)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const MANIFEST_PATH = path.join(
  PROJECT_DIR,
  ".claude",
  "framework-manifest.json",
);
const FRAMEWORK_INSTALLED_PATH = path.join(
  PROJECT_DIR,
  ".claude",
  "framework-installed.json",
);
const SENTINEL_PATH = path.join(
  PROJECT_DIR,
  ".warpos",
  "manifest-guard-disable",
);

// Kill switch for emergencies (harness env, not Bash-inline)
if (process.env.WARPOS_MANIFEST_GUARD === "off") process.exit(0);

// Repo-local sentinel escape hatch — log every bypass for audit.
if (fs.existsSync(SENTINEL_PATH)) {
  try {
    const { logEvent } = require("./lib/logger");
    logEvent(
      "bypass",
      "system",
      "framework-manifest-guard-sentinel",
      "",
      ".warpos/manifest-guard-disable present",
    );
  } catch {
    /* logger optional */
  }
  process.exit(0);
}

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
  "_requirements/",
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
  "framework/paths.registry.json",
  ".claude/paths.json",
  "scripts/hooks/lib/paths.generated.js",
  "scripts/path-lint.rules.generated.json",
  "schemas/paths.schema.json",
  "_requirements/03-architecture/PATH_KEYS.md",
  "scripts/paths/build.js",
  "scripts/paths/gate.js",
];

// ── Canonical vs product detection (Phase 0 workstream G) ─────────────
//
// Canonical signals:
//   - version.json AND install.ps1 AND scripts/generate-framework-manifest.js
//     present at PROJECT_DIR root.
//   - .claude/framework-installed.json is ABSENT (canonical is the source of
//     truth, not an installed snapshot).
// Otherwise treat as product install. If product has .claude/ in
// .gitignore, the manifest cannot be staged — switch to warn-only.

function detectInstallKind() {
  const hasCanonicalMarkers =
    fs.existsSync(path.join(PROJECT_DIR, "version.json")) &&
    fs.existsSync(path.join(PROJECT_DIR, "install.ps1")) &&
    fs.existsSync(
      path.join(PROJECT_DIR, "scripts", "generate-framework-manifest.js"),
    );
  const hasInstalledSnapshot = fs.existsSync(FRAMEWORK_INSTALLED_PATH);
  if (hasCanonicalMarkers && !hasInstalledSnapshot) return "canonical";
  return "product";
}

function isClaudeGitignored() {
  try {
    const gi = fs.readFileSync(path.join(PROJECT_DIR, ".gitignore"), "utf8");
    return /\b\.claude\/?\s*$/m.test(gi) || /^\.claude\b/m.test(gi);
  } catch {
    return false;
  }
}

const INSTALL_KIND = detectInstallKind();
const CLAUDE_IGNORED = INSTALL_KIND === "product" && isClaudeGitignored();

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

function warn(reason) {
  try {
    const { logEvent } = require("./lib/logger");
    logEvent("warn", "system", "framework-manifest-guard", "", reason);
  } catch {
    /* skip logging */
  }
  process.stderr.write("[framework-manifest-guard] " + reason + "\n");
  process.exit(0);
}

function bypassMessage() {
  return [
    "",
    "Bypass (use sparingly — every bypass is logged):",
    "  PowerShell (current process):",
    "    $env:WARPOS_MANIFEST_GUARD = 'off'; <git command>; Remove-Item Env:WARPOS_MANIFEST_GUARD",
    "  bash (NOTE: Bash-inline `VAR=val cmd` may not reach PreToolUse hooks —",
    "  set in the harness env or use the sentinel):",
    "    export WARPOS_MANIFEST_GUARD=off && <git command> && unset WARPOS_MANIFEST_GUARD",
    "  Repo-local sentinel (gitignore-safe; bypass is logged):",
    "    mkdir -p .warpos && touch .warpos/manifest-guard-disable",
  ].join("\n");
}

function isTracked(relPath) {
  for (const prefix of TRACKED_PREFIXES) {
    if (relPath.startsWith(prefix)) return true;
  }
  return TRACKED_TOP_LEVEL.includes(relPath);
}

function manifestFreshEnough(stagedTracked) {
  try {
    const manifestStat = fs.statSync(MANIFEST_PATH);
    const manifestMtimeMs = manifestStat.mtimeMs;
    let newestStaged = 0;
    for (const f of stagedTracked) {
      try {
        const s = fs.statSync(path.join(PROJECT_DIR, f));
        if (s.mtimeMs > newestStaged) newestStaged = s.mtimeMs;
      } catch {
        /* skip files git is about to remove */
      }
    }
    // Allow ~60s skew between editor save and manifest regen.
    return manifestMtimeMs + 60_000 >= newestStaged;
  } catch {
    return false;
  }
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
            bypassMessage(),
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

    const list = stagedTracked.slice(0, 6).join("\n  - ");
    const extra =
      stagedTracked.length > 6
        ? `\n  ... and ${stagedTracked.length - 6} more`
        : "";

    // Phase 0 workstream G: product install with .claude/ gitignored cannot
    // stage the manifest. Switch to fresh-on-disk verification + warn.
    if (CLAUDE_IGNORED) {
      if (manifestFreshEnough(stagedTracked)) {
        // On-disk manifest is newer than the staged tracked edits — fine.
        process.exit(0);
      }
      warn(
        [
          "Staged WarpOS-tracked changes detected, .claude/ is gitignored, and the",
          "on-disk framework-manifest is older than your edits.",
          "",
          `Affected files (${stagedTracked.length}):`,
          `  - ${list}${extra}`,
          "",
          "Regenerate the manifest before pushing so /warp:update consumers",
          "stay honest:",
          "  node scripts/generate-framework-manifest.js",
          "",
          "(Warn-only because product .claude/ is gitignored; the manifest",
          "cannot be tracked here.)",
        ].join("\n"),
      );
    }

    // Canonical, or product without gitignored .claude/: block.
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
        `Install kind: ${INSTALL_KIND} (claude_gitignored=${CLAUDE_IGNORED})`,
        bypassMessage(),
      ].join("\n"),
    );
  } catch (_e) {
    // Fail-open on parse errors — don't block the user for guard bugs
    process.exit(0);
  }
});
