# Upgrade notes — 0.1.0 → 0.1.1

Patch release. No migrations. No breaking changes. Safe to apply on any 0.1.0 install.

## Pre-flight (recommended, not mandatory)

1. **Tag your current state.** `git tag pre-warpos-0.1.1-update HEAD`. Used as the rollback anchor.
2. **Confirm clean working tree.** `git status --porcelain` empty (telemetry-only churn is allowed; the installer skips it).

Worktree drain is **not required** for this release — no destructive migrations.

## Run the update

```bash
node scripts/warpos/update.js --dry-run    # see the plan
node scripts/warpos/update.js --apply       # apply
```

`/warp:update` is the recommended entry point — the script is a thin wrapper.

## What runs

| Migration | Effect | Reversible |
|---|---|---|
| _(none)_ | No migrations declared in `release.json`. Update is framework-file sync + manifest re-snapshot only. | n/a |

## Post-update

```bash
node scripts/paths/build.js --check       # 0
node scripts/paths/gate.js                  # 0
node scripts/requirements/gate.js          # 0 (PASS) or 1 (yellow)
```

If `requirements/gate.js` returns 2 (red), stop — the spec is drifted; either rebuild the graph (`node scripts/requirements/graph-build.js`) or resolve open Class C RCOs before continuing.

## Rollback

```bash
git reset --hard pre-warpos-0.1.1-update
```

Because there are no migrations, rollback is a single `git reset` — no inverse-migration step needed.

## What changed for end-users

Nothing user-facing. Phase 4-6 work was internal quality-gate hardening; the new CLAUDE.md hygiene rule is an authoring guideline (no runtime impact). The session telemetry rollup is internal state.

## Notes

- 0.1.1 is the first non-baseline release. `previousVersions[]` in `version.json` is now `["0.1.0"]`.
- Framework-manifest version field bumps to `0.1.1`.
- One new `release_capsule` asset (this capsule) added to manifest counts (482 → 483).
