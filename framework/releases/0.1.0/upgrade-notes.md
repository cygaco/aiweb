# Upgrade notes — 0.0.0 → 0.1.0

## Pre-flight (mandatory)

1. **Tag your current state.** `git tag pre-warpos-0.1.0-update HEAD`. Used as the rollback anchor.
2. **Drain or tag every active worktree.** `/warp:doctor --worktrees` lists them; act on each before proceeding (merge / archive / freeze).
3. **Confirm clean working tree.** `git status --porcelain` empty (telemetry-only churn is allowed; the installer skips it).

## Run the update

```bash
node scripts/warpos/update.js --dry-run    # see the plan
node scripts/warpos/update.js --apply       # apply
```

`/warp:update` is the recommended entry point — the script is a thin wrapper.

## What runs

| Migration | Effect | Reversible |
|---|---|---|
| 001-path-registry-v4 | Regenerates `.claude/paths.json` from `warpos/paths.registry.json`. Adds `$schema: warpos/paths/v4`. | yes (regenerator only — paths are derived) |
| 002-framework-manifest-v2 | Regenerates `.claude/framework-manifest.json` with new asset metadata. | yes |
| 003-docs-to-requirements | `git mv` legacy specs root to `requirements/05-features`; codemod 135 hardcoded references (literal old path used inside the migration script, not in this changelog). <!-- path-literal-allowed: changelog historical reference --> | no — requires manual revert via the rollback tag |
| 004-rename-warp-sync-to-update | Rewrites `.claude/commands/warp/sync.md` as a deprecation alias to `/warp:update`. | yes (rewrite) |

## Post-update

```bash
node scripts/paths/build.js --check       # 0
node scripts/paths/gate.js                  # 0
node scripts/requirements/gate.js          # 0 (PASS) or 1 (yellow)
```

If `requirements/gate.js` returns 2 (red), stop — the spec is drifted; either rebuild the graph (`node scripts/requirements/graph-build.js`) or resolve open Class C RCOs before continuing.

## Rollback

```bash
git reset --hard pre-warpos-0.1.0-update
```

Reverses the entire update. Verify by checking `framework-manifest.json` reports `version: "0.0.0"` (or whatever your tag's version was) and `requirements/_index/` no longer exists.

## Notes

- The 003 migration is the only destructive one. It moves files and rewrites references. The git tag is your safety net.
- Migrations 001, 002, 004 are safe to re-run — they're regenerators / rewrites with deterministic output.
- If the update is interrupted between migrations, re-running picks up where it left off (each migration writes a per-step success marker).
