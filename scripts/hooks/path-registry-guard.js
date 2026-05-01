#!/usr/bin/env node
/**
 * path-registry-guard.js — PreToolUse Bash hook (Phase 2C).
 *
 * Mirror of framework-manifest-guard.js for the path registry. Fires on
 * `git commit`. If `warpos/paths.registry.json` is staged, the generated
 * artifacts must also be staged in the same commit:
 *
 *   - .claude/paths.json
 *   - scripts/hooks/lib/paths.generated.js
 *   - scripts/path-lint.rules.generated.json
 *   - schemas/paths.schema.json
 *   - docs/04-architecture/PATH_KEYS.md
 *
 * Goal: prevent the registry and its derived artifacts from drifting
 * out of sync. The build is fast and idempotent; running it before
 * commit is the canonical workflow.
 *
 * Symmetric: if a generated artifact is staged WITHOUT the registry,
 * also block — that means a hand-edit slipped past build.js.
 *
 * Kill switch: PATH_REGISTRY_GUARD=off
 */

const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const REGISTRY_FILE = "warpos/paths.registry.json";
const GENERATED_FILES = [
  ".claude/paths.json",
  "scripts/hooks/lib/paths.generated.js",
  "scripts/path-lint.rules.generated.json",
  "schemas/paths.schema.json",
  "docs/04-architecture/PATH_KEYS.md",
];

if (process.env.PATH_REGISTRY_GUARD === "off") process.exit(0);

// Skip if registry doesn't exist (project doesn't use the registry yet)
if (!fs.existsSync(path.join(PROJECT_DIR, REGISTRY_FILE))) process.exit(0);

function block(reason) {
  try {
    const { logEvent } = require("./lib/logger");
    logEvent("block", "system", "path-registry-guard", "", reason);
  } catch {
    /* skip logging */
  }
  console.log(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
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

    const registryStaged = staged.includes(REGISTRY_FILE);
    const stagedGenerated = staged.filter((f) => GENERATED_FILES.includes(f));

    // Case 1: registry staged → all generated artifacts must also be staged.
    if (registryStaged) {
      const missing = GENERATED_FILES.filter((f) => !staged.includes(f));
      if (missing.length > 0) {
        // Verify whether the missing artifacts are actually current. If
        // they're current and unchanged, the user just didn't need to
        // re-stage them — let it pass. If they're stale, block.
        const result = spawnSync(
          process.execPath,
          [path.join(PROJECT_DIR, "scripts", "paths", "build.js"), "--check"],
          { cwd: PROJECT_DIR, encoding: "utf8" },
        );
        if (result.status !== 0) {
          block(
            [
              "path-registry-guard: warpos/paths.registry.json is staged,",
              "but generated artifacts are stale. Run:",
              "",
              "  node scripts/paths/build.js",
              "  git add " + GENERATED_FILES.join(" \\\n          "),
              "",
              "Generated files needing updates:",
              ...missing.map((f) => `  - ${f}`),
              "",
              "Set PATH_REGISTRY_GUARD=off to bypass (use sparingly).",
            ].join("\n"),
          );
        }
      }
    }

    // Case 2: any generated artifact staged WITHOUT the registry → that means
    // a hand-edit slipped past build.js. Block — must edit the registry instead.
    if (!registryStaged && stagedGenerated.length > 0) {
      // One escape hatch: if the user just ran build.js to commit a result
      // generated from the already-committed registry, the generator is the
      // source of truth — verify the staged content matches what build.js
      // would produce. If it does, allow.
      const result = spawnSync(
        process.execPath,
        [path.join(PROJECT_DIR, "scripts", "paths", "build.js"), "--check"],
        { cwd: PROJECT_DIR, encoding: "utf8" },
      );
      if (result.status !== 0) {
        block(
          [
            "path-registry-guard: generated path artifacts staged without",
            "warpos/paths.registry.json, AND they don't match what build.js",
            "would produce — looks like a hand-edit.",
            "",
            "Edit the registry, then run:",
            "",
            "  node scripts/paths/build.js",
            "  git add warpos/paths.registry.json " +
              GENERATED_FILES.join(" \\\n          "),
            "",
            "Staged generated files:",
            ...stagedGenerated.map((f) => `  - ${f}`),
            "",
            "Set PATH_REGISTRY_GUARD=off to bypass (use sparingly).",
          ].join("\n"),
        );
      }
    }
  } catch (e) {
    // Fail-open on parse errors
    process.exit(0);
  }
});
