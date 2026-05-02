# WarpOS Roadmap

Post-MVP work. Items grouped by phase.

---

## ✅ Shipped in v0.1.1 (2026-04-18)

The install-hardening batch. Every item below was a ROADMAP entry from 2026-04-17 or 04-18 that now ships in production.

### Installer foundation
- [x] **Ship-manifest system** — `.claude/framework-manifest.json` declares every shippable asset; installer iterates the manifest instead of hand-coded `copyDir` calls. Generator: `scripts/generate-framework-manifest.js`. (205 assets + 9 generated.)
- [x] **Framework-installed snapshot** — target projects get `.claude/framework-installed.json` at install; uninstall walks it exhaustively; re-install diffs old vs new for ghost-file detection.
- [x] **Ghost-file cleanup on re-install** — installer detects files declared by prior install but removed/renamed upstream; `--clean-ghosts` flag removes them.
- [x] **`--dry-run` actually works** — flag was parsed but unused; now prints the full plan (per-kind counts, would-skip existing, would-generate, ghost count) and exits without writes.
- [x] **Installer copy-scope gap closed** — first-install on aiweb missed 46 files (requirements + patterns + maps + top-level scripts). Manifest makes this impossible: if it's in the manifest, the installer sees it.
- [x] **Top-level scripts ship too** — `path-lint.js`, `dispatch-agent.js`, `generate-maps.js`, `generate-framework-manifest.js`.

### Installer UX
- [x] **CLAUDE.md auto-merge** — if target has existing `CLAUDE.md`, installer appends Alex identity with `---` separator; backup kept.
- [x] **AGENTS.md auto-merge** — same pattern; prior behavior silently kept user's AGENTS.md without Alex system, breaking γ dispatch.
- [x] **Restart banner handles both paths** — "already have Claude Code open? close + reopen. not open yet? just open" — replaces the old "YOU MUST RESTART NOW" that confused first-time users.
- [x] **`WARPOS_NEXT_STEPS.md` written at project root** — user references it in the fresh session.
- [x] **`/warp:init` → `/warp:setup`** — resumable state-machine skill; 5 signals checked, only missing steps run. Safe to re-run. `/warp:uninstall` shipped.
- [x] **Pre-install backup** — `.warpos-backup/<ts>/` captures CLAUDE.md, AGENTS.md, .gitignore, .claude/, scripts/hooks/ before any write.

### Hook correctness
- [x] **Hook schema: `type:"command"` required** — installer was writing just `{command}`; Claude Code's validator rejected at launch. Fixed via `cmd()` helper.
- [x] **Single-event keys** — `"Stop|SessionEnd|StopFailure"` pipe-joined was "Unknown hook event"; split into three top-level keys.
- [x] **Per-matcher hook merge** — if user has any pre-existing hook in an event, old logic skipped WarpOS's whole set. Now: append WarpOS hooks into matching matcher, dedup by command string. User's hooks preserved.
- [x] **merge-guard catches `+refspec` force-push** — was only catching `--force` and `-f`; `git push origin +main` bypassed the guard. Fixed.
- [x] **Framework-manifest guard** — PreToolUse Bash hook blocks commits that stage tracked assets without re-staging the manifest. Enforces "regenerate before commit." β DECIDE: block, don't mutate.

### Skills + docs
- [x] **`/discover:systems`** — 6-angle discovery (declarative/structural/behavioral/refgraph/convention/historical).
- [x] **`/warp:uninstall`** — clean removal with restore from `.warpos-backup/`; consumes `framework-installed.json` for exhaustive file list.
- [x] **Attestation events schema** — `cat: "attestation"` in events.jsonl tracks learning → enforcement provenance. One-shot emitters: `scripts/tools/emit-attestation-events.js`, `emit-integrate-events.js`.
- [x] **USER_GUIDE §2 clarity** — modes are project-wide and persistent; adhoc still probes β with just α + user; oneshot is end-to-end-rebuild from requirements.
- [x] **USER_GUIDE §5.6 preflight ELI5** — 7-pass breakdown; ONLY for oneshot.
- [x] **`/sleep:deep` Phase 4 painting MANDATORY** — several cycles had skipped the ASCII art step; now self-check-gated.

