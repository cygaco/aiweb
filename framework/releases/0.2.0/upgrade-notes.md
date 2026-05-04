# Upgrade notes — WarpOS 0.1.4 → 0.2.0

This is a **structural breaking** release. Top-level directories rename and the paths schema bumps v4→v5. Read before running `/warp:update --to 0.2.0 --apply`.

## Pre-flight

1. **Commit or stash WIP first.** The migration `git mv`s touch hundreds of files; an unclean tree will produce a chaotic merge state.
2. **Tag your current state**: `git tag pre-warpos-0.2.0` so rollback is one command.
3. **Close in-flight worktrees**: any `.worktrees/wt-*/` sub-checkouts hold stale `paths.research`/`paths.karpathyRuns` cached at install time — abort them before upgrading.

## What the migration does

Idempotent; detects already-applied state and no-ops each step.

```
1. warpos/ → framework/                      (top-level rename)
2. requirements/03-requirement-standards/    (deleted — duplicate of _standards/)
3. requirements/04-architecture → 03-architecture, then 05→04 ... 09→08, 99-audits→_audits
4. requirements/ → _requirements/            (top-level rename)
5. docs/99-resources/{user-communication,research,karpathy-autoresearch}/ → docs/* (lift carve-outs)
6. docs/{00-canonical,01-design-system,02-copy-system,04-architecture,06-integrations,audit-reports}/
   → _requirements/* (merge framework-side docs back into requirements)
7. docs/ → _docs/                            (top-level rename)
8. .claude/paths.json                        (v4 values rewritten + 6 new keys added)
```

## After the upgrade

Run the post-update checks (auto-invoked, but confirm):

```
node scripts/paths/gate.js
node scripts/checks/warpos-structure-parity.js
node scripts/checks/warpos-promote-scope.js
```

All three should be GREEN. If any are RED, the migration left a step incomplete — file an issue with the failing check output.

## Rollback

`git reset --hard pre-warpos-0.2.0`. The transactional update under `.warpos/transactions/<timestamp>-warp-update-*/` also keeps a backup of every modified file; manual rollback from there if needed.

## Consumer code that hardcoded paths

The migration handles framework code. Project code (your `src/`, `services/backend/`, etc.) that hardcoded `requirements/05-features/...` or `docs/04-architecture/...` must be updated by hand or with a one-shot codemod. Reference: `scripts/one-off/codemod-track-b2-b3.js` (regex-based with negative lookbehind to avoid double-prefixing).

## Why now

The 2026-05-03 audit found:
- `requirements/` was easy to lose visually amid `node_modules/`, `next.config.ts`, etc.
- `warpos/` (visible) and `.warpos/` (hidden) and `scripts/warpos/` were visually indistinguishable
- `docs/` had become a forked copy of `requirements/` (more complete in places, less in others)
- promote.js silently dropped any change to `requirements/` or `docs/` because they weren't in `FRAMEWORK_PREFIXES`

This release closes all four of those.
