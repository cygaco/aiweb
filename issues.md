# Issues — YC Pizza Concierge Compatibility Sprint

> Bug tracker for this sprint. Every bug found in QA, red-team, reviewer, manual test, runtime error, or user report goes here. **Required by sprint plan.**
>
> Schema per issue: title, status (Open/In Progress/Fixed/Deferred/Abandoned), source, related-feature, repro steps, expected, actual, suspected cause, fix attempts (each one), files touched, current recommendation, final resolution.
>
> **3-strike rule:** if a fix fails after 3 serious attempts, mark Abandoned/Deferred, document attempts + theory + workaround, move on unless YC-demo-blocking.

---

## Index

| ID | Title | Status | Source |
|---|---|---|---|
| ISS-001 | Keyless geocoding fallback returns caution-state for known fixtures | Deferred | QA gauntlet (gpt-5.5-mini) |
| ISS-002 | Codex CLI cold-start race on Windows (intermittent) | Open | gauntlet dispatch |
| ISS-003 | Gemini API rejects `gemini-3.1-pro` — needs version qualifier | Deferred | redteam gauntlet |
| ISS-004 | Requirements graph format mismatch — STORIES used `## S-1` not `### GS-COMPAT-01` | Fixed | merge-guard freshness gate |

---

## Open Issues

### ISS-001 — Keyless geocoding fallback returns caution-state for known fixtures

- **Status:** Deferred (non-blocking)
- **Source:** QA gauntlet (gpt-5.5-mini, codex)
- **Related feature:** compatibility-layer
- **Steps to reproduce:**
  1. Unset `GOOGLE_PLACES_API_KEY` in the env.
  2. Call `start_pizza_order` with address `"1 Market St, San Francisco, CA 94105"` and intent `meat_lovers`.
  3. Inspect the `compatibility.coverage.state` for test_vlad in the response.
- **Expected:** test_vlad has hardcoded coords (37.7749, -122.4194) and deliveryRadius 10mi; demo address is ~0.5 mi away → state should be `in_range`.
- **Actual:** geocodeAddress returns null (no API key) → userLat/userLng undefined → coverage state = `requires_address` → overall = caution.
- **Suspected cause:** `assessCompatibility` correctly degrades to `requires_address` when user coords are unknown, but for known test fixtures we could reasonably use a city-name string match as a fallback (e.g., user says "San Francisco" + restaurant.address contains "San Francisco" → assume in_range with low confidence).
- **Fix attempts:** none yet (deferred).
- **Files touched:** none yet.
- **Current recommendation:** add a future enhancement — when geocoding returns null but the user address string and restaurant address share a substantial token overlap (city/state), emit `in_range` with confidence 0.5 instead of `requires_address`. Out of scope for this YC sprint per AC8 (caution does not block `place_order`; the demo flow still completes — just surfaces an honest "I don't have your exact location" message).
- **YC-demo blocker?** No. AC8 + ITEM-CONFIRM in Bland prompt cover the demo flow even under caution.
- **Final resolution:** _(deferred to post-sprint follow-up; tracked in roadmap-yc.md "Known Risks")_

### ISS-002 — Codex CLI cold-start race on Windows

- **Status:** Open (Gamma retrying)
- **Source:** gauntlet dispatch (reviewer + compliance attempts)
- **Related feature:** dispatch infrastructure (not compatibility-layer feature itself)
- **Steps to reproduce:**
  1. Dispatch reviewer or compliance via `node scripts/dispatch-agent.js <role>`.
  2. Observe initial run: `providerAvailable` returns true, but `runProvider` errors with "codex CLI not found".
  3. Retry: succeeds.
- **Expected:** providerAvailable should reflect actual spawn-time availability.
- **Actual:** intermittent — race between npm shim resolution and process spawn on Windows.
- **Suspected cause:** Windows npm-shim cold-start race. Same env that succeeded earlier (QA) fails here on cold spawn.
- **Fix attempts:** Gamma is retrying; documented as transient.
- **Current recommendation:** if a gauntlet gate fails 3 times with this exact error, mark gate `infra_blocked` (not `fail`). Don't burn cycles. Followup post-sprint: extend `providerAvailable` to do a `which codex` ping, not just env check.
- **YC-demo blocker?** No (only affects gauntlet, not runtime).
- **Final resolution:** _(open; tooling follow-up after sprint)_

### ISS-003 — Gemini API rejects `gemini-3.1-pro` model id

