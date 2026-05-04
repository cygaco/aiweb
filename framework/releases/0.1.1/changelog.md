# WarpOS 0.1.1 — 2026-05-01

Patch release. Captures Phase 4-6 quality-gate hardening, session telemetry rollup, and a third Refactor & Rename Hygiene rule. No schema changes; no migrations required.

## What's new since 0.1.0

### Phase 4 follow-ups (commit `6bdd183`)

- §4.2 + deferred fixes from the Phase 4 review surface.

### Phase 5 — completion + handoff (commit `c87e7b1`)

- Phase 5 closeout work landed; handoff state recorded in `BACKLOG.md` HEADER for Phase 6 entry.

### Phase 6 — quality gates (commit `3ec6e12`)

- Phase 6 quality gates complete. The 14-gate release-gates suite (`scripts/warpos/release-gates.js`) reports green across path coherence, framework manifest, hook fixtures, fresh-install fixture, update fixture, customized-install fixture, runtime-leak scan, version consistency, production baseline, contract versioning, pattern library, and path-usage audit.
- `production_baseline` gate verifies presence of production, accessibility, analytics, DR, readiness, and deprecation docs.
- `contract_versioning` gate verifies shared contracts declare semver and compatibility policy.
- `pattern_library` gate verifies admission policy + canonical patterns.

### Session telemetry + Refactor & Rename Hygiene rule 3 (commit `0461926`)

- `CLAUDE.md` adds a third Refactor & Rename Hygiene rule:
  > **Lib-only fixes don't protect against bypassing callers.** Pair every transport-level fix with (a) a guard hook that flags the raw pattern at write-time, **and** (b) a dispatch-contract rule referenced from the agents who'd call it — not just the lib internals.
  Source: 2026-04-30 binding-gap learning + `cross-provider-dispatch.md`. The fix-once-in-helper pattern bit twice in 13 days when phase-1/2 review agents called `cat <file> | codex exec ...` from Bash directly, bypassing `runProvider`'s Windows-stdin fix (LRN-2026-04-17-n).
- Maps regenerated across skills, tools, hooks, enforcements, memory, systems, architecture.
- `ui-agentic-dev-practices` research bundle landed under `docs/99-resources/01-research/` (claude/gemini/openai reports + SYNTHESIS).

### Stale persona reference cleanup (commit `c6886d1`)

- Removed stale `personas` references from `.claude/agents/00-alex/delta.md`, `.claude/agents/00-alex/gamma.md`, `.claude/agents/01-adhoc/fixer/fixer.md`, `.claude/commands/check/system.md`, `BACKLOG.md`, and the framework-installed/manifest snapshots.

## Breaking changes

None.

## Schema changes

None. Framework-manifest schema remains `warpos/framework-manifest/v2`. Path registry schema remains `warpos/paths/v4`.

## Migrations

None. 0.1.0 → 0.1.1 is a no-migration update — `/warp:update` will sync framework files, regenerate the path registry artifacts on schema-equality, and re-snapshot the manifest hashes.

## Asset deltas (vs 0.1.0)

| Kind | 0.1.0 | 0.1.1 | Δ |
|---|---|---|---|
| release_capsule | 3 | 4 | +1 (this capsule) |
| TOTAL | 482 | 483 | +1 |

Asset count per kind otherwise unchanged.

### Paths registry: lint scripts converted (commit `39ffe45`)

<!-- path-literal-allowed: changelog naming the literal that was replaced -->
- `scripts/lint-hl-stories.js`, `scripts/lint-prds.js`, `scripts/lint-staleness.js`, `scripts/lint-stories.js`: replace hardcoded `docs/05-features` with `PATHS.specsRoot` (fallback retained for backwards compatibility).
- `lint-staleness.js` now scans `requirements/` in addition to `docs/`.

## Pinned commit

`39ffe45` (skeleton-test12) — captures phases 4-6 + telemetry + hygiene rule + persona cleanup + lint-script paths conversion.
