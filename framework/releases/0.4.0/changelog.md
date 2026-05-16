# WarpOS 0.4.0 — 2026-05-11

Sprint Workflow v0.1 release. Bundles Phase 0 (framework reliability
prerequisites; source landed at 0.3.0 commit `b3a5ab0` but was never
capsule-released) with Sprint Workflow v0.1 (Phase 1).

Consumers on 0.2.2 jump straight to 0.4.0. The chain
`0.2.2 → 0.4.0` is direct; no new migrations.

## What's new since 0.2.2

### Phase 0 — framework reliability prerequisites (originally targeted 0.3.0)

Eleven workstreams (A-K) shipped as source at commit `b3a5ab0`:

- **Dispatch-route guard** (`scripts/hooks/dispatch-route-guard.js`) blocks
  raw `codex exec` / `gemini -p` / `cat … | claude` invocations from
  Bash, preventing the LRN-2026-04-17 Windows-stdin and LRN-2026-04-30
  binding-gap regressions.
- **Dispatch telemetry**: JSON lock metadata (`dispatch_id`, `role`,
  `provider`, `model`, `prompt_bytes`, `cmdline_checksum`, `cwd`, `pid`).
  Completion records to `paths.dispatchCompletionsFile`; silent
  zero-byte deaths to `paths.dispatchDeathsFile`. Dead-PID prune at
  session-start and via `scripts/dispatch/prune-dead-locks.js`.
- **`/warp:flag` + `/warp:promote-flags`** ledger drain workflow with
  `paths.warposPromotedArchive` and `paths.warposPromoteReports`.
- **Provider-health classifier** (11 states) consumed by `/warp:health`
  and `/warp:setup`. Gemini `--skip-trust` opt-in; smart-context warns
  once per session when `GEMINI_API_KEY` clashes with oauth-personal CLI
  auth.
- **Agent dispatch guide** at `paths.agentDispatchGuide`; Gamma, Delta,
  and session-start all cite it.
- **Framework-manifest guard** canonical-vs-product split; warn-only in
  product with gitignored `.claude/`; PowerShell + bash bypass message;
  `.warpos/manifest-guard-disable` sentinel.
- **Canonical ROADMAP.md content** moved to `WARPOS_ROADMAP.md`; new
  product `ROADMAP.md` scaffold; `promote.js` excludes both filenames.
- **`dispatch-agent.js#findAgentSpec`** is mode-aware (reads
  `WARPOS_MODE` env or oneshot store inference).
- **Requirement write-time linter** (`scripts/hooks/requirement-format-guard.js`)
  for PRD / STORIES / HL-STORIES / CROSS-STANDARDS. Warn-only; strict
  via env or marker; legacy grandfather marker supported.
- **`/mode:adhoc`** stale-team classification, no-auto-claim STARTUP
  DIRECTIVE, `.team-marker` freshness check.

paths.json registry gained 9 keys: `agentDispatchGuide`, `dispatchLocks`,
`dispatchDeathsFile`, `dispatchCompletionsFile`, `providerTmp`,
`providerFallbackPolicy`, `warposFlagLedger`, `warposPromotedArchive`,
`warposPromoteReports`.

Verification: `scripts/phase0-verify.js` — 7/7 fixture tests + 9/9
consistency checks green. Full report:
`_docs/phase0/FINAL_REPORT.md`.

### Sprint Workflow v0.1 (Phase 1) — new

- **Four user-facing commands.** `/sprint:plan`, `/sprint:design`,
  `/sprint:execute`, `/sprint:release` — a product-workflow layer above
  the existing modes (`/mode:solo`, `/mode:adhoc`, `/mode:oneshot`).
  Sprint commands are mode-aware, not mode-dependent. Mode invocation
  stays user-controlled.
- **Plan Contract.** Durable artifact that bridges brief founder intent
  to design. Preserves the original request verbatim, separates safe vs
  unsafe assumptions, labels every affected surface with an evidence
  level (`verified_from_repo` / `inferred_from_repo` /
  `assumed_from_request` / `unknown`), identifies external service
  dependencies, records approval boundaries, decides design requirement,
  produces three scope variants, marks `plan_quality.status`
  (pass / needs_design / needs_user_clarification / blocked).
- **Tickets below requirements.** `/sprint:design` is the only command
  that mints non-trivial tickets. Tickets link to granular stories,
  COPY, INPUTS, TRACE, AC, ESDs, requirements. Reopenable with full
  history. 18 statuses, 18 ticket types.
- **External Service Dependencies (ESDs).** First-class artifact for
  signup / billing / credentials / OAuth / DNS / compliance
  lifecycles. Vendor-neutral. `external-service.js gate` refuses to let
  `/sprint:execute` advance past ESDs that aren't ready.