### Privacy + public release
- [x] **Repo transitioned private → public** — `cygaco/WarpOS` now public.
- [x] **History scrub via git-filter-repo** — 68 commits rewritten; zero references to private product/repo names in any commit.
- [x] **Redteam audit (4 parallel scans)** — 0 credentials, 0 PII, 0 tracked-but-ignored. IP hygiene scrub landed in 20+ files.
- [x] **smart-context Haiku timeout + payload caps** — was 8000ms on unbounded context; now 15000ms + per-source caps (60 learnings, 20 traces, 20 decisions).

---

## Phase 1 — Ship-week hardening (2026-04-17 target)

### Path System (Command 1 from session 2026-04-16)
The paths.json registry is the single source of truth for dir/file locations. Current state: 37 keys. Goal: every `.claude/*`, `scripts/hooks/*`, and shared file referenced by skills/hooks/agents resolves via `paths.json`, never hardcoded.

- [x] Expand `paths.json` from 20 → 37 keys (add eventsFile, learningsFile, tracesFile, systemsFile, judgmentModel, judgmentRecommendations, betaEvents, lexicon, pathsLib, loggerLib, betaSourceData, toolsFile, requirementsFile, requirementsStagedFile, hookLib, patterns, requirements)
- [x] Update `lib/paths.js` fallback to match
- [x] Update `warp-setup.js` to emit the expanded paths.json at install time
- [x] Install `path-guard.js` hook — warns (optionally blocks with `PATH_GUARD_STRICT=1`) when stale paths are written to skills/agents/hooks
- [ ] **Follow-up:** migrate the remaining ~80 skill references that write paths as prose literals (e.g. "Write to `.claude/project/memory/learnings.jsonl`") to reference `PATHS.learningsFile` semantically
- [ ] **Follow-up:** `/paths:validate` skill — verify every key resolves on disk + flag hardcoded paths + suggest consolidations
- [ ] **Follow-up:** `/paths:add` skill — interactive helper to add a new path key (updates paths.json + lib/paths.js fallback + warp-setup.js in one go)

### Events & Logging
Current: `logger.js` abstracts appends to `events.jsonl`; `memory-guard.js` blocks direct writes. Smart-context reads events for context injection.

- [x] memory-guard fixed to not block `2>&1` fd redirects (false positive blocked read commands)
- [ ] **Follow-up:** dedicated `/events:tail`, `/events:query` skills (currently done via ad-hoc node oneliners)
- [ ] **Follow-up:** events retention policy — events.jsonl crosses ~6MB in real-world usage. Compress / roll when above threshold (sleep:deep handles this manually today)
- [ ] **Follow-up:** structured query language for events.jsonl (current: grep + filter)

### Installer — Created vs Assumed model
Current: 13-step install. 8 items are CREATED (paths, manifest, store, memory, settings, dirs), 5 items are ASSUMED (agents, skills, hooks, reference, CLAUDE.md copied verbatim).

- [x] `warp-setup.js` generates paths.json v3 with all keys (CREATED)
- [x] Registers the 31 real hooks (not phantom ones)
- [x] WarpOS repo no longer ships a committed `paths.json` — clients get one built by the installer
- [ ] **Phase 1 ship blocker:** `.gitignore` mutation — append WarpOS runtime exclusion block to target's `.gitignore` to prevent session-data leaks
- [ ] **Interview phase** — warp-setup asks 5–10 questions before acting:
  - project name (override basename detection)
  - one-line pitch
  - primary user
  - main branch (detected via `git symbolic-ref refs/remotes/origin/HEAD`, confirm)
  - WarpOS repo URL (default `cygaco/WarpOS`, support forks)
  - ANTHROPIC_API_KEY location
  - Result written to `manifest.git.mainBranch`, `manifest.warpos.source`, `manifest.project.*`
- [ ] **Tool-detected hook bundles** — check for prettier/tsc/eslint/python/etc. present, only register hooks whose tooling exists. Surface skipped hooks with "install X then run `/hooks:enable <name>`"
- [ ] **Requirements pre-fill** — `/warp:init` runs after install, interviews the user, writes filled `CORE_BRIEF.md`, `PRODUCT_MODEL.md`, `GLOSSARY.md`, `USER_COHORTS.md` (not skeleton + guidance comments)
- [ ] **Parameterize `/warp:*` repo URLs** — `/warp:sync`, `/warp:check`, `/warp:init` read `manifest.warpos.source`, not hardcoded
- [ ] **Parameterize project name** — all skills/docs that mention project name read from `manifest.project.name`
- [ ] **Install-test harness** — `warp-setup.js --dry-run` on a fresh tmp dir, verify every claim in the setup output
- [ ] **`/warp:update` skill** — pull latest WarpOS, compare, apply diff (analog to `/warp:sync`)
- [ ] **`/warp:uninstall` skill** — clean removal

