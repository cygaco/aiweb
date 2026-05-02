# WarpOS 0.1.0 — 2026-04-30

First versioned baseline. Captures the state of the framework after Phases 1-3 of the 2026-04-30 framework-update plan landed.

## What's new since 0.0.0

### Phase 1 — Foundation (commit `ecdf8a3`)

- `warpos/paths.registry.json` — single source of truth for 50 path keys, with rich metadata (`kind`, `owner`, `aliases`, `deprecatedAliases`, `mutable`, `introducedIn`, `removedIn`, `replaces`, `docsToken`).
- `scripts/paths/build.js` — generates `.claude/paths.json`, `scripts/hooks/lib/paths.generated.js`, `scripts/path-lint.rules.generated.json`, `schemas/paths.schema.json`, and `docs/04-architecture/PATH_KEYS.md` from the registry. `--check` mode for staleness gating.
- `framework-manifest.json` schema bumped to v2 — every asset gains stable `id`, `sha256`, `mergeStrategy`, `owner`, `introducedIn`, `removedIn`, `replaces`. Generator now excludes `dispatch-backups/`, `retros/`, and per-project oneshot store.
- `framework-installed.json` schema v2 — captures `installedVersion`, `installedCommit`, `installedAt`, `source`, per-asset hashes, and `generated[]` array for per-project files.
<!-- path-literal-allowed: changelog historical reference (the rename source) -->
- Legacy `docs/05-features/` → `requirements/05-features/` (atomic move + 245 reference codemods across 119 files).

### Phase 2 — Enforcement (commit `094df7d`, fix-forward `11a329f`)

- `scripts/paths/gate.js` — 5-check path coherence gate wired into `framework-manifest-guard` for paths-related staged files.
- `scripts/hooks/path-guard.js` — strict for framework-owned files, warn-only for project files. Allow markers `<!-- path-literal-allowed: <reason> -->` (md) and `// path-literal-allowed: <reason>` (code).
- `scripts/hooks/path-registry-guard.js` — symmetric: registry-without-artifacts blocks, artifacts-without-registry blocks if hand-edited.
- Mode state machine — `scripts/mode-set.js` CLI + v2 marker schema (`enteredAt`, `enteredBy`, `allowedTransitions`, `activeBuild`, `lockOwner`).
- `$schema` field on every config + `scripts/schemas/validate.js` validator — green for all 5 configs.

### Phase 3 — Requirements drift management (commit `966c32d`)

- `scripts/requirements/` engine: 11 modules (config, graph-build, graph-load, resolve-impact, classify-drift, stage-rco, apply-rco, gate, status, review, initial-cleanup) + test-gate (14/14 passing).
- `requirements/_index/requirements.graph.json` (648 reqs · 15 features · 176 files · 6 contracts) + per-feature TRACE.md.
- `requirements/04-architecture/contracts/` — 6 shared contracts (SESSION, USER, WORKSPACE, PAYMENT, ROUTING, PERMISSIONS) drafted by gemini-3.1-pro-preview.
- Freshness Gate wired into `merge-guard.js` (both git merge and merge agent/* paths) and `/oneshot:preflight`.
- `req-reviewer` sub-agent (adhoc + oneshot mirrors) added to gauntlet.
- `validation-backlog-policy.md` — 30-day auto-expire rule with Class C exemption, drafted by codex/gpt-5.5.
- `schemas/change-plan.schema.json` — Phase 3J ChangePlan v1.

## Phase 4 (in progress, this release)

This capsule ships with the Phase 4 release/update/promote infrastructure: release capsules (4A), migration system (4B), `/warp:update` engine (4C), `/warp:promote` engine (4D), `/warp:release` (4E), `/warp:doctor` (4F), update + promote fixtures (4G), release gates (4H), `/warp:sync` deprecation alias (4I), generator exclusion list (4J), Class A/B/C update wiring (4K).

## Breaking changes

<!-- path-literal-allowed: breaking-change announcement names the removed path -->
- The legacy `docs/05-features/` location no longer exists — references must use `requirements/05-features/`. Codemod `003-docs-to-requirements` handles the rename automatically.
- `/warp:sync` is now a deprecation alias for `/warp:update`; behavior is unchanged but the canonical entry point is `/warp:update`.

## Known gaps

- `requirements/04-architecture/PRODUCTION_BASELINE.md` (Phase 6A) — not yet shipped.
- Hook-determinism fixture tests (Phase 5G) — partial.
- CI parity (`.github/workflows/test.yml`, Phase 5M) — not yet shipped.

## Migration path

From 0.0.0 → 0.1.0: run `/warp:update` (or `node scripts/warpos/update.js --apply`). The four migration modules execute in order; total expected time < 5 minutes on a clean clone.

From below 0.0.0: not supported. Earlier states had no version system at all and no migration metadata.
