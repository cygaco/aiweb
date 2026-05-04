# WarpOS 0.2.0 — 2026-05-03

Minor bump (breaking) — structural rename pass closing the docs/requirements/warpos naming-confusion class identified in the 2026-05-03 audit.

## What's new since 0.1.4

- **`requirements/` → `_requirements/`** — underscore-prefix sorts the spec dir to the top of project-root listings, alongside `.claude/`. Resolves "spec home is hard to find" feedback.
- **`docs/` → `_docs/`** — same treatment for the docs dir.
- **`warpos/` → `framework/`** — JTBD-clear naming for the distribution capsules + canonical registries. Removes visual ambiguity with `.warpos/` (per-install state) and `scripts/warpos/` (machinery).
- **Renumber requirements chapters** so the deleted `03-requirement-standards/` (duplicate of `_standards/`) doesn't leave a gap: `04-architecture` → `03-architecture`, `05-features` → `04-features`, `06-operations` → `05-operations`, `07-security` → `06-security`, `08-testing` → `07-testing`, `09-automation` → `08-automation`, `99-audits` → `_audits` (collapsed to underscore-meta).
- **New chapter `_requirements/09-integrations/`** at the freed top slot (was `docs/06-integrations/`).
- **Merged `docs/*` framework dirs back into `_requirements/*`** (`docs/00-canonical`, `01-design-system`, `02-copy-system`, `04-architecture`, `audit-reports` all consolidate). Final `_docs/` contains only the three carve-outs: user-communication, research, karpathy-auto-research.
- **`scripts/warpos/promote.js` FRAMEWORK_PREFIXES expanded** to include `_requirements/`, `_docs/`, `framework/` so structural changes finally propagate (closes the silent-drop bug that blocked all prior `requirements/`-shape changes from reaching consumers).
- **6 new `paths.json` keys**: `architectureRoot`, `designSystemRoot`, `auditsRoot`, `integrationsRoot`, `docsRoot`, `frameworkRoot` — replace the most-hardcoded literals downstream.
- **10 new `/check:warpos-*` skills** for staleness/structure regression prevention: `warpos-staleness`, `warpos-tracked-transients`, `warpos-applied-migrations`, `warpos-promote-scope`, `warpos-structure-parity` (5 fully implemented), plus `warpos-roundtrip`, `warpos-manifest-honesty`, `warpos-promote-coverage`, `warpos-migration-coverage`, `warpos-path-resolution` (5 stubs designed; refine via `/reasoning:run`).
- **`.gitignore` template additions** distributed via the framework: `.warpos/`, `qa-*.png`, `runtime/qa-*/`, `runtime/research/`, `runtime/logs/`, `.claude/.session-start-commit`, `.claude/agents/store.json`, `.claude/project/maps/.stale.json`.

## Breaking changes

1. **Top-level directory renames** affect every consumer's hardcoded path references. Migration scripts handle the file moves; consumer-side code referencing `requirements/`, `docs/`, or `warpos/` must be updated to the new names. The bundled migrations cover the framework's own scripts; project code that hardcoded these paths needs a one-time codemod (the source codemod is shipped under `scripts/one-off/codemod-track-b2-b3.js` for reference).
2. **paths schema v4 → v5** — old paths.json values (`requirements/04-features` etc.) are rewritten by `migrations/004-paths-schema-v4-to-v5.js`. Custom keys in consumer paths.json are preserved; old `requirements/X` and `docs/X` values are auto-prefixed with `_`.
3. **Promote scope expansion** — first promote run after upgrade may surface previously-invisible drift in `_requirements/` / `_docs/` (file content that was edited locally but never propagated). Expected and addressable via `/warp:promote --apply`.

## Schema changes

- `pathRegistrySchema`: `warpos/paths/v4` → `warpos/paths/v5`
- All other schemas unchanged.

## Migrations

`migrations/0.1.x-to-0.2.0/`:

1. `001-rename-warpos-to-framework.js` — `git mv warpos framework`
2. `002-rename-requirements-to-_requirements.js` — chapter renumber + duplicate removal + top-level rename
3. `003-rename-docs-to-_docs.js` — carve-out lift + framework-content merge into `_requirements/` + top-level rename
4. `004-paths-schema-v4-to-v5.js` — `.claude/paths.json` value rewrite + new key insertion

All idempotent: detect already-applied state and no-op.

## Post-update checks

After `/warp:update --to 0.2.0 --apply`, the runner executes:
- `node scripts/paths/build.js --check`
- `node scripts/paths/gate.js`
- `node scripts/hooks/build.js --check`
- `node scripts/hooks/test.js`
- `node scripts/checks/warpos-structure-parity.js` — verifies the rename landed
- `node scripts/checks/warpos-promote-scope.js` — verifies promote.js scope is current
- `node scripts/checks/warpos-tracked-transients.js` — verifies no transients leaked into git

## Pinned commit

Captured at release-build time (recorded in `release.json#commit`).