### Gaps from the Created vs Assumed audit

Items that are currently NEITHER created NOR assumed (just missing):
- `.gitignore` runtime exclusions — **leak risk**
- Main branch name — assumed "main" everywhere
- Project name — used basename, no override
- Git remote URL — hardcoded in `/warp:sync`
- `.env.example` template
- Environment flavor selection (minimal / full / security-heavy bundles)

### Gitignore audit (2026-04-17 — flagged by user)

Current `.gitignore` excludes `.claude/project/events/` and `.claude/project/memory/` — this protects privacy but **events and learnings are not backed up anywhere**. If a dev laptop dies, reasoning traces and event history are lost. Consider:

- A redacted subset that *is* committable (e.g. a weekly digest)
- Opt-in encrypted backup to a gitignored-by-default side-branch
- Confirm every directory that is ignored is genuinely session-ephemeral — audit line-by-line
- Write a `/warp:backup` skill that pushes events/memory to a private mirror repo (opt-in)

Priority: medium — not blocking launch, but a data-loss risk that compounds over time.

---

## Phase 2 — Skills & systems

### Cross-provider agent diversity (high priority)

**Problem:** all review and security agents currently run on Claude (same model that generates the code under review). Same-model review is blind to shared failure modes. Per Alex β decision 2026-04-16: "having the same model review its own work is not good."

**Solution:** route review-layer agents through OpenAI CLI (`codex`), security orchestration through Gemini CLI. Uses the existing `store.compliance` CLI-bridge pattern, generalized.

Target model mapping:

| Agent | Provider | Model | Rationale |
|---|---|---|---|
| alpha, beta, gamma, delta | Claude | sonnet (or inherit) | Orchestration, judgment continuity — keep Claude |
| builder (×2), fixer (×2) | Claude | sonnet | Code generation — Claude is tuned here |
| **evaluator (×2)** | **OpenAI** | **gpt-5.4** | Deep review with different lens; 1M context fits spec+code+fixtures |
| **compliance (×2)** | **OpenAI** | **gpt-5.4** | Adversarial integrity — flagship, not mini |
| **auditor (oneshot)** | **OpenAI** | **gpt-5.4-mini** | Cross-cycle pattern synthesis; many small inputs |
| **qa (×2)** | **OpenAI** | **gpt-5.4-mini** | 13 failure-mode personas × volume |
| **redteam (×2)** | **Gemini** | **gemini-3.1-pro-preview** | 11 attack-chain personas — different adversarial training corpus |

Implementation:
- [x] Extend `manifest.providers` with `claude`, `openai`, `gemini` entries (cli, default_model, fallback)
- [x] Add `manifest.agentProviders` mapping role → provider
- [x] New lib module: `scripts/hooks/lib/providers.js` — wraps `execSync` calls to `codex` / `gemini` CLIs
- [x] Update γ/δ dispatch to read `agentProviders[<role>]` and route accordingly (via `scripts/dispatch-agent.js`)
- [x] `/check:environment` verifies `codex` and `gemini` CLIs present if configured (E25-E26 checks)
- [x] Fallback: CLI missing → use `fallback` model (always Claude) — `provider_fallback: claude` in agent frontmatter
- [x] Per-agent prompts stay in the .md files (agent gets the same prompt regardless of provider)
- [x] Response parsing adapter — `parseProviderJson` normalizes GPT/Gemini output to match Claude sub-agent JSON shape

**SHIPPED 2026-04-17.** Strict model assertion added (commit f7f5885) so silent downgrades fail loudly. `actualModel` from CLI stats vs declared `model` detected via `modelsMatch()`.

### Token usage optimization (deferred per user directive)

