# WarpOS 0.1.2 — 2026-05-01

Patch release. Closes the architecture-drift loop opened by the 2026-05-01
audit. No schema changes; no destructive migrations.

## What's new since 0.1.1

### Product-repo promotion safety

- `scripts/warpos/promote.js` no longer hardcodes "from-jobhunter" in the
  generated commit message. It reads the source repo's project slug from
  `.claude/manifest.json#project.slug` (or `package.json#name`) and uses
  that as the label. Same engine now works from any source repo.
- `/warp:promote` slash skill rewritten as generic source-→-canonical
  reconciler. References to the original source-repo name removed from
  prose; "this install" replaced with "this source repo / advanced WarpOS
  instance".
- Recommended next-action no longer auto-pushes; the user owns push timing.

### Installer derives paths.json from the registry

- `scripts/warp-setup.js` previously hand-rolled a stale `version: 3`
  paths object that was missing `requirementsRoot`, `specsRoot`,
  `decisionLedger`, and `providerTrace` keys (registry was already at v4).
  New installs now generate `.claude/paths.json` from
  `warpos/paths.registry.json` via the new
  `scripts/paths/lib/registry.js` helper.
- Per-project `.claude/manifest.json` `warpos.version` is now stamped from
  `version.json`, not the hardcoded "0.1.0" string.

### Hook registry

- New `warpos/hooks.registry.json` is the single source of truth for hook
  identity, registration, fail-mode, and fixture coverage.
- New `scripts/hooks/build.js` derives both
  `scripts/hooks/hook-manifest.json` and the hooks block of
  `.claude/settings.json` from the registry.
- `scripts/warp-setup.js` reads the registry to build target settings.json
  hooks — no more hand-coded `hookConfig` in the installer.
- `scripts/hooks/test.js` upgraded to a four-rule registry contract:
  registry-enabled hooks must exist as scripts; fail-closed hooks with
  `fixturesRequired` must list ≥1 fixture; settings.json must agree with
  the registry; hook-manifest.json must agree with the registry.

### Update engine fixes

- `findRepoRootFromCapsule()` walks up from `warpos/releases/<v>/` looking
  for `version.json + .claude + warpos/`, instead of the previous
  brittle `..`/`..` resolution that landed at `warpos/`. Cross-repo
  updates now load source files from the right tree.
- `--source <path>` and `--target <path>` flags added so update.js can
  drive a foreign-target install (canonical → product repo).
- Migrations listed in `release.json` are now actually executed via
  `migrations-loader.applyAll()`. Previously they were counted but never
  run.
- `release.json#postUpdateChecks` are now actually executed inside the
  target tree. Status is reported as `passed | failed | degraded` per
  check (degraded = check could not run automatically, e.g. missing
  script). Update overall ok flag now reflects post-check failures.
- Apply mode writes a transaction record to
  `.warpos/transactions/<id>/` containing `header.json`, `plan.json`,
  `capsule.json`, file backups (for every file overwritten or deleted),
  `result.json`, and a `ROLLBACK.md` recovery guide.
- `MERGE_SAFE` no longer means "copy upstream over local." Locally
  customized files are now classified `MERGE_CONFLICT` (Class C) until a
  real three-way merger lands. Previous behavior pretended a merge had
  happened and silently overwrote user edits.

### Path enforcement strictness

- `scripts/path-lint.js` extension coverage extended from
  `{md, js, json}` to also include `cjs, mjs, ts, tsx, sh, ps1, yml,
  yaml`. Hardcoded paths in TypeScript config or PowerShell install
  scripts are now visible to the linter.
- New `path-literal-allowed` per-line escape marker for legitimate
  examples (changelogs naming the renamed literal, etc.).

### Stale spec-path cleanup

<!-- path-literal-allowed: changelog naming the deprecated alias for context -->
- `scripts/hooks/spec-test-staleness.js` previously matched the <!-- path-literal-allowed: explaining the rename -->
  pre-rename `docs/05-features/.../*.md` regex; the rename to
  `requirements/05-features` (Phase 1 final-A) made the hook silently
  no-op for current spec edits. Now resolves `paths.specsRoot` from the
  path registry.

### /warp:sync deprecated

- `.claude/commands/warp/sync.md` is now a deprecation alias only —
  forwards to `/warp:update`. README and USER_GUIDE list `/warp:update`
  as the primary command.

### Honest release gates

- `scripts/warpos/release-gates.js` gate 3 (`reference_integrity`)
  previously returned green unconditionally with a comment that the real
  check needed a running Claude Code agent. Now returns
  `severity: "manual"` (does not block) so the lie is gone but releases
  do not break.
- New severities `manual | skipped | degraded` recognized by the runner
  alongside the existing `green | yellow | red`. Critical gates that
  cannot run automatically surface as `manual` or `degraded`, never as
  `green`.

## Breaking changes

None. Two soft behaviour changes worth noting:

- `MERGE_SAFE` files that previously got silent-overwritten are now
  `MERGE_CONFLICT` (Class C). Apply will refuse until each is resolved.
  Use `/warp:doctor` or `git status` to inspect before re-running.
- New installs receive a v4 paths.json (was v3). Existing installs are
  not migrated automatically — run `node scripts/paths/build.js` in the
  target install or wait for `/warp:update --apply` to regenerate.

## Schema changes

- New: `warpos/hooks-registry/v1` (`warpos/hooks.registry.json`).
- Unchanged: `warpos/framework-manifest/v2`, `warpos/paths/v4`,
  `warpos/decision-policy/v1`, `warpos/release/v1`.

## Migrations

None. 0.1.0/0.1.1 → 0.1.2 is a no-migration update.

## Pinned commit

Captured at release-build time (recorded in `release.json#commit` after
`scripts/warpos/release-build.js` runs).
