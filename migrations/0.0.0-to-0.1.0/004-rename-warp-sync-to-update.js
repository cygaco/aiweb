/**
 * 004-rename-warp-sync-to-update.js — Rewrite /warp:sync as a deprecation alias
 * for /warp:update.
 *
 * Phase 4B migration. Class A (mechanical rewrite). Idempotent.
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SYNC_FILE = path.join(
  REPO_ROOT,
  ".claude",
  "commands",
  "warp",
  "sync.md",
);

const ALIAS_BODY = `---
description: "Deprecation alias for /warp:update — kept so existing references and muscle memory keep working."
user-invocable: true
---

# /warp:sync — DEPRECATED, use /warp:update

This skill is a one-line wrapper that calls \`/warp:update\` with the same
arguments. The canonical entry point is **/warp:update**.

\`/warp:sync\` was the original name for "pull latest WarpOS into this project."
Phase 4 split that operation into update (apply incoming) + promote (push
outgoing), with /warp:update being the canonical update path. The old name
remains so docs, READMEs, and habit don't break — but expect a removal at
warpos@1.0.0.

## Behavior

Forward to /warp:update with all arguments preserved.

## Migration

If you want the old "fetch + apply in one step" behavior, that's exactly
what /warp:update does by default. No flag changes are required.

If you want only the new outbound direction (this repo → WarpOS canonical),
you want /warp:promote instead — /warp:sync was never that.
`;

module.exports = {
  id: "004-rename-warp-sync-to-update",
  from: "0.0.0",
  to: "0.1.0",
  description:
    "Rewrite .claude/commands/warp/sync.md as a deprecation alias that forwards to /warp:update.",
  destructive: false,

  async plan() {
    if (!fs.existsSync(SYNC_FILE)) {
      return [
        {
          op: "noop",
          reason:
            ".claude/commands/warp/sync.md does not exist — nothing to alias.",
        },
      ];
    }
    const current = fs.readFileSync(SYNC_FILE, "utf8");
    if (current.includes("# /warp:sync — DEPRECATED")) {
      return [
        {
          op: "noop",
          reason:
            "Already aliased — sync.md already declares the deprecation header.",
        },
      ];
    }
    return [
      {
        op: "rewrite",
        target: ".claude/commands/warp/sync.md",
        reason:
          "Replace original sync.md body with deprecation alias forwarding to /warp:update.",
      },
    ];
  },

  async apply() {
    const plan = await this.plan();
    if (plan.every((o) => o.op === "noop"))
      return { ok: true, planOnly: true, noop: true };
    fs.writeFileSync(SYNC_FILE, ALIAS_BODY);
    return { ok: true };
  },
};