Not a ship blocker. Once cross-provider is live:
- [ ] Track per-agent token usage in events log — category `provider-call`
- [ ] Per-provider cost dashboard (estimate from token counts)
- [ ] Prompt compression for GPT/Gemini — the Claude-tuned prompts are often verbose; condense for cross-provider
- [ ] Cache the "system/identity" portion of review prompts where provider supports it (OpenAI prompt caching, Gemini context caching)
- [ ] Tiered fallback: gpt-5.4 → gpt-5.4-mini → claude if primary times out or rate-limits
- [ ] Per-agent model override via env var (`WARPOS_EVALUATOR_MODEL=gpt-5.4-mini`) for cost-sensitive users

### Missing skills identified in audit
- [x] `/check:system` — systems audit (scans for every system, diffs manifest)  **SHIPPED**
- [x] `/discover:systems` — multi-angle discovery (6 lenses, surfaces emergent/ghost systems)  **SHIPPED 2026-04-17** (beyond scope of original ask)
- [ ] `/check:privacy` — pre-publish scan for personal data (names, session artifacts, learnings, credentials)
- [ ] `/check:install` — verify a fresh install is complete end-to-end
- [ ] `/check:hooks` — hook test harness via synthetic payloads (extends `/hooks:test`)
- [ ] `/warp:doctor` — single-command full diagnostic (runs `health` + `check:*` suite)
- [ ] `/warp:update` — see Installer section above
- [x] `/warp:uninstall` — clean removal with restore from `.warpos-backup/` **SHIPPED 2026-04-18**
- [ ] `/agents:list` + `/agents:test` — first-class observability for the agent system
- [ ] `/paths:validate` + `/paths:add` — see Path System above
- [ ] `/linters:run` — unified lint runner (linters are a system per feedback)
- [ ] `/manifest:show`, `/manifest:validate`, `/manifest:migrate`
- [ ] `/docs:catalog` — enumerate reference docs with status

### Existing skill follow-ups
- [ ] `/research:deep` — 728 lines, likely untested, model versions stale. Either validate end-to-end OR deprecate in favor of `/research:simple`
- [ ] `/research:simple` — add synthesis phase (merge reports → SYNTHESIS.md)
- [x] `/sleep:deep` — REM Phase 4 painting step made MANDATORY with self-check gate (2026-04-17). Vague phase 1c/1e thresholds still deferred.
- [ ] `/ui:review` — genericize (no hardcoded product names); add parameterized design-system path support
- [ ] `/retro:code`, `/retro:full` — remove stale "retro directory" manifest.json references; either hard-code `.claude/project/retros/` or make optional
- [ ] `/warp:sync` — add fallback if `../WarpOS/version.json` doesn't exist (git tags / commit hash)
- [ ] `/warp:init` — parameterize GitHub URL (hardcodes `cygaco/WarpOS.git`)

### Mode persistence clarity (2026-04-18)
- [ ] Mode (solo / adhoc / oneshot) is project-wide and persistent — switching in any terminal switches it for ALL terminals on that project. User guide now documents this. Behavior is already correct in code but was not documented — also surface this in `/mode:*` skill output on entry (e.g. "Adhoc mode active for project X — all your open terminals now share this mode").
- [x] USER_GUIDE.md §2 updated to clarify: modes are project-wide, not per-terminal; even in adhoc with just α + user, α probes β on non-trivial decisions.
- [x] USER_GUIDE.md §5.6 Preflight explained ELI5 with 7-pass breakdown; clarified it's ONLY for oneshot.
- [x] USER_GUIDE.md §4 cross-terminal coordination language now explicit: write for an Alex that wasn't there.

### Installer + setup UX (2026-04-18)
- [x] Renamed `/warp:init` → `/warp:setup` — covers clone + install + CLAUDE.md merge + restart + verify
- [x] `warp-setup.js` backs up pre-install files to `.warpos-backup/<timestamp>/` (CLAUDE.md, AGENTS.md, .gitignore, .claude/, scripts/hooks/)
- [x] `warp-setup.js` writes `WARPOS_NEXT_STEPS.md` at project root — users reference it in the fresh Claude Code session after restart
- [x] Installer "NEXT STEPS" output now tells users to close + reopen Claude Code before anything else
- [x] `/warp:uninstall` skill created — clean removal with restore from backup
- [x] CLAUDE.md auto-append when user has existing content (2026-04-18)
- [x] AGENTS.md auto-append same pattern as CLAUDE.md (2026-04-18 — prior behavior kept client's and skipped WarpOS's, breaking γ dispatch)
- [ ] **Follow-up:** wire `/warp:setup` CLAUDE.md merge step into the installer itself (currently split between script + skill; consider unified)
- [ ] **Follow-up:** dry-run mode (`--dry-run`) currently parses the flag but doesn't actually skip writes — needs real implementation
- [ ] **Follow-up:** `warp-setup.js` should emit `manifest.warpos.installed: true` on success (currently unset) so `/warp:setup` Step 1 check works

