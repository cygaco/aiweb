# WarpOS 0.2.2 — 2026-05-04

Update-path repair release. Consumers on 0.1.x can finally jump straight to
0.2.2 with one `/warp:update` call and end up structurally clean.

## What's new since 0.2.1

### Migration loader actually walks the chain

`scripts/warpos/migrations-loader.js` now performs semver-aware chain walking.
Going from 0.1.2 → 0.2.2 used to look for the literal directory
`migrations/0.1.2-to-0.2.2/`, find nothing, and silently skip every migration.
The walker now resolves wildcard `from` patterns (e.g. `0.1.x`) and chains
through every applicable directory in order: `0.1.x-to-0.2.0/` runs, then any
later step, until the target is reached.

New exports: `listMigrationsBetween`, `listMigrationDirs`, `patternMatches`,
`compareSemver`. `listMigrations(from, to)` falls through to the chain walker
when an exact-pair directory is absent, so old call sites stay compatible.

### 0.1.x → 0.2.0 migrations now expose the loader contract

All four migration files under `migrations/0.1.x-to-0.2.0/` previously only
exported `{ main }`, which crashed `loadMigration()` (`missing required fields
(id, from, to)` / `must export plan() or apply()`). They now export
`{ id, from, to, description, apply, main }`. CLI mode (`node migrations/.../001-*.js`)
still works; loader mode (called from `update.js`) now also works.

### Migration 003 (docs/ → _docs/) is no longer conditional

The merge of `docs/01-design-system/` → `_requirements/01-design-system/`
(and the four siblings) used to be skipped whenever the destination already
existed (which it always did, because migration 002 renamed
`requirements/` → `_requirements/` first). Result: consumer ended up with
both `_requirements/01-design-system/` (lighter, from old requirements/)
AND `_docs/01-design-system/` (orphan from old docs/).

Migration 003 now applies the **docs-wins** policy intended at 0.2.0:
when both sides exist after migration 002 runs, the requirements/ version is
copied into `<update-tx>/backup/conflicts/<dest>/` (same backup dir update.js
already uses for DELETE_SAFE), then overwritten with the docs/ version. No
data loss; recoverable via the standard transaction-backup path.

### promote.js no longer ships product/version.json into canonical

`scripts/warpos/promote.js` removed `version.json` from its
`FRAMEWORK_PREFIXES` scope. On 2026-05-04 the prior behavior clobbered
canonical's 0.2.0 `version.json` with the product's stale 0.1.2, then
`/warp:release` bumped from the wrong base — published `warpos@0.1.3` and
`warpos@0.1.4` tags landed on remote before the issue was caught.
`version.json` is canonical-owned: bumped by `/warp:release`, propagated to
consumers via the framework-manifest snapshot in each capsule.

## Breaking changes

None for end consumers. The migration-loader contract change is internal —
no consumer code calls `loadMigration` directly.

## Schema changes

None. `framework-manifest/v2`, `paths/v5`, `hooks-registry/v1`,
`decision-policy/v1`, `version/v1` all unchanged.

## Migrations

None new in 0.2.2. The 0.1.x-to-0.2.0 migrations under `migrations/` now
actually execute when called from `update.js`.

## Known orphans

Two stale tags from the 2026-05-04 release misadventure remain on origin:
`warpos@0.1.3`, `warpos@0.1.4`. They point to interim release commits that
never landed on `main` and predate `v0.2.0`. Semver ordering means they
won't interfere with any consumer at 0.2.x. Leaving them in place rather
than rewriting published history.

## Pinned commit

Captured at release-build time (recorded in `release.json#commit`).
