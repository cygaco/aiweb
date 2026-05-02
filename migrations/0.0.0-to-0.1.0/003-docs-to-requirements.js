/**
 * 003-docs-to-requirements.js — git mv docs/05-features → requirements/05-features
 * + codemod 135 hardcoded references.
 *
 * Phase 4B migration. Class C (destructive — requires explicit ack).
 *
 * NOTE: this migration is REPLAY metadata. The actual move happened in Phase 1
 * commit ecdf8a3 against the WarpOS source repo. For projects upgrading FROM
 * an unversioned 0.0.0 install, this migration replays the move on their copy.
 * Idempotent: detects already-moved state and exits OK.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

module.exports = {
  id: "003-docs-to-requirements",
  from: "0.0.0",
  to: "0.1.0",
  description:
    "Move docs/05-features → requirements/05-features and codemod 135 hardcoded references. Idempotent.",
  destructive: true,

  async plan() {
    const oldDir = path.join(REPO_ROOT, "docs", "05-features");
    const newDir = path.join(REPO_ROOT, "requirements", "05-features");
    const oldExists = fs.existsSync(oldDir);
    const newExists = fs.existsSync(newDir);
    const ops = [];
    if (!oldExists && newExists) {
      ops.push({
        op: "noop",
        reason:
          "Already migrated — requirements/05-features/ exists, docs/05-features/ gone.",
      });
    } else if (oldExists && newExists) {
      ops.push({
        op: "merge_required",
        reason:
          "Both docs/05-features/ AND requirements/05-features/ exist — manual reconciliation needed before migration can proceed.",
        severity: "block",
      });
    } else if (oldExists) {
      // path-literal-allowed: this migration's entire purpose is to rewrite the legacy specs path; src/dest fields are data, not navigation
      ops.push({
        op: "git_mv",
        src: "docs/05-features",
        dest: "requirements/05-features",
      });
      ops.push({
        op: "git_mv",
        src: "docs/03-requirement-standards",
        dest: "requirements/_standards",
      });
      // path-literal-allowed: codemod target IS the legacy literal — replacing it is the migration
      ops.push({
        op: "codemod",
        pattern: "docs/05-features",
        replacement: "requirements/05-features",
        scope: "**/*.{md,json,js,ts}",
        reason:
          "Update 135 hardcoded references found across hooks/agents/commands/PRECEDENCE.json/framework-manifest.",
      });
    } else {
      // path-literal-allowed: migration script semantics describe the legacy source path
      ops.push({
        op: "noop",
        reason:
          "Neither legacy docs/05-features/ nor requirements/05-features/ found — nothing to migrate.",
      });
    }
    return ops;
  },

  async apply() {
    const plan = await this.plan();
    if (plan.some((o) => o.op === "merge_required")) {
      return {
        ok: false,
        error:
          "Both source and target directories exist — refusing to merge automatically. Reconcile manually.",
      };
    }
    if (plan.every((o) => o.op === "noop"))
      return { ok: true, planOnly: true, noop: true };

    try {
      // git mv operations
      for (const op of plan) {
        if (op.op === "git_mv") {
          execSync(`git mv "${op.src}" "${op.dest}"`, {
            cwd: REPO_ROOT,
            stdio: "pipe",
          });
        }
      }
      // Codemod is left for the caller (actual codemod happened in source repo
      // commit ecdf8a3; project copies need their own scan).
      return {
        ok: true,
        notes:
          "Filesystem move completed. Codemod of hardcoded references still required — run scripts/warpos/codemod-docs-to-requirements.js.",
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
};