### Install safety — branch isolation + conflict resolution (2026-04-18)

Raised by user after the first real-project install. Current installer runs directly on whatever branch the user is on (usually `main`) — a bad install could contaminate their shippable branch. We back up files but not git state.

- [ ] **`--branch` default:** installer creates `warp/install-<timestamp>` branch, checks out, runs install there. Prints "Install is on branch X. Review with `git diff main`, merge with `git checkout main && git merge X`, discard with `git branch -D X`." Add `--direct` flag to opt-out.
- [ ] **Refuse install on `main` by default** — require either `--branch <name>` or explicit `--yes-install-on-main`.
- [ ] **Wire `--dry-run` to actually skip writes** — currently the flag is parsed but never gates the writes. Print every file it WOULD touch, then exit clean.
- [ ] **Pre-install state snapshot** — `git status`, current branch name, uncommitted file count written into `.warpos-backup/<ts>/install-context.json` so uninstall can report "you had N uncommitted changes at install time".
- [ ] **Same-name agent collision detection** — scan target `.claude/agents/` for basenames that match WarpOS agent roles (`builder`, `evaluator`, `fixer`, `qa`, `redteam`, `compliance`, `auditor`, `alpha`, `beta`, `gamma`, `delta`). If any match at any depth, prompt user: (a) keep yours / (b) rename yours to `<name>-custom.md` / (c) replace with WarpOS's. Unresolved collisions silently break the gauntlet.
- [ ] **Ghost-file cleanup on re-install** — installer leaves orphan files from prior WarpOS versions (e.g., `warp/init.md` after rename to `warp/setup.md`). Installer should write a ship-manifest of every file it owns, and on re-install offer to delete ghosts (files in ship-manifest from prior version but not current).
- [ ] **Customer-agent namespace convention** — document that WarpOS owns `.claude/agents/00-*/`, `01-*/`, `02-*/` and clients should put custom agents under `.claude/agents/99-custom/`. Installer checks + refuses to write into `99-*` slots.
- [ ] **Post-install integrity check** — run `/warp:health --strict` at end of install; if any red, roll back to `.warpos-backup/<ts>/` automatically with user confirmation.

### Requirements system — shipped but not being installed (2026-04-18, FIXED)

**Correction to earlier entry.** WarpOS source actually DOES have 30 requirement template files across 10 numbered subdirs (`00-canonical/`, `01-design-system/`, `02-copy-system/`, `03-requirement-standards/`, `04-architecture/`, `05-features/`, `06-operations/`, `07-security/`, `08-testing/`, `09-automation/`) plus `_example-onboarding` feature skeleton. The files exist. The installer just wasn't copying them. FIXED in this session — installer now copies `requirements/`, `patterns/`, and `.claude/project/maps/` baseline. Historical note on what was missing: Users get a broken promise: "ask Alex to help fill in your requirements templates" → there are no templates.

What jobhunter-app (the source project) has under `docs/` that WarpOS should ship as `requirements/`:

- `requirements/00-canonical/` — project-level truth docs
  - `CORE_BRIEF.md` (the product in one page)
  - `PRODUCT_MODEL.md` (data model + state machine)
  - `GLOSSARY.md` (terms)
  - `USER_COHORTS.md` (target users)
- `requirements/01-design-system/` — UI rules
  - `COMPONENT_LIBRARY.md` (registered components)
  - `COLOR_SEMANTICS.md` (design tokens)
  - `ANIMATION_MOTION.md`, `FEEDBACK_PATTERNS.md`, `RESPONSIVE.md`
- `requirements/02-copy-system/` — microcopy, tone, variants
- `requirements/03-requirement-standards/` — `PRD_TEMPLATE.md`, `STORIES_TEMPLATE.md`, `INPUTS_TEMPLATE.md`, `HL-STORIES_TEMPLATE.md`, field spec standards
- `requirements/04-architecture/` — architecture decision records template + examples
- `requirements/05-features/` — per-feature dir structure (PRD + STORIES + INPUTS + COPY)
  - Ship empty dir with one **example feature** folder showing the shape, not client content
