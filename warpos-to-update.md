# WarpOS — flagged updates

Items flagged from this product repo for upstream WarpOS propagation. Drained on `/warp:promote` or `/warp:release`.

| Date | Category | Title | Source |
|---|---|---|---|
| 2026-05-07 | provider | gemini-cli stale model registry — providers.js error message + ISS-003 | `scripts/hooks/lib/providers.js`, `issues.md` |
| 2026-05-07 | agent | agent-dispatch-guide.md auto-load — gamma.md + delta.md + SessionStart inject | `.claude/agents/00-alex/gamma.md`, `.claude/agents/00-alex/delta.md`, `scripts/hooks/session-start.js` |
| 2026-05-07 | skill | new /warp:flag skill | `.claude/commands/warp/flag.md` |
| 2026-05-07 | hook | merge-guard requires REQ-* IDs + GS-XX-NN heading format — should be write-time linter not merge-time gate (ISS-004) | `scripts/hooks/merge-guard.js`, `scripts/requirements/graph-build.js`, `scripts/requirements/config.js` |
| 2026-05-07 | provider | gemini --skip-trust + sharpened error msg — providers.js dispatch hardening | `scripts/hooks/lib/providers.js:435`, line 391-405 |
| 2026-05-07 | provider | proactive quota probe in providers.js modelAvailable() — distinguish ModelNotFoundError vs TerminalQuotaError vs OK | `scripts/hooks/lib/providers.js` modelAvailable() function |
| 2026-05-07 | hook | dispatch sanity check on fresh WarpOS install — verify claude + codex + gemini reachable, surface entitlement gaps before first dispatch | new install hook or `/warp:setup` extension |
| 2026-05-07 | agent | maxTurns reap is silent — Gamma exited mid-session, team config dropped him, my SendMessage went to dead inbox without surfacing the failure | team-mgmt layer, possibly `scripts/hooks/session-start.js` or team primitive |
| 2026-05-07 | agent | warpos-to-update.md drain workflow — `/warp:promote` should consume open flags, mark them resolved, optionally archive | `/warp:promote` skill |
| 2026-05-07 | dispatch | `auth.selectedType: oauth-personal` silently ignores `GEMINI_API_KEY` env var — surface this in smart-context or session-start | `~/.gemini/settings.json` interaction with `.env` |
| 2026-05-07 | provider | gemini exclusion-rationale doc dead reference — `_requirements/09-integrations/PROVIDER/03-google-gemini.md` doesn't exist (per Beta consult) | `scripts/dispatch/catalog.js:91` exclusion comment |
| 2026-05-07 | provider | redteam fallback chain when gemini quota exhausted — temporarily re-route to openai gpt-5.4-mini for cross-model coverage | `manifest.agentProviders`, `.claude/agents/01-adhoc/redteam/orchestrator.md`, providers.js fallback logic |
| 2026-05-07 | dispatch | dispatch-agent.js findAgentSpec — mode-aware spec resolution (read mode.json, prefer matching mode subdir) | `scripts/dispatch-agent.js` (patched by Gamma this session) |
| 2026-05-07 | other | ROADMAP.md template pollution — WarpOS install ships its own framework roadmap into the product repo's ROADMAP.md; product needs a clean blank or namespaced framework variant | `ROADMAP.md`, `install.ps1`, canonical `cygaco/WarpOS/ROADMAP.md` |
| 2026-05-07 | agent | /mode:adhoc — stale team artifacts persist across sessions; auto-claim on teammate spawn ignores "go idle" briefing | `.claude/commands/mode/adhoc.md`, TeamCreate primitive, teammate startup loop |
| 2026-05-07 | hook | framework-manifest-guard — expects .claude/framework-manifest.json to be staged in product repos where .gitignore excludes all of .claude/; bash-inline env-bypass doesn't propagate to PreToolUse hook | `scripts/hooks/framework-manifest-guard.js`, product-repo `.gitignore` interaction |
| 2026-05-07 | hook | write-time guard for raw `codex exec` / `claude -p` / `gemini` patterns — prevent binding-gap recurrence (LRN-2026-04-17-n class) | new hook + builder/orchestrator agent specs |
| 2026-05-07 | dispatch | scripts/dispatch-agent.js needs orchestrator-side telemetry — silent 0-byte deaths leave no trace; no mtime, no .err, no stderr capture | `scripts/dispatch-agent.js`, `scripts/hooks/lib/providers.js` |

---

