# Upgrade notes — 0.2.x → 0.2.2 (and 0.1.x → 0.2.2)

## TL;DR

If you're on **0.1.x**, this is the release that actually performs the
`warpos/ → framework/`, `requirements/ → _requirements/`, `docs/ → _docs/`
migrations from 0.2.0 — they were never runnable through `update.js` before.
You **must** pass `--confirm-deletes` to see the cleanup land.

If you're already on **0.2.x**, this is a small fix release: the migration
loader is more robust, and `promote.js` no longer corrupts canonical's
`version.json`. Nothing on disk changes for you beyond the file-content
updates.

## Pre-flight (all consumers)

```bash
git tag pre-warpos-0.2.2-update HEAD
git status --porcelain   # must be empty
```

## Run the update

```bash
# Dry-run first (always)
node scripts/warpos/update.js --to 0.2.2 \
  --source ../WarpOS \
  --target . \
  --dry-run

# Apply
node scripts/warpos/update.js --to 0.2.2 \
  --source ../WarpOS \
  --target . \
  --apply --confirm-deletes
```

## What `--confirm-deletes` does (and why you want it on)

By default, `update.js` skips DELETE_SAFE entries and reports them as
`deletes_skipped`. That's safe but means stale paths (`warpos/`,
`requirements/`, `docs/` in your working tree) survive after the update.

Pass `--confirm-deletes` to actually unlink them. The contents of every
deleted file are first copied into
`.warpos/transactions/<tx-id>/backup/<orig-path>`, so anything you've
customized is recoverable via:

```bash
cp -R .warpos/transactions/<tx-id>/backup/<orig-path> ./<orig-path>
```

## Migration-conflict backups (0.1.x consumers only)

Migration 003 backs up the requirements-side version of each merged
framework dir before overwriting it with the docs-side version. Look for:

```
.warpos/transactions/<tx-id>/backup/conflicts/_requirements/01-design-system/
.warpos/transactions/<tx-id>/backup/conflicts/_requirements/02-copy-system/
.warpos/transactions/<tx-id>/backup/conflicts/_requirements/03-architecture/
.warpos/transactions/<tx-id>/backup/conflicts/_requirements/09-integrations/
.warpos/transactions/<tx-id>/backup/conflicts/_requirements/_audits/
.warpos/transactions/<tx-id>/backup/conflicts/_requirements/00-canonical/
```

If you customized any of these under their old `requirements/` location in
0.1.x, that customization lives in the conflicts backup. The active dir is
the docs-side version (richer, per 0.2.0 design intent). Diff and merge by
hand if you need to bring customizations forward.

## Verify after apply

```bash
# Should report installed at 0.2.2
cat .claude/framework-installed.json | grep installedVersion

# Should NOT find any of these (stale 0.1.x dirs)
test ! -d warpos
test ! -d requirements
test ! -d docs

# Should find these (0.2.0 layout)
test -d framework
test -d _requirements
test -d _docs
```

## Rollback

```bash
git reset --hard pre-warpos-0.2.2-update
```

(or restore individual files from `.warpos/transactions/<latest>/backup/`).

## Known caveats

- Two orphan tags `warpos@0.1.3` / `warpos@0.1.4` remain on origin from a
  failed 2026-05-04 release. They're below `v0.2.0` in semver, so consumer
  tooling that walks `git tag --sort=v:refname` skips them harmlessly. Do
  not check them out.
- This release intentionally skips backfilling the placeholder
  `changelog.md`/`upgrade-notes.md` inside the published 0.2.1 capsule.
  Editing a published capsule would change the checksum and break the
  install fixture; 0.2.2's notes cover both releases.