- `requirements/.decisions/` — ADR template

Action items:
- [ ] **Extract templates from jobhunter:** copy the canonical structure, strip all consumer-product-specific content, reduce to fillable skeletons with guidance comments. Place in WarpOS repo at `requirements/`.
- [ ] **Installer copies `requirements/` to target** if target has no `requirements/` dir — same copy-if-missing pattern as `.claude/`. Never overwrite if target has one.
- [ ] **One example feature** — ship `requirements/05-features/example-feature/` with PRD + STORIES + INPUTS demonstrating the schema. Users delete or rename when they create their first real feature.
- [ ] **`/check:requirements` dry-run on fresh install** — should report "0 features defined, ready for first `/skills:create` or `Help me write a product brief`" cleanly instead of erroring on missing dirs.
- [ ] **Update `warp-setup.js` skeleton check** to stop referencing `requirements/01-design-system` path existence as a `ui-lint` enablement signal before the templates actually ship (currently generates a misleading warning on every install).
- [ ] **Update `systems.jsonl` seed** — `requirements-templates` entry currently seeded with `count: 0`; once templates ship, bump to real count and add `files: [...]` listing the templates.

Priority: **high for v0.2.0** — the framework's value prop ("ask Alex to help write specs") is broken without templates. Current installs look complete but the `requirements/` dir is silently missing.

### Guard strengthening (2026-04-18)

Surfaced when I force-pushed to scrub history and my own merge-guard blocked `--force` but not `+refspec` syntax.

- [ ] **merge-guard: catch all force-push forms** — current regex only catches `--force` and `-f`. Git also supports `+refs/heads/X:refs/heads/X` (plus-prefix refspec) to force-update a branch. Extend regex to: `(--force|-f\b|\s\+\S+:\S+|\s\+[a-zA-Z])` when matched against a `git push` command.
- [ ] **team-guard: tiered agent allowlist for adhoc mode** (β RT-010). Alpha can spawn research agents (Explore, Plan, general-purpose). Build-chain agents (builder, evaluator, fixer, compliance, redteam, auditor, qa) are Gamma-only. Currently team-guard is permissive.

### Namespace reorganization
- [ ] Merge `/retro:context` + `/retro:code` into `/retro:full` as modes (not separate skills)
- [ ] Merge `/fav:list` + `/fav:search` into `/fav` with args
- [ ] Consider moving `/hooks:friction` analysis into `/check:patterns propose`

### Spec-propagation closer (Batch G, deferred from 2026-04-17 /check:all remediation)
- [ ] Close the loop between `/check:requirements drift` detection and actual spec updates. Current state: drift markers stage into `requirements-staged.jsonl`, reviewer manually triages. Missing: a propagation-closer that (a) walks dependent spec nodes via SPEC_GRAPH, (b) surfaces which downstream files MUST be updated when a root spec changes, (c) fails the gauntlet until propagation is attested. Design separately before implementation. β DECIDE 2026-04-17: defer to Phase 2, design as its own skill.

---

## Phase 3 — Product-as-product

Treat WarpOS itself as a product-in-WarpOS with its own `requirements/05-features/`:
- [ ] Write PRDs for installer, session-lifecycle, paths-resolution, hook-pipeline
- [ ] Spec the Alex agent team as a feature with stories
- [ ] Run `/preflight:run` against WarpOS itself before every push
- [ ] Run `/qa:audit` and `/redteam:full` on WarpOS — catch the hook bugs, privacy leaks, stale refs we currently hunt manually

---

## Phase 4 — Observability & UX

- [ ] `agent-dashboard.js` turned into a real browser UI (currently CLI-style)
- [ ] Skills get a usage counter (how often each is invoked) — informs pruning
- [ ] `/warp:tour` version 2 — interactive walkthrough, not one-shot explainer
- [ ] `USER_GUIDE.md` → split into tutorial + reference

---

## Notes

- During co-development against a private consumer project, every WarpOS change should also ship to that project (or vice versa). Use `/hooks:sync` pattern (extended to skills too).
- Privacy audit required before every public push. `/check:privacy` should be the gate.
- Main branch must stay shippable at all times. Exploratory work happens on feature branches. (This is §2 of `USER_GUIDE.md` — the #1 newbie trap.)