- **Ralph loop.** Governed `plan → act → test → review → record →
  checkpoint → repeat | stop`. Stop conditions enforced for approval
  boundaries, repeated failures, scope expansion, destructive actions,
  production-deploy needs. State persisted to files for crash recovery.
- **Crash recovery.** Live `sprint-progress.yaml` checkpoint + frozen
  numbered checkpoints at `paths.sprintCheckpoints`. `safe_to_continue`
  flag prevents auto-resume into corrupted state. Resume command in
  every tracker file.
- **Issues integration.** Per-issue YAML at `paths.sprintIssues` +
  human-readable `issues.md` at repo root. Distinct from
  `paths.recurringIssuesFile` (SYSTEM-recurring issues). 3-attempt rule
  surfaces warnings and recommends `/fix:deep`.
- **Sprint routing policy.** Declarative model routing for 11 sprint
  phases across 7 model classes. Honors `paths.providerFallbackPolicy`
  from Phase 0. No new SDK installs — routing declares intent, existing
  dispatch enforces availability.
- **Two new hooks.**
  - `sprint-tracker-guard.js` (PreToolUse Edit|Write) validates yaml
    under `paths.sprintRoot` against its declared schema; refuses
    edits to existing files under `paths.sprintHistory` (history is
    append-only).
  - `sprint-approval-guard.js` (PreToolUse Bash) blocks
    `release.js deploy` without a recorded approval and ESD
    `--status integrated|ready_for_terminal_work` updates when an
    approval-required ESD is still pending.
- **10 new schemas** under `schemas/sprint/`: plan-contract,
  current-sprint, sprint-progress, ticket, issue,
  external-service-dependency, approval, release, sprint-history,
  ralph-progress.
- **19 new path keys** under `sprint*` prefix in
  `framework/paths.registry.json`. All `owner: runtime` for the live
  tracker tree (downstream-written, not seeded in the framework).
- **13 new helper scripts** under `scripts/sprint/` and 2 new test
  scripts (`scripts/test-sprint.js`, `scripts/test-sprint-hooks.js`)
  — 8/8 + 12/12 passing.
- **Reference doc + routing policy** at `paths.sprintReference` and
  `paths.sprintRouting`.
- **14 public docs** under `_docs/sprint/`: OVERVIEW, FINDINGS,
  IMPLEMENTATION_PLAN, FRAMEWORK_VS_DOWNSTREAM, DOWNSTREAM_ADOPTION,
  CRASH_RECOVERY, MODE_RELATIONSHIP, MODEL_ROUTING, EXTERNAL_SERVICES,
  TICKET_MODEL, ISSUES_MD, RALPH_LOOP, CHANGELOG_0.4.0, FINAL_REPORT.

## Changed (since 0.2.2 source, mostly via Phase 0)

- Path registry version: now generates `warpos/paths/v4` (unchanged
  from 0.2.2 functionally — the schema URI didn't bump, only the key
  set grew).
- Framework manifest: 0.2.2 had ~330 assets; 0.4.0 has 436 (Phase 0 +
  Sprint v0.1 cumulative).
- Skill count: 122 (+4 sprint commands since Phase 0).
- Hook count: 57 (+2 sprint hooks since Phase 0).
- Schema count: 13 (+10 sprint schemas).
- Reference count: 19 (+1 sprint reference).

## Not changed (verified)

- Existing modes (`/mode:solo`, `/mode:adhoc` — but see Phase 0 stale-
  team additions, `/mode:oneshot`).
- Existing agents (alpha, beta, gamma, delta, build-chain).
- `paths.providerFallbackPolicy` (Phase 0 scaffold; still
  documented-not-enforced inside `runProvider`).
- `paths.recurringIssuesFile` and `/issues:*` skills.
- `_requirements/04-features/<feature>/PRD.md` convention.
- Existing capsule release tooling.

## Migration

Path: `0.2.2 → 0.4.0`. No migrations required (additive only).

After update:

1. `node scripts/paths/build.js --check` — verify generated artifacts.
2. `node scripts/paths/gate.js` — verify path registry coherence.
3. `node scripts/hooks/build.js --check` — verify hooks registry.
4. `node scripts/hooks/test.js` — smoke-test hooks.
5. `node scripts/sprint/validate.js` — confirm schemas load.
6. `node scripts/sprint/routing.js validate` — confirm routing policy.

To opt in to the sprint workflow:

```bash
node scripts/sprint/init.js --project "<your project>"
```

To stay on the existing modes only, do nothing — sprint is additive.

## See also

- `_docs/sprint/CHANGELOG_0.4.0.md` — detailed sprint changelog.
- `_docs/sprint/FINAL_REPORT.md` — implementation report.
- `_docs/sprint/DOWNSTREAM_ADOPTION.md` — how to adopt.
- `_docs/sprint/CRASH_RECOVERY.md` — resume procedure.
- `_docs/phase0/FINAL_REPORT.md` — Phase 0 context.
