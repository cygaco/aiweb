/**
 * 002-framework-manifest-v2.js — Regenerate .claude/framework-manifest.json
 * with v2 schema (id, sha256, mergeStrategy, owner, introducedIn, removedIn,
 * replaces).
 *
 * Phase 4B migration. Class A (mechanical regenerate).
 */

const path = require("path");
const { execSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

module.exports = {
  id: "002-framework-manifest-v2",
  from: "0.0.0",
  to: "0.1.0",
  description:
    "Regenerate .claude/framework-manifest.json with v2 schema (id, sha256, mergeStrategy, owner, introducedIn, removedIn, replaces).",
  destructive: false,

  async plan() {
    return [
      {
        op: "regenerate",
        target: ".claude/framework-manifest.json",
        via: "scripts/generate-framework-manifest.js",
        reason:
          "Schema bumped to warpos/framework-manifest/v2 — derived artifact must be rebuilt.",
      },
    ];
  },

  async apply() {
    try {
      execSync("node scripts/generate-framework-manifest.js", {
        cwd: REPO_ROOT,
        stdio: "pipe",
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
};
