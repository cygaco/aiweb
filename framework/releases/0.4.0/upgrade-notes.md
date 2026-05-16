# WarpOS 0.4.0 — Upgrade Notes

Target: `0.2.2 → 0.4.0` (skips the source-only 0.3.0; consumers never
shipped a 0.3.0 capsule).

## TL;DR

Additive release. No breaking changes. Existing modes, hooks, agents,
paths, and commands continue to work unchanged. Sprint Workflow v0.1
is opt-in.

## What's in this update

This capsule bundles two phases of work that landed as source between
the 0.2.2 capsule and now:

1. **Phase 0** (target 0.3.0, source-only) — framework reliability
   prerequisites: dispatch-route guard, dispatch telemetry,
   `/warp:flag` + `/warp:promote-flags` ledger drain, provider health
   classifier, agent dispatch guide, framework-manifest guard,
   requirement format guard, ROADMAP namespace split,
   `/mode:adhoc` stale-team classification.
2. **Phase 1** (this release, 0.4.0) — Sprint Workflow v0.1:
   `/sprint:plan`, `/sprint:design`, `/sprint:execute`, `/sprint:release`
   commands; Plan Contract artifact; Ralph loop integration; tickets
   and issues; external service dependency lifecycle; sprint routing
   policy; crash recovery; two new hooks
   (`sprint-tracker-guard`, `sprint-approval-guard`).

## Steps

```text
/warp:update              # dry-run plan
/warp:update --apply      # apply
```

After apply:

```bash
# Path registry coherence (Phase 0 + Sprint v0.1 added keys)
node scripts/paths/build.js --check
node scripts/paths/gate.js

# Hooks registry coherence
node scripts/hooks/build.js --check
node scripts/hooks/test.js

# Sprint schemas + routing
node scripts/sprint/validate.js
node scripts/sprint/routing.js validate

# Phase 0 sanity
node scripts/phase0-verify.js
```

If anything fails, see `_docs/sprint/CRASH_RECOVERY.md` and
`_docs/phase0/FINAL_REPORT.md`.

## Opting in to Sprint Workflow v0.1

The sprint workflow is **opt-in**. Without it, your project continues to
work exactly as on 0.2.2. To turn it on:

```bash
node scripts/sprint/init.js --project "<your project name>"
```

This creates `.claude/project/sprint/` (tracker tree) and `issues.md`
(at repo root). Then in Claude Code:

```text
/sprint:plan "<brief plain-language request>"
```

See `_docs/sprint/DOWNSTREAM_ADOPTION.md` for the full adoption guide.

## What changed at the file level

| Surface | Before (0.2.2) | After (0.4.0) |
|---|---|---|
| Total framework assets | ~330 | 436 |
| Skills | 110 | 122 (+4 sprint commands; +Phase 0 additions) |
| Hooks | ~48 | 57 (+2 sprint hooks; +Phase 0 dispatch-route-guard, requirement-format-guard, framework-manifest-guard updates) |
| Schemas | 3 | 13 (+10 sprint schemas) |
| Reference docs | ~17 | 19 (+sprint-workflow.md, +agent-dispatch-guide.md) |
| Path registry keys | ~50 | ~78 (+19 sprint + 9 Phase 0) |
| Public docs (`_docs/`) | minimal | +14 sprint docs, +5 Phase 0 docs |
| Slash commands | `/mode:*`, `/issues:*`, `/warp:*`, `/check:*`, etc. | + `/sprint:plan|design|execute|release`, + `/warp:flag`, `/warp:promote-flags` |

## Things that did NOT change

- `/mode:solo`, `/mode:oneshot` — unchanged.
- `/mode:adhoc` — added stale-team classification + no-auto-claim
  startup directive in Phase 0; otherwise unchanged.
- Existing agent specs (alpha, beta, gamma, delta) — content
  unchanged. Delta's protocol cites the new agent-dispatch-guide.
- `_requirements/04-features/<feature>/PRD.md` — still the canonical
  home for per-feature requirements. Sprint requirements link to them.
- `paths.recurringIssuesFile` and `/issues:*` skills — SYSTEM-recurring
  issues continue to live in jsonl. Sprint product issues live in
  `paths.sprintIssues` (distinct).
- Existing hook matchers — sprint hooks were ADDED to the existing
  `PreToolUse Bash` and `PreToolUse Edit|Write` entries. No existing
  hooks were removed or rewired.

## New environment variable knobs

- `SPRINT_GUARD=off` — bypass sprint-tracker-guard.
- `SPRINT_APPROVAL_GUARD=off` — bypass sprint-approval-guard.
- `WARPOS_MODE` (Phase 0) — `dispatch-agent.js` mode-aware resolution.
- `REQUIREMENT_GUARD=off` / `REQUIREMENT_GUARD_STRICT=1` (Phase 0) —
  control the requirement-format-guard.

## Known gaps in 0.4.0 (intentional)

These are deliberate non-goals for this release:

- No `/sprint:resume` slash command. Resume is documented inside each
  sprint command and driven by `sprint-progress.yaml`.
- No diff-model review automation. The routing policy declares
  `diff_review: true` per phase; the actual second-model read happens
  in the skill body.
- No automatic production deploys. `release.js deploy` ONLY marks a
  deployment performed out-of-band.
- No Linear / Jira / GitHub Issues sync.
- No `/mode:oneshot` retune (explicit non-goal per the original
  Sprint v0.1 prompt).
- ESD vendor adapters live in downstream repos, not the framework.

## Rollback

If you need to roll back to 0.2.2:

```text
/warp:update --to 0.2.2 --apply
```

This removes the new path keys, hooks, and sprint assets. Your
`.claude/project/sprint/` tree is preserved (runtime state survives
downgrades); only the framework assets revert.

## Support

- Issues: `paths.recurringIssuesFile` via `/issues:log` (for system bugs),
  or `paths.sprintIssuesLedger` via `scripts/sprint/issue.js` (for
  product bugs).
- Reference: `paths.sprintReference`, `paths.agentDispatchGuide`,
  `_docs/sprint/`, `_docs/phase0/`.
- Health: `/warp:health` for one-shot diagnostic; `/warp:doctor` for
  full sweep.