### 2026-05-07 — /mode:adhoc — stale team artifacts persist across sessions; auto-claim on teammate spawn ignores "go idle" briefing

- **Category:** agent
- **Source:** `.claude/commands/mode/adhoc.md`, TeamCreate primitive, teammate startup loop
- **Description:**

  Two distinct but related issues observed in 2026-05-07 session resume:

  **Issue A — Stale team config persists across crashes.**
  When a session crashes mid-adhoc, the team config at `~/.claude/teams/<team-name>/config.json` is left in place with:
  - dormant `agentId` records (Beta@.../Gamma@... whose underlying processes are dead)
  - stale `leadSessionId` pointing to a defunct session
  - stale agent prompts (e.g., observed Gamma's prompt referenced "retry redteam ONLY" — a task completed in the prior session before the crash)

  When Alpha resumes in a new session and runs `/mode:adhoc`, the skill describes "create a team and spawn two teammates" but does NOT detect that a team already exists for this project. `TeamCreate` then refuses to overwrite (`Team "X" already exists`). Alpha has to manually inspect, and either delete+recreate or work around. There is no clean refresh-in-place path.

  **Issue B — Fresh teammates auto-claim tasks on startup despite explicit "go idle" briefing.**
  Spawned Beta + Gamma into the existing team with explicit prompts ending "acknowledge readiness in one sentence then go idle." Tasks 4-6 (which were `pending` with no owner) immediately flipped to `in_progress` with Beta and Gamma as owners — without me sending any work assignment, and during their first-turn startup. The teammate startup loop appears to include a default "claim available tasks in ID order" behavior that ignores Alpha's instruction to remain idle until pinged.

  This is wrong because:
  - It assigns work the teammate doesn't actually intend to do (Beta is judgment-only, can't run TaskCreate-emit-work; Gamma was not yet briefed on the spec to build)
  - It pollutes the task list with false in_progress states, making `TaskList` output misleading
  - Alpha must manually un-claim and reset to pending after every team spawn

  **Mechanical enforcement proposals:**

  1. `/mode:adhoc` should detect existing team for current project (cwd-keyed lookup of teams/`*`/config.json).
     - If team is "fresh" (`leadSessionId` matches current session, `joinedAt` within last hour), reuse in place.
     - If team is "stale" (`leadSessionId` from defunct session, OR all teammates' `joinedAt` > 24h old), offer 3 paths: (a) refresh-in-place (re-spawn dormant agents with fresh prompts), (b) force-recreate (delete + recreate fresh), (c) bail to solo mode.
     - Default per `auto` permission mode: refresh-in-place with current sprint context.

  2. `TeamCreate` primitive should expose `--force-replace` flag to atomically delete-and-recreate (preserves task list, replaces member list + leadSessionId).

  3. Teammate auto-claim on startup should be **opt-in**, not default. Add `claim_on_startup: false` (default) to the spawn prompt schema. Or: respect a sentinel in the briefing prompt (e.g. text "go idle" / "do not claim tasks") that suppresses the default loop.

  4. Alternative architecture: tie team identity to session ID. New session = new team. Cross-session task continuity handled by the handoff system (already exists), not by team config persistence.

  **Source files for the fix:**
  - `.claude/commands/mode/adhoc.md` — add detect-existing-team step + refresh-vs-recreate dialog
  - TeamCreate primitive (likely a built-in tool, not a script in this repo) — `--force-replace` flag
  - Teammate spawn / startup loop (built-in) — opt-in claim behavior

  **Workaround used in this session:** spawned Beta+Gamma into the existing team via `Agent` with `team_name`+`run_in_background:true`, then manually reset task ownership.

- **Status:** open

---

### 2026-05-07 — write-time guard for raw `codex exec` / `claude -p` / `gemini` patterns — prevent binding-gap recurrence (LRN-2026-04-17-n class)

- **Category:** hook
- **Source:** new hook (e.g. `scripts/hooks/dispatch-route-guard.js`), builder/orchestrator agent specs
- **Description:**

  This is the second time in two weeks an orchestrator (Gamma) silently re-hit the Windows-stdin class bug by invoking codex/claude/gemini via raw bash instead of through `runProvider` (the Windows-stdin-safe wrapper at `scripts/hooks/lib/providers.js:441`).

  **Pattern:** orchestrator composes a prompt → spawns codex/claude/gemini directly via Bash subprocess (e.g. `cat prompt.txt | codex exec --full-auto -m gpt-5.5 -` or `claude -p --agent builder "$(cat prompt.txt)"`) → process dies silently with 0-byte stdout AND 0-byte stderr → orchestrator waits for output that never arrives.

  **Recovery cost this session:** ~2 hours of orchestrator/Alpha time waiting for failed dispatches and re-diagnosing the same class bug. Phase 0 of `/fix:deep` correctly identified prior LRN-11/12/15 + LRN-2026-04-17-n; the hard rule from LRN-12 ("switch dispatch route immediately, do not burn 3 attempts on same path") is correct but only kicks in AFTER the failure.

  **Mechanical enforcement proposals:**

  1. **Write-time guard hook** at PostToolUse on Bash that scans for any of these patterns in the command string:
     - `codex exec ` not preceded by `node scripts/dispatch-agent.js`
     - `claude -p ` not preceded by `node scripts/dispatch-agent.js`
     - `gemini ` (the CLI) followed by `-p` not via dispatch-agent
     - `cat .*\.txt \| (codex|claude|gemini)`

     When matched, block with: *"Direct CLI invocation re-triggers LRN-2026-04-17-n on Windows. Use `node scripts/dispatch-agent.js <role> <prompt-file>` instead — it routes through `runProvider` which is stdin-safe."*

  2. **Orchestrator agent spec rules.** Add a constraint to `.claude/agents/00-alex/gamma.md` (and delta.md):
     > **Build-chain dispatch MUST go through `node scripts/dispatch-agent.js <role> <prompt-file>`.** Direct invocation of `codex exec`, `claude -p`, or `gemini` via Bash is forbidden — it re-triggers the Windows-stdin bug class (LRN-2026-04-17-n). If you need to prompt-builder a custom role, write the prompt to a file then dispatch via dispatch-agent.js. The agent-dispatch-guide.md must be re-read at every gauntlet dispatch.

  3. **Orchestrator-side telemetry.** When `runProvider` is called, write the lock file with PID + cmdline + start-time + role + prompt-bytes. When `runProvider` returns, write a `<pid>.complete` marker. If a lock file exists 25 min after start with no completion marker AND its PID is dead, log a warning to a `dispatch-deaths.jsonl` file with the cmdline + start-time + last-stdout-mtime. Currently the death is invisible — caller waits forever, no trace.

  4. **Smoke probe in `/oneshot:preflight` and `/mode:adhoc`.** Add a 30-second canary: `codex --version && echo "ok" | node scripts/dispatch-agent.js reviewer -`. If the canary fails, abort the mode-set with a clear "dispatch infra broken — see ISS-XXX" error rather than letting the orchestrator try to dispatch and die silently.

  **Source files for the fix:**
  - new hook: `scripts/hooks/dispatch-route-guard.js`
  - new telemetry: probably extending `scripts/hooks/lib/concurrency-lock.js`
  - agent specs: `.claude/agents/00-alex/{gamma,delta}.md`
  - smoke probe: `.claude/commands/{oneshot/preflight,mode/adhoc}.md`

  **Workaround used in this session:** Alpha-driven gauntlet via `scripts/one-off/run-gauntlet-alpha.js` (calls `runProvider` directly per-role). Logged as `RT-004` + `LRN-2026-05-07-gamma-dispatch-bypass`.

- **Status:** open

---

### 2026-05-07 — scripts/dispatch-agent.js needs orchestrator-side telemetry — silent 0-byte deaths leave no trace; no mtime, no .err, no stderr capture

- **Category:** dispatch
- **Source:** `scripts/dispatch-agent.js`, `scripts/hooks/lib/providers.js`
- **Description:**

  When the dispatch chain dies (orchestrator → bash → codex/claude/gemini), the failure mode is silent: 0-byte stdout, 0-byte stderr, lock file held by dead PID. The orchestrator waits for output that will never arrive. The auto-prune on the concurrency-lock is lazy (only runs on next acquireSlot), so locks linger past their 20-min TTL until something else triggers acquire.

  **Telemetry gaps:**
  1. No record of *why* the process died — was it never spawned, did it auth-fail, did it OOM, did the parent shell die?
  2. No record of WHAT the dispatch was — role, prompt size, start-time. Just a PID-keyed lock with timestamp.
  3. No active prune thread — locks only clear when a new dispatch tries to acquire. Manual `rm` is needed when no new work is coming.

  **Fix proposals:**
  1. **Active prune** — small interval timer (every 5 min) in `concurrency-lock.js` that scans for locks with dead PIDs older than 5 min and removes them. Cheap, prevents permanent slot leakage.
  2. **Dispatch deaths log** — `runProvider` wraps the execSync in a try/finally that logs to `runtime/dispatch-deaths.jsonl` on any exit with empty stdout AND empty stderr (the silent-death signature).
  3. **Lock metadata** — when acquireSlot writes a lock, include role + cmdline-checksum + prompt-bytes + start-time as JSON content (not just PID timestamp). Future debugging gets full context.

- **Status:** open

---

### 2026-05-07 — framework-manifest-guard — expects .claude/framework-manifest.json staged in product repos where .gitignore excludes all of .claude/; bash-inline env-bypass doesn't propagate

- **Category:** hook
- **Source:** `scripts/hooks/framework-manifest-guard.js`, product-repo `.gitignore:8` (line excludes all `.claude/`), hook-escape mechanism
- **Description:**

  Two distinct issues observed when committing a new feature spec under `_requirements/04-features/<feature>/PRD.md` in this product repo:

  **Issue A — Hook expects a file the repo can't track.**
  The PreToolUse `framework-manifest-guard` hook detects that staged paths intersect a "WarpOS-tracked assets" set (computed from canonical paths the framework tracks). When such paths are staged but `.claude/framework-manifest.json` is NOT staged, the hook blocks the commit with a regenerate-and-add-the-manifest error.

  But in this product repo (`.gitignore:8` and following), the entire `.claude/` directory is gitignored. Trying `git add .claude/framework-manifest.json` fails: *"The following paths are ignored by one of your .gitignore files: .claude. hint: Use -f if you really want to add them."* And force-adding a normally-gitignored file would commit a generated artifact into a product repo's history — bad.

  Net effect: the hook's recommended remediation cannot be followed in product repos. Only the documented escape (`WARPOS_MANIFEST_GUARD=off`) works.

  **Issue B — Inline env-bypass does not reach PreToolUse hooks.**
  The hook's error message says: *"Set WARPOS_MANIFEST_GUARD=off to bypass (use sparingly)."* Following that literally with `WARPOS_MANIFEST_GUARD=off git commit -m "..."` from a Bash tool call **does not work** — the hook still fires and blocks. This is because PreToolUse hooks execute in the harness's process context (PowerShell on this Windows install), BEFORE the bash subprocess fires. Bash-inline env vars only apply to the bash process and its children, not to the parent harness.

  The working incantation on Windows-PowerShell is `$env:WARPOS_MANIFEST_GUARD = "off"; git commit -m "..."` via the PowerShell tool, which sets the env var in the harness scope before the next tool call evaluates hooks.

  **Repro:**
  1. In a product repo where `.claude/` is gitignored
  2. Stage a new file under a WarpOS-tracked path (e.g. `_requirements/04-features/<new>/PRD.md`)
  3. Try `WARPOS_MANIFEST_GUARD=off git commit -m "..."` from Bash
  4. Observe: hook still blocks
  5. Try `$env:WARPOS_MANIFEST_GUARD = "off"; git commit ...` from PowerShell
  6. Observe: hook bypassed, commit succeeds

  **Mechanical enforcement proposals:**

  1. **Auto-detect product-vs-canonical context.** If the hook detects `.claude/` is gitignored at the repo root (i.e., this is a product install, not the canonical WarpOS clone), it should either:
     (a) Skip the manifest-staged check entirely and proceed (the manifest is regenerable on every install)
     (b) Verify the manifest exists on disk and is reasonably fresh (`git diff --no-index .claude/framework-manifest.json <freshly-generated>`), but not require it to be staged
     (c) Print a one-line warn instead of blocking

  2. **Document the env-bypass propagation issue** in the hook's error message:
     - Current: *"Set WARPOS_MANIFEST_GUARD=off to bypass (use sparingly)."*
     - Better: *"Set WARPOS_MANIFEST_GUARD=off in the harness env (PowerShell `$env:WARPOS_MANIFEST_GUARD = 'off'`, NOT bash-inline which won't reach PreToolUse hooks)."*

  3. **Alternative escape mechanism.** A `.warpos/manifest-guard-disable` sentinel file in the repo (gitignored or committed) that the hook reads. Doesn't depend on env-var scoping at all.

  **Workaround used in this session:** PowerShell tool with `$env:WARPOS_MANIFEST_GUARD = "off"`, plus a flag here for upstream.

- **Status:** open

---

### 2026-05-07 — gemini-cli stale model registry — providers.js error message + ISS-003

- **Category:** provider
- **Source:** `scripts/hooks/lib/providers.js` line 391-403, `issues.md` ISS-003
- **Description:** gemini-cli ships its model registry baked into the binary. CLI v0.35.3 doesn't know about `gemini-3.1-pro` even though the model is documented at ai.google.dev/gemini-api/docs/models. All four name variants (`gemini-3.1-pro`, `gemini-3-pro`, `models/gemini-3.1-pro`, `gemini-3-1-pro`) return ModelNotFoundError; default model resolves. Fix path: `npm i -g @google/gemini-cli@latest` then re-probe. After upgrade, if still 404 it's account entitlement. The strict-failure error in `runProvider` was sharpened to point at this path explicitly. Upstream WarpOS may want a cli-version probe in `cliAvailable()` that warns on stale gemini-cli at session start.
- **Status:** open

---

### 2026-05-07 — agent-dispatch-guide.md auto-load — gamma.md + delta.md + SessionStart inject

- **Category:** agent
- **Source:** `.claude/agents/00-alex/gamma.md`, `.claude/agents/00-alex/delta.md`, `scripts/hooks/session-start.js`
- **Description:** Recurring failure: orchestrators (Gamma 2026-05-06, others before) bypass `agent-dispatch-guide.md` and re-hit known dispatch failure modes — `claude -p` Windows-stdin bug (LRN-2026-04-17-n), wrong output-dir convention, missed `delta-aggregate-reviews.js`. Fixes applied locally: (1) added MANDATORY READ for the guide to gamma.md + delta.md startup-read sequences; (2) extended SessionStart hook to always emit a "MANDATORY REFERENCE — agent-dispatch-guide.md" block in additionalContext so every session sees the guide path even before handoff/sleep/nudge content. Propagate all three changes to canonical WarpOS so future installs inherit the auto-load.
- **Status:** open

---

### 2026-05-07 — new /warp:flag skill

- **Category:** skill
- **Source:** `.claude/commands/warp/flag.md`
- **Description:** Lightweight tracker that appends framework-change flags to `warpos-to-update.md` at project root. Drains on `/warp:promote` or `/warp:release`. Created during YC sprint when user noted there was no clean way to flag mid-sprint framework changes for upstream propagation. Should ship in canonical WarpOS so all installs have the workflow.
- **Status:** open

---

### 2026-05-07 — proactive quota probe in providers.js modelAvailable()

- **Category:** provider
- **Source:** `scripts/hooks/lib/providers.js` modelAvailable() function
- **Description:** Live test results from this session — three probe options compared against gemini-cli 0.41.2 with quota-exhausted Pro account:
  - **Option 1 (`--version` / `--help` banner):** USELESS. `gemini --version` returns just `0.41.2` (no banner). `--help` returns generic usage. Neither surfaces auth/quota/entitlement state. ~50ms.
  - **Option 2 (1-token API probe):** WINS. `echo "" | gemini -m <model> -p "Reply OK"` returns distinguishable signals: "OK" on healthy, `code: 404` for entitlement gap, `TerminalQuotaError` for quota exhaustion. ~1 token, sub-second, distinct error classes parsable. **Recommended.**
  - **Option 3 (`gemini models list`):** SLOWER but MOST INFORMATIVE. Initial test appeared to hang; on completion it returned per-model quota metrics with explicit limits — including the disambiguating finding that "404" can actually be `quota_exceeded with limit: 0` (free-tier projects get 0 quota for some models, surfaces as 404 to the CLI). This case is invisible to Option 2.

  Recommendation: **Option 2 as cheap default startup probe** (extend `modelAvailable()` to do a 1-token API probe at first use of each provider/model per session, cache result for 12 min TTL — existing pattern). Distinguish three states: ok / 404 / 429-or-TerminalQuotaError. **Option 3 as fallback when Option 2 returns 404** to disambiguate "model entitlement gap" vs "free-tier limit:0 quota gate" — they look identical at the 404 layer but the Option 3 output includes metric names like `generate_content_free_tier_input_token_count limit: 0`. Cost: <1 token per provider per session for the cheap path; ~5-10 sec wall time for the deep path on 404 (rare).

- **Status:** open

---

### 2026-05-07 — gemini --skip-trust + sharpened error msg — providers.js dispatch hardening

- **Category:** provider
- **Source:** `scripts/hooks/lib/providers.js:435` (gemini cmd construction); line 391-405 (strict-failure error message)
- **Description:** This session's debug surfaced two providers.js gaps. (1) The hardcoded gemini cmd at line 435 didn't pass `--skip-trust`, so any dispatch from a non-trusted directory hit `Gemini CLI is not running in a trusted directory` before reaching the model. Patched to bake in `--skip-trust`. (2) Strict-failure error message now points at the upgrade path + ISS-003 cross-reference for users hitting the model-not-available case. Both small but high-value for next-session dispatch hygiene.
- **Status:** open

---

### 2026-05-07 — dispatch sanity check on fresh WarpOS install

- **Category:** hook
- **Source:** new install hook OR extension to `/warp:setup`
- **Description:** Fresh WarpOS installs land into a project with multiple dispatch surfaces (claude / codex / gemini). Each can fail silently for distinct reasons (CLI not installed, account not authed, model not entitled, quota exhausted, trust-flag missing, env-var missing). Currently those failures only surface mid-dispatch when an agent actually tries to use the broken surface — wastes a 69KB prompt and 30+ sec of wall time per failed attempt. Recommendation: post-install hook that probes each provider once with a 1-token call (per Option 2 above), reports green/yellow/red per provider with the specific fix path. Surface in `/warp:health` AND in `/warp:setup` exit. Saves ~5 minutes of debug per fresh install when something is misconfigured.
- **Status:** open

---

### 2026-05-07 — maxTurns reap is silent

- **Category:** agent
- **Source:** team-mgmt layer (Agent tool spawned-agent lifecycle)
- **Description:** Gamma was spawned at session start with `maxTurns: 80` per his frontmatter. Mid-session, Gamma hit maxTurns and exited. Team config (`~/.claude/teams/aiweb-yc-sprint/config.json`) was updated to remove him from `members[]`. But Alpha's subsequent SendMessage calls succeeded with `{success: true, message: "Message sent to Gamma's inbox"}` — no error surfaced. User noticed Gamma was missing from their team UI before Alpha did (Alpha had been queueing redteam-retry messages into the dead inbox). Recommendation: when an agent is reaped from the team, all subsequent SendMessage to that agent should surface "agent has exited" prominently to the sender. Either (a) reject the SendMessage with a clear error, or (b) auto-respawn if the spec allows, or (c) at minimum log a loud warning. Silent reap is the binding-gap class repeating.
- **Status:** open

---

### 2026-05-07 — warpos-to-update.md drain workflow

- **Category:** skill
- **Source:** `/warp:promote` skill
- **Description:** `/warp:flag` writes flags here; `/warp:promote` should consume them. Currently no documented contract. When `/warp:promote` runs, it should: (1) read all `Status: open` entries, (2) propagate the corresponding files to canonical WarpOS, (3) mark drained entries `Status: promoted` with the canonical commit SHA, (4) optionally archive to `warpos-promoted-archive.md` after N days. Without this, `warpos-to-update.md` accumulates indefinitely.
- **Status:** open

---

### 2026-05-07 — auth.selectedType silently ignores GEMINI_API_KEY

- **Category:** dispatch
- **Source:** `~/.gemini/settings.json` `auth.selectedType: oauth-personal` interaction with `.env GEMINI_API_KEY`
- **Description:** When gemini-cli's settings.json has `auth.selectedType: "oauth-personal"`, the CLI uses the user's interactive Google account login regardless of whether `GEMINI_API_KEY` env var is set. This session debugged a 404 for 30+ minutes before discovering the auth-source mismatch — the user assumed their `.env` API key was being used because it was set, but the CLI silently bypassed it. Recommendation: smart-context.js or session-start.js should check `~/.gemini/settings.json.auth.selectedType` and warn if it's `oauth-personal` while `GEMINI_API_KEY` is also set in `.env` — the two are almost certainly conflicting. Cheap inspection at session start.
- **Status:** open

---

### 2026-05-07 — gemini exclusion-rationale doc dead reference

- **Category:** provider
- **Source:** `scripts/dispatch/catalog.js:91` exclusion comment pointing to `_requirements/09-integrations/PROVIDER/03-google-gemini.md`
- **Description:** Beta found this during consult. The catalog.js comment "Note: gemini-2.5-pro is deliberately excluded per project policy" cites a rationale doc that doesn't exist. The exclusion may have been written when 3.1 was the new hotness; now that the user can't access 3.1, the policy reflexively blocks them from a working alternative (2.5-pro). Either (a) write the rationale doc and keep the exclusion, or (b) lift the exclusion. 30-second user decision.
- **Status:** open

---

### 2026-05-07 — ROADMAP.md template pollution — WarpOS install ships its own framework roadmap into the product repo

- **Category:** other (template / install layout)
- **Source:** `ROADMAP.md` (this product repo, pre-consolidation), `install.ps1` (presumably copies the template), canonical `cygaco/WarpOS/ROADMAP.md`
- **Description:** When WarpOS is installed into a product repo, it ships a `ROADMAP.md` at project root that contains WarpOS-framework roadmap content (installer phases, hook correctness, skill coverage, agent diversity, etc.) — not a clean blank for the product to fill in. This session, the product (AIWeb pizza concierge) accumulated its own roadmap content (intake upgrade, compatibility layer, menu connectors, etc.) inside the same `ROADMAP.md`, mixing framework and product items. Eventually had to manually strip ~280 lines of WarpOS content + condense a separate `roadmap-yc.md` into a clean AIWeb-only `ROADMAP.md` (commit `5f11b01`, this product repo).
- **Recommendation:** WarpOS install should EITHER (a) ship a clean blank `ROADMAP.md` template scaffold (e.g., "# {{project_name}} Roadmap\n\n## Current state\n...\n\n## Active backlog\n...") with no framework-specific items in it, OR (b) namespace the framework roadmap as `FRAMEWORK_ROADMAP.md` / `WARPOS_ROADMAP.md` so it doesn't collide with the product's `ROADMAP.md`. Option (a) is cleaner for new installs; option (b) preserves the framework's own roadmap visibility without polluting product roadmaps.
- **Why it matters:** every product repo that adopts WarpOS will repeat this manual strip step otherwise. Same class as PROJECT.md staleness (which still describes Jobzooka in this repo as of 2026-05-07).
- **Status:** open

- **Category:** provider
- **Source:** `manifest.agentProviders`, `.claude/agents/01-adhoc/redteam/orchestrator.md`, providers.js fallback logic
- **Description:** This session re-routed redteam from gemini → openai/gpt-5.4-mini when gemini quota was exhausted. Manual config edit. Long-term: providers.js should support a fallback chain at the role-frontmatter level — `provider_model: gemini-3.1-pro || gpt-5.4-mini` — so that on quota/entitlement failure, the next model in the chain is automatically used (with a loud event log). Cross-model review intent preserved without manual intervention. Pairs with the proactive quota probe above (knows in advance which model to use, doesn't try-and-fail).
- **Status:** open

---

### 2026-05-07 — merge-guard requires REQ-* IDs + GS-XX-NN heading format — should be write-time linter not merge-time gate (ISS-004)

- **Category:** hook
- **Source:** `scripts/hooks/merge-guard.js`, `scripts/requirements/graph-build.js`, `scripts/requirements/config.js`
- **Description:** During the compatibility-layer merge, the freshness gate fired at merge time requiring `REQ-<feature>-<topic>-<NNN>` IDs in PRD.md and `### GS-XX-NN:` headings in STORIES.md. The PRD/STORIES authored by Alpha during the YC sprint used `## S-1` format inherited from the special-instructions PRD precedent — so the gate caught a real mismatch but at the wrong moment (post-build, blocking merge). Recommendation: add a write-time linter on `_requirements/04-features/*/STORIES.md` that flags non-conforming heading format the moment it's saved, so the issue surfaces during requirements authoring not during merge. Also: the four pre-existing features (special-instructions etc.) all use the same wrong format and would also fail merge. They should be retroactively fixed or grandfathered.
- **Status:** open

## 2026-05-12

### install — framework/templates/sprint/ not installed by 0.4.4 install.ps1

- Date: 2026-05-12
- Source: aiweb /sprint:design 2026-05-12
- Status: open
- Description: Schemas + scripts ship but template dir is missing. Manual cp from canonical needed to unblock /sprint:design. Repro: fresh install -> node scripts/sprint/design.js -> 'missing template' errors for every requirements/*.md.tmpl. Fix in install.ps1 asset-collection step so framework/templates/ is included (currently 0 references in framework-installed.json asset map).

## 2026-05-14

### skill — /sprint:execute has no built-in builder/reviewer/QA/redteam dispatch — routing.json is decorative

- Date: 2026-05-14
- Source: .claude/commands/sprint/execute.md, .claude/agents/00-alex/.system/policy/sprint-routing.json, scripts/sprint/execute.js
- Status: open
- Description: sprint-routing.json declares qa.diff_review=true, redteam.diff_review=true, execution.escalate_to=strong_reasoning per ticket. scripts/sprint/routing.js can ANSWER 'what model class for phase X' but never DISPATCHES anything. scripts/sprint/execute.js (435 lines) has zero references to dispatch-agent, subagent_type, builder, reviewer, gauntlet, qa-orchestrator, redteam-orchestrator. The skill body says one line: 'Adhoc: Alpha runs the loop. Gamma is invoked when a ticket needs a build/gauntlet cycle (existing Gamma flow)' — no criteria, no enforcement, no integration code. Observed 2026-05-14: three /sprint:execute background runs (SP-001/002/003) all used a single general-purpose Sonnet agent per sprint, none invoked the build-chain gauntlet, none ran QA or redteam diff_review on the per-ticket commits. The routing policy is therefore aspirational not enforced. Proposal: (1) sprint:execute should dispatch per-ticket build via Gamma in adhoc mode when ticket has acceptance criteria + tests; (2) post-commit hook should fire qa-orchestrator + redteam-orchestrator with diff_review on each ticket per routing.qa and routing.redteam; (3) decision-ledger entry when diff_review skipped due to second-vendor unavailability.

## 2026-05-14

### hook — merge-guard's path-coherence gate has drift bugs blocking legitimate sprint merges

- Date: 2026-05-14
- Source: scripts/paths/gate.js, .claude/commands/warp/flag.md, .claude/project/sprint/requirements/SP-20260514-001/prd.md, scripts/hooks/merge-guard.js
- Status: open
- Description: During SP-20260514-001/002/003 integration to main on 2026-05-14, scripts/paths/gate.js refused all merges with 30+ docs-tokens findings. Root causes (all observable in this product repo as of merge time): (1) checkDocsTokens SKIP_SUBSTRINGS missing '.warpos/' and 'framework/releases/' — transient rollback backups and shipped capsule changelogs reference deprecated tokens and shouldn't be linted. (2) checkDocsTokens SKIP_SUBSTRINGS missing '.claude/worktrees/' — when sprint executor agents leave worktrees on disk, every doc inside them gets re-linted. (3) Gate loads validKeys ONLY from framework/paths.registry.json — never merges product-level keys from .claude/paths.json. In this product repo framework/paths.registry.json has 0 sprint keys while .claude/paths.json has 21 — every doc referencing paths.sprintRouting/paths.sprintProgress/paths.sprintIssues/etc. fails. Sprint workflow is product-level, sprint tokens should resolve. (4) Doc drift in .claude/commands/warp/flag.md:22 references paths.warpFlagFile but registry has paths.warposFlagLedger — skill body itself is broken. (5) Doc drift in .claude/project/sprint/requirements/SP-20260514-001/prd.md:54 references nonexistent paths.testsDir (fixed in product as part of this merge — straight 'tests/' literal). Proposal: fix gate.js to (a) skip .warpos/ + framework/releases/ + .claude/worktrees/ in docs-tokens like it already does in path-lint, (b) merge product paths.json keys into validKeys, (c) fix warp:flag.md doc to use paths.warposFlagLedger. Without these fixes any product repo with sprint workflow + agent worktrees + accumulated .warpos transactions cannot run git merge through merge-guard.

## 2026-05-16

### skill — scripts/sprint/plan.js writes per-sprint current.yaml with stale-default sprint id + title; downstream design.js scaffolds against wrong sprint

- Date: 2026-05-16
- Source: scripts/sprint/plan.js, scripts/sprint/design.js, .claude/project/sprint/sprints/<SP-id>/current.yaml
- Status: open
- Description: Observed during /sprint:plan for SP-20260514-004 on 2026-05-14: plan.js wrote .claude/project/sprint/sprints/SP-20260514-004/current.yaml with id=SP-20260514-003 and title='Unnamed sprint' (template defaults), while ONLY populating source_request/interpreted_intent/plan_contract/etc. correctly. The subsequent /sprint:design read SPRINT.current via the active-registry getter (which DID resolve to the SP-004 file), but design.js then read the file's id field (SP-20260514-003) and scaffolded into requirements/SP-20260514-003/ — clobber risk against the prior sprint's existing files, and 0 files written for SP-004. Workaround: manual edit of per-sprint current.yaml id+title before re-running design.js. Proposal: (1) plan.js fills id from active-sprints registry's primary AT WRITE TIME, not from a template default; (2) plan.js fills title from active-sprints[].title (which IS populated correctly by add-sprint.js); (3) design.js either uses the registry id directly instead of trusting the per-sprint current.yaml id, or asserts they match and refuses with a clear error if not.
