/**
 * 001-path-registry-v4.js — Regenerate .claude/paths.json from
 * warpos/paths.registry.json. Idempotent regenerator.
 *
 * Phase 4B migration. Class A (mechanical regenerate).
 */

const path = require("path");
const { execSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

module.exports = {
  id: "001-path-registry-v4",
  from: "0.0.0",
  to: "0.1.0",
  description:
    "Rebuild .claude/paths.json from warpos/paths.registry.json with $schema warpos/paths/v4.",
  destructive: false,

  async plan() {
    return [
      {
        op: "regenerate",
        target: ".claude/paths.json",
        via: "scripts/paths/build.js",
        reason:
          "Schema bumped to warpos/paths/v4 — derived artifact must be rebuilt.",
      },
      {
        op: "regenerate",
        target: "scripts/hooks/lib/paths.generated.js",
        via: "scripts/paths/build.js",
        reason: "Companion artifact of paths.registry.json — derived.",
      },
      {
        op: "regenerate",
        target: "scripts/path-lint.rules.generated.json",
        via: "scripts/paths/build.js",
        reason: "Lint-rule artifact — derived.",
      },
      {
        op: "regenerate",
        target: "schemas/paths.schema.json",
        via: "scripts/paths/build.js",
        reason: "JSONSchema validator — derived.",
      },
      {
        op: "regenerate",
        target: "docs/04-architecture/PATH_KEYS.md",
        via: "scripts/paths/build.js",
        reason: "Human-readable reference — derived.",
      },
    ];
  },

  async apply() {
    try {
      execSync("node scripts/paths/build.js", {
        cwd: REPO_ROOT,
        stdio: "pipe",
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
};
