# Upgrade notes — 0.1.0/0.1.1 → 0.1.2

Patch release. No migrations. No breaking schema changes. Safe to apply on any
0.1.0 or 0.1.1 install.

## Pre-flight

1. Tag your current state: `git tag pre-warpos-0.1.2-update HEAD`. Used as
   the rollback anchor in addition to the transaction backup.
2. Confirm clean working tree: `git status --porcelain` empty.

## Run the update

```bash
# Dry-run first — produces a plan, no writes:
node scripts/warpos/update.js --to 0.1.2 \
  --source ../WarpOS \
  --target . \
  --dry-run

# Apply when the plan looks right:
node scripts/warpos/update.js --to 0.1.2 \
  --source ../WarpOS \
  --target . \
  --apply
```

`/warp:update` is the recommended entry point — the script is a thin wrapper.

If you previously used `/warp:sync`, switch to `/warp:update`. The `sync` slash
skill is now a deprecation forward.

## What runs at apply time

| Step | Effect | Reversible |
|---|---|---|
| Transaction record | Writes `.warpos/transactions/<id>/` with plan + per-file backups before any write | yes — see ROLLBACK.md inside the transaction |
| File copy | Class A files copied/updated from the canonical source tree | yes — backup folder restores prior state |
| Migrations | Run `migrations-loader.applyAll(0.1.x → 0.1.2, ctx)` | depends on each migration |
| Post-update checks | Execute `release.json#postUpdateChecks` inside the target tree | n/a (read-only) |
| Snapshot | Update `.claude/framework-installed.json` to record new version | yes — backup folder includes prior snapshot |

For 0.1.2 specifically: no migrations. Post-update checks are
`paths/build.js --check`, `paths/gate.js`, `hooks/build.js --check`,
`hooks/test.js`.

## Behaviour changes worth noticing

### MERGE_SAFE became MERGE_CONFLICT for customized files

Pre-0.1.2, locally customized files with `mergeStrategy: three_way_markdown`
were classified `MERGE_SAFE` and the apply path silently overwrote them with
upstream while reporting "merged." 0.1.2 classifies them `MERGE_CONFLICT`
(Class C). Apply refuses until each Class C item is resolved.

If your dry-run plan shows new Class C entries, that's why. Resolve by:
- accepting upstream (`git checkout --theirs <path>` after a manual merge),
- preserving local (`git checkout --ours <path>`), or
- removing your local edit and re-running `/warp:update --apply`.

### New paths.json keys may surface

If your install was created before 0.1.2, your `.claude/paths.json` may be at
`version: 3`. Either:

- run `node scripts/paths/build.js` in the install to regenerate at v4, or
- let the apply path's post-update check (`paths/build.js --check`) flag the
  drift and rerun.

## Post-update verification

The apply path runs these automatically — listed here so you can rerun
manually if needed:

```bash
node scripts/paths/build.js --check
node scripts/paths/gate.js
node scripts/hooks/build.js --check
node scripts/hooks/test.js
```

Then:

```bash
node scripts/warpos/release-gates.js
/warp:doctor
```

## Rollback

Three options, in order of preference:

1. **Transaction restore** — copy files from
   `.warpos/transactions/<latest>/backup/` back into place (see ROLLBACK.md
   inside the transaction directory).
2. **Git tag reset** — `git reset --hard pre-warpos-0.1.2-update`.
3. **Re-run update with prior version** — once 0.1.1 capsule is still on
   disk, `node scripts/warpos/update.js --to 0.1.1 --apply` re-installs the
   prior capsule.

## What changed for end-users

Nothing user-facing in product code. WarpOS framework behaviour changes are:

- `/warp:promote` works from any source repo (not just the original one).
- `/warp:update --apply` writes a transaction record before mutating files.
- `/warp:update` reports honest categories — no more silent overwrites of
  customized files.
- `/warp:sync` is now a deprecated alias; use `/warp:update`.
- `/warp:doctor` should be run after every apply.
