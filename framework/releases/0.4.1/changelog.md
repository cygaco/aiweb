# WarpOS 0.4.1 — 2026-05-11

Update-path UX fix. Restores the "just type `/warp:update --to <v>`"
ergonomics for product repos that have a sibling canonical clone.

## What's new since 0.4.0

### update.js auto-discovers canonical clones

`scripts/warpos/update.js` now walks for a canonical WarpOS clone when
`--source` is not passed AND the requested capsule isn't in the local
`framework/releases/`. Walk order:

1. Sibling `../WarpOS/`
2. Sibling `../warpos/`
3. `.claude/manifest.json#warpos.source` (if not an http URL)
4. `.claude/framework-installed.json#source` (recorded at install time)

First candidate that exists, has `version.json`, has `framework/`, and
has the target capsule wins. The engine prints
`[update] capsule <v> not in local framework/releases/ — using
canonical at <path>` to stderr so the user knows where the source came
from.

Pass `--no-discover` to disable the walk (closed-environment tests).

### /warp:update skill no longer pre-bails

The `.claude/commands/warp/update.md` skill used to check the local
`framework/releases/<v>/release.json` BEFORE calling the engine, and
listed local capsules if missing. That hid the engine's auto-discovery.
The skill now delegates the existence check to the engine.

### Why this matters

Before 0.4.1, a product repo with `framework/releases/0.2.2/` as its
newest capsule would refuse to run `/warp:update --to 0.4.0` because
the skill bailed before the engine ran. Users had to know about
`--source` and pass the canonical path manually. Now `/warp:update
--to <v>` works in product repos as long as the canonical lives at a
discoverable path.

## Bundled

0.4.1 ships everything in 0.4.0 (Sprint Workflow v0.1 + Phase 0
follow-ons) plus this UX fix. Consumers on 0.2.2 jump straight to
0.4.1.

## Migration

`0.2.2 → 0.4.1`. No migrations required (additive only). Same
post-update checks as 0.4.0:

```bash
node scripts/paths/build.js --check
node scripts/paths/gate.js
node scripts/hooks/build.js --check
node scripts/hooks/test.js
node scripts/sprint/validate.js
node scripts/sprint/routing.js validate
```

## Bootstrap note (one-time)

The product repo's CURRENT `update.js` (from when it was last
installed) doesn't have the auto-discovery yet. To bootstrap, run
`install.ps1 -Target <product-path> -SkipPrompt` once from the
canonical to refresh the product's update.js + capsules. After that,
future `/warp:update --to <v>` calls auto-discover the canonical
without any flag.

## See also

- `_docs/sprint/CHANGELOG_0.4.0.md` — Sprint Workflow v0.1 changelog.
- `framework/releases/0.4.0/changelog.md` — 0.4.0 release notes.