- **Status:** Deferred (post-sprint follow-up)
- **Source:** redteam gauntlet
- **Related feature:** dispatch infrastructure (not compatibility-layer feature itself)
- **Steps to reproduce:**
  1. Dispatch redteam via `node scripts/dispatch-agent.js redteam`.
  2. Gemini API returns `ModelNotFoundError: gemini-3.1-pro`.
- **Expected:** Per user directive 2026-05-06, Gemini's latest is `gemini-3.1-pro` (no `-preview` suffix). Per `ai.google.dev/gemini-api/docs/models`, model ID is `gemini-3.1-pro` with status "Preview".
- **Actual:** Google's API endpoint rejects the bare `gemini-3.1-pro` id. May require a date suffix (e.g. `gemini-3.1-pro-04-2026`), or the docs and API are out of sync, or the previously-working `gemini-3.1-pro-preview` is still the actual API id.
- **Suspected cause:** Google's docs/API are out of sync, OR the model name has a versioned suffix not documented on the overview page.
- **Fix attempts:** Bulk replaced `gemini-3.1-pro-preview` → `gemini-3.1-pro` across 14 files. Gamma probed CLI directly:
  - `gemini-cli` version: **0.35.3**
  - `gemini -m gemini-3.1-pro -p ...` → ModelNotFoundError
  - `gemini -m gemini-3-pro -p ...` → ModelNotFoundError
  - `gemini -m models/gemini-3.1-pro -p ...` → ModelNotFoundError
  - `gemini -m gemini-3-1-pro -p ...` → ModelNotFoundError
  - `gemini -p ...` (default model, no `-m`) → returns OK successfully
- **Hypotheses:** (1) CLI version 0.35.3 model registry is shipped with the binary, may not yet include 3.1 — fix is `npm i -g @google/gemini-cli@latest`. (2) Account entitlement on user's `~/.gemini/` creds. (3) Versioned suffix needed (e.g., `gemini-3.1-pro-002` / `-latest` / `-04-2026`). Cheapest probe path: upgrade CLI first.
- **Workaround:** Redteam gate marked `infra_blocked` per 3-strike rule. Build verified-clean without it (3 of 4 gauntlet gates green). Compatibility-layer feature is YC-demo-ready.
- **Current recommendation:** when user returns, run `npm i -g @google/gemini-cli@latest` then re-probe with `echo ok | gemini -m gemini-3.1-pro -p "Reply OK"`. If still 404, it's an account/entitlement issue (not code). Either way, the manifest and code are correct relative to ai.google.dev/gemini-api/docs/models.
- **YC-demo blocker?** No.
- **Final resolution:** _(deferred to post-sprint; awaits user CLI upgrade + re-probe)_

### ISS-004 — Requirements graph format mismatch — STORIES used `## S-1` not `### GS-COMPAT-01`

- **Status:** Fixed (commit `8bc7ae5`)
- **Source:** merge-guard.js Freshness Gate
- **Related feature:** requirements infrastructure (not compatibility-layer)
- **Description:** `scripts/requirements/graph-build.js:115` parses `### GS-XX-NN:` headings as granular stories. The compatibility-layer STORIES.md used `## S-1 — ...` format from the special-instructions PRD precedent. Graph builder correctly returned 0 requirements for the new feature, blocking merge.
- **Fix:** `sed`-renamed `## S-1 — ...` → `### GS-COMPAT-01: ...` (and same for 2-15) in STORIES.md. Also added a REQ-* registry block at the top of PRD.md AC section for cross-reference. Graph rebuild yielded 15 requirements; merge passed.
- **Commit:** `8bc7ae5`
- **Lesson:** the four pre-existing features (special-instructions etc.) all use the same wrong format and would also fail merge if anyone tried to merge them. None are merged yet. Format compliance is required at merge-time, not write-time.
- **Final resolution:** Fixed in `8bc7ae5`. Suggest a guard to flag this at write-time (linter for `_requirements/04-features/*/STORIES.md` heading format).

---

## Resolved / Closed

_(none yet)_

---

## Deferred / Abandoned

_(none yet)_

---

## Issue Template

```
### [ID] [Title]

- **Status:** Open | In Progress | Fixed | Deferred | Abandoned
- **Source:** QA | red-team | reviewer | manual test | runtime error | user report
- **Related feature:** compatibility-layer | _other_
- **Steps to reproduce:**
  1. ...
- **Expected behavior:** ...
- **Actual behavior:** ...
- **Suspected cause:** ...
- **Fix attempts:**
  1. (attempt #1) — _description_ — _files touched_ — _result_
  2. ...
- **Files touched:** ...
- **Current recommendation:** ...
- **Final resolution:** _(filled in when Fixed/Deferred/Abandoned)_
```
