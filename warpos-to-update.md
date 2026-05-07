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

### 2026-05-07 — redteam fallback chain when gemini quota exhausted

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
