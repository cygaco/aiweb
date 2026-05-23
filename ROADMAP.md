# AIWeb Roadmap

The AI Web — Wave 00 pizza concierge. This file is the single roadmap for the product (current state + recently-shipped + sprint plan + known risks + crash-recovery + human verification test). Framework / WarpOS roadmap items live in their own canonical clone, not here.

---

## Current state (live — keep this updated)

- **Branch:** `main` at `fab5050` (post-SP-006/007 head; subsequent commits land here).
- **Build:** `npm run build` clean. `npm test` last reported **323/323** (SP-20260519-006 close) — re-verify with `npm test`.
- **Last shipped:** SP-20260519-006 (card-over-phone, ships disabled) + SP-20260519-007 (Claude Desktop reliability). See "Recently shipped."
- **Active planning (2026-05-23):** menu-discovery rework → **Sprints A–D** below. Planned, not yet executed. **Product constraint: the menu must be known PRE-CALL; the call never checks the menu** — this rejected the confirm-on-call idea RT-006/gpt-5.5-pro proposed. Analysis (mechanical findings still valid): `runtime/gpt55pro/answer.md`, RT-006 in `.claude/project/memory/traces.jsonl`.
- **Open issues:** `issues.md` (ISS-005/RT-201 HIGH adversarial → Sprint D-1; others D-2/D-3/D-4).
- **Open WarpOS-propagation flags:** `warpos-to-update.md`. Drained on `/warp:promote` or `/warp:release`.
- **Launch readiness:** `_docs/launch/MVP-P0-INVENTORY.md`.

---

## Recently shipped

### SP-20260519-006 — Card-over-phone payment (alpha-stage) (2026-05-19)

Adds a second payment branch to `place_order` that voices a prepaid card to the restaurant via the existing Bland call. **Ships disabled** in production (`ENABLE_CARD_OVER_PHONE='false'` in `fly.toml`); enabling for alpha testing is a documented operator action.

- **Schema (R-1).** `PlaceOrderRequest` extended with optional `paymentMethod` + card fields. New `src/lib/payment-method.ts` exports a zod discriminated union (`cardOverPhoneFieldsSchema`), the `isCardOverPhoneEnabled()` env-gate helper, and `DEFAULT_TIP_PERCENT=15`. Cash callers omit `payment_method` and behavior is byte-identical.
- **Three independent leak defenses (R-3 / R-5 / R-6).**
  - `src/lib/transcript-scrub.ts` → `scrubTranscript()` strips 13–19-digit runs, 4-4-4-4 grouped digits, and CVV-adjacent codes, redacting to `****-****-****-NNNN` and `CVV ***`. Defense-in-depth: throws `TranscriptScrubError` if a pattern matched but the output is byte-identical. Wired into `bland.ts getCallStatus` BEFORE the transcript field is assigned on both sim and real-API paths.
  - `scripts/hooks/secret-guard.js` adds three new PreToolUse patterns (13–19 contiguous, 4-4-4-4 grouped, CVV-adjacent) with an `allowedPaths` regex for `tests/regression/SP-20260519-006/`. Validated against `sim_<timestamp>` IDs (word-boundary scoping keeps them safe).
  - `ENABLE_CARD_OVER_PHONE` env gate enforced via `isCardOverPhoneEnabled()` in both `src/server.ts` (MCP) and `src/a2a/executor.ts` (A2A); explicit `'false'` entry in `fly.toml [env]`.
- **Bland prompt (R-2 / R-4).** `buildCallPrompt` swaps the cash-only RULES for a 10-beat CARD-DISCLOSURE SCRIPT when `payment_method='card_over_phone'`; `buildSimTranscript` ships a parallel card-path using the public Visa test card (constructed via concat so the source has no 4-4-4-4 literal). `parseTranscript` returns `payment_method`, `tip_amount`, `total_with_tip`, `cardCharged`, `cardFailureReason` on card-branch calls.
- **MCP + A2A parity (R-7).** Same shared schema; same env-gate helper; A2A `proposed_cart` artifact carries `card_last_four` only (raw card fields never).
- **Disclosure surface (R-8 / R-9).** `webapp/app/tos/page.tsx` has an alpha-stage block replacing the "cash only" line. `CARD_OVER_PHONE_DISCLOSURE` is a hardcoded string constant in `src/server.ts` (verbatim copy.md C-1). Referenced from the `place_order` tool description (C-3). The webapp chat `route.ts` SYSTEM prompt requires verbatim reproduction BEFORE card-detail collection AND again at cart confirmation.
- **Webapp UX (R-10).** Chat flow asks user payment method before `prepare_order`. Card branch: agent reads C-1 verbatim, asks for fields one at a time, reads C-1 again before final confirmation, passes fields to `place_order`. Env-gate refusal handled with a graceful cash-fallback.
- **Regression coverage (R-11).** New `tests/regression/SP-20260519-006/`: `pci-leak-guard.test.ts` (8 tests) proves no card digits survive scrub or appear in any returned field after `JSON.stringify`; `happy-path.test.ts` (3 tests) asserts all 10 disclosure beats appear in order + cash branch byte-identical + the constant matches C-1 byte-for-byte; `env-gate.test.ts` (8 tests) asserts the env helper requires exact `'true'` + zod schema rejects malformed inputs; `secret-guard-block.test.ts` (5 tests) drives the hook as a subprocess to confirm it blocks card content in `src/` but allows it in the allowlisted fixture path. Full suite: 323/323 (24 new on top of sprint 007's 5).
- **Ops playbook (R-12).** `_docs/operations/card-over-phone-safety.md` covers enable/disable, three-defense leak model, prepaid-card guidance, failure-mode taxonomy, rollback, non-prepaid-card incident response.

**Mid-execute observations (all caught + fixed pre-merge):** (1) the new secret-guard hook caught real card literals in my own docstring + execution-report prose — exactly the leak it's designed to prevent. (2) Format hook race condition wiped `src/a2a/executor.ts` to 0 bytes briefly during editing; the in-memory backup didn't detect it (event log said `wiped: false`); recovered via `git checkout`. Logged as a follow-up. (3) CVV-adjacent regex is narrower than initially assumed — intentional, documented.

Plan Contract: `PC-20260519-0014`. Release: `RL-20260519-009`. Beta DECIDE 0.87 (`EVT-s-sp-20260519-006-beta-001`). 17 tickets shipped (T-20260519-110..126). Outstanding follow-up: ADR capturing the ships-disabled + three-layer-defense rationale.

### SP-20260519-007 — Claude Desktop integration reliability (2026-05-19)

RT-007 quick-win path: convert the Claude Desktop ↔ aiweb MCP integration from an intermittently-failing 7-component series into a CI-enforced contract. Closes 4 of 6 RT-007 failure modes (F1, F2, F4, F5); F3 already closed (2026-05-18 incident response); F6 + optional vendored bridge explicitly deferred.

- **Cold-start eliminated (F1).** `fly.toml` flips `auto_stop_machines` from `'stop'` to `'suspend'`. Wake from suspend is ~200ms vs ~2-3s cold-start, restoring the first-call latency under mcp-remote's patience window. Free; fallback `min_machines_running=1` (~$3/mo) if Fly rejects suspend for this VM kind.
- **Canary on schedule (F2).** New `.github/workflows/cd-canary.yml` runs the existing `scripts/check-deployed-tools.js` against prod every 30 minutes. Stale deploy or tool-list drift now surfaces in 60s instead of "next user test." First run fails visibly until the operator adds `WARP_MCP_KEY` to repo secrets — by design.
- **Silent npm upgrades blocked (F4, F5).** `package.json` `@modelcontextprotocol/sdk` tilde-pinned (`~1.29.0`; was `^1.12.1` and had silently drifted to 1.29.0 — exactly the failure mode the pin names). `.cmd.template` exact-pins `mcp-remote@0.1.38`.
- **`npm run cd:doctor`.** New `scripts/cd-doctor.js` runs four checks (`/healthz` 5s timeout; `tools/list` vs canonical whitelist; `.cmd` bearer initialize-200; optional local `mcp-remote` version probe) and prints a deterministic green/red verdict in under 30 seconds. Designed for operator-after-update use; cron stays on `check-deployed-tools.js`.
- **Ops playbook.** New `_docs/operations/cd-doctor.md` documents each check, the GitHub Actions cron setup (one-time secret add), cold-start config, version-pin discipline, and escalation path.
- **Regression coverage.** New `tests/regression/SP-20260519-007/cd-doctor.test.ts` (5 tests) asserts green on healthy fixture + red on each simulated failure mode + a defense-in-depth assertion that the bearer value never appears in stdout/stderr/`events.jsonl`. Full suite: 299/299 (was 275 pre-sprint).
- **Mid-execute course corrections:** (1) SDK pin reality vs design — installed was already 1.29.0, pinned to current working version not the design's `~1.12.1` figure; (2) COPY C-1 verdict line split into all-pass and with-skipped variants for honesty when check 4 SKIPs; (3) `cd-doctor.js` exit path swapped from `process.exit()` to `process.exitCode =` to fix a Windows libuv `UV_HANDLE_CLOSING` assertion during async drain (generalizable lesson for operator scripts on Windows).

Plan Contract: `PC-20260519-0016`. Release: `RL-20260519-008`. 8 tickets shipped (T-20260519-102..109). 3 ESDs all in ready/integrated state.

### SP-20260517-005 — ai-web-debug-01 closure (2026-05-17 → 18)

The user-trace `_docs/00-user-communication/ai-web-debug-01.docx` showed two root-cause bug classes: stale prod deploy exposed removed profile tools, AND the compat verdict shipped a cart on a generic 3-item template when no real menu was knowable. Both proven empirically closed.

- **Stale-deploy class fix.** New `scripts/check-deployed-tools.js` runs an MCP `initialize` + `tools/list` against the deployed server and asserts the tool array equals the canonical 5-tool whitelist. Exits 0/1 + appends a `deploy.tools_list_snapshot` event for cron / CI canary use. Live-tested: correctly diagnoses the stale fly.dev deploy by name.
- **Menu discovery — link-discovery crawler.** Replaces homepage-only fetch with `findMenuPageCandidates` + multi-page concat (top 3 nav links, 7s shared budget, 25k char cap with page boundaries). Validated live on `kaleidoscopepizza.com`: surfaces `/pizza/`, `/eat/`, `/drink/` from a generic homepage that the prior fetcher returned 0 menu hits for.
- **`priceKnown` flag.** `EXTRACTION_PROMPT` now accepts `price: number | null`; post-process emits `priceKnown: false` for name-confirmed-but-priceless items (e.g. Toast-fed sites). Cart-narration treats `basePrice<=0` as already a price-unknown trigger.
- **Verdict-gate hardening.** `assessCompatibility` adds a 4-conjunct guard: when `source=places_generic_menu` AND `enrichment_attempted` AND `item_map` is non-empty AND every slot is `unknown`, escalates `overall` to `no_go` with `verdict_tier: "enrichment_failed"` and a verbatim C-2 nextStep. `place_order` mirrors the block with `error_code: "compatibility_blocked"` unless `override_compatibility: true` (audit-logged with `block_reason: "enrichment_failed"`). Presets path untouched. **(NOTE 2026-05-23: this escalation is now identified as a category error — see Sprint B-1. "We couldn't scrape the menu" ≠ "the restaurant lacks the item.")**
- **Multi-pizza intent (`intent_items.pizza` zod union).** Accepts singular `{style, size?}` OR an array; each entry becomes a `pizza:<style>` slot in `item_map`. Legacy `pizza` alias preserved + filtered in qualityScore / rollup to avoid double-counting.
- **R-8 industry-aligned schema.** New `src/lib/menu-taxonomy.ts` with Cuisine / Allergen / DietaryRestriction / Spiciness / PreparationMethod string-literal types from Google's `FoodMenu` schema. `CachedMenuResult` carries optional `cuisines[]`; per-item `allergen[]` + `dietaryRestriction[]`. Post-process drops unknown enum values silently. Fully back-compat: existing cache entries pass `isValidCachedMenuResult` unchanged.
- **`places.googleMapsUri` follow** — shipped post-deploy hotfix (`tryMapsUriEnrichment`): path-1 link-discovery + a single Maps-URI hop fallback for restaurants without parseable home sites.
- **Pre-warmed cache backstop.** `scripts/cache-warm.ts` + `seeds/menu-cache.json` (Medford OR + SF, 8 restaurants curated). Reads JSON, runs Places search + enrichEvidence, writes cache files. Spend ceiling $5 + refuse without `--confirm-spend`. Logs `cache-warm.run` event.
- **Sprint Goal Test.** New `tests/regression/SP-20260517-005/debug-01-replay.test.ts` replays the user's exact debug-01 flow and contractually asserts the new behavior. 5/5 BUG cases pass.
- **format-hook bug class fix.** Separate `/fix:deep` found `scripts/hooks/format.js` was wiping large TypeScript files to 0 bytes when `npx prettier --write` SIGTERM'd at the 10s timeout. Patched with in-memory backup + post-write size sanity check + audit log to `runtime/events.jsonl#format-hook.outcome`. `RT-format-hook-wipe` / `LRN-2026-05-18-format-hook-atomic-restore`.
- Background research: `.claude/project/reference/google-menu-apis-survey-2026-05.md` — confirmed across 4 Google sources that no public menu API exists for third-party reads. Scraping is the correct primary path.

Plan Contract: `PC-20260518-0011` supersedes `PC-20260517-0010`. Sprint Goal Test verification: all 3 bug classes empirically closed.

### YC sprint — compatibility layer (2026-05-06 → 07)

Three real demo failures (no-pizza, no-deliver, no-deliver-here) became one structural fix.

- New module `src/lib/compatibility.ts` with three checks (delivery / coverage / item) + `assessCompatibility` combiner returning `go | caution | no_go` with confidence + source + nextStep.
- Wired symmetrically into both surfaces: MCP `start_pizza_order` (embed per-restaurant + sort by verdict + reproduce-nextStep tool description) and A2A `proposed_cart` artifact.
- Hard block at `place_order` and at A2A `confirmed=true` — refuses to fire Bland when `overall === 'no_go'` unless `override_compatibility: true`.
- Bland prompt gains conditional ITEM-CONFIRM step when item availability is `unknown`.
- New helpers: `src/lib/geo.ts` (geocodeAddress), `src/lib/event-log.ts` (append-only `runtime/events.jsonl` writer, fail-open).
- Connector honesty: `src/connectors/places.ts` stops fabricating `deliveryRadius` (now `null` + `serviceType: 'unknown'`); `src/connectors/dominos.ts` sets `serviceType: 'delivery'` truthfully.
- Cross-provider review caught what same-provider missed: gpt (QA) caught snake_case intent normalization that Claude builder + Claude reviewer both missed.

Commits: `05ab8c0`, `ab77b28`, `4787381`, `4c7dcb9`, `a59e34c`, `8bc7ae5`, `3077fb3` (merge), `1ae13c7`, `aa78cff`, `ffc89c4`.

### Pizza intake upgrade (2026-05-02 → 04)

Per-restaurant size+price binding; address abbreviation expansion for TTS; shared cart domain model + extended menu schema; cart-flow surface + `update_order` tool + token cart-binding; delivery special-instructions; Bland intro line; A2A input-required upsell state; agent-card provider rebrand. Commits `015b7c4`, `b6e5cc5`, `08bf095`, `129840b`, `9d4cf43`, `a6008dc`, `1a95bce`, `0225e97`, `bb7f041`, `b18f275`, `0d21da5`.

---

## Sprint plan — menu-discovery reframe + follow-ons

> **Reorganized 2026-05-23 (product-lead pass).** The old area-grouped backlog became the sprint plan below: strategic frame first, then Sprints A–D in execution order, then un-sprinted "Later horizons." Source analysis: gpt-5.5-pro @ high (`runtime/gpt55pro/answer.md`), reasoning trace RT-006 (`.claude/project/memory/traces.jsonl`), and a fresh-session GitHub code audit (2026-05-23 conversation).

### The strategic frame (read this first)

**Hard product constraint (2026-05-23): the menu must be known BEFORE the call. The Bland call only PLACES an order for a menu we already have — it NEVER interrogates restaurant staff to discover or check the menu.** A "call to ask if they carry X" is explicitly rejected (bad UX for restaurant staff; makes the agent look like it doesn't know what it's selling).

> This **overrides** the confirm-on-call reframe that RT-006 and gpt-5.5-pro (`runtime/gpt55pro/answer.md`) recommended. Do NOT re-introduce a `phone_confirm_order` / confirm-before-commit path — it was considered and rejected by product decision. Keep the gpt analysis for its mechanical findings (the A2A wiring bug, the Domino's-suppression, the telemetry gap), not its phone-confirm recommendation.

Symptom this plan attacks: a real SF query returns ~20 pizzerias, 0 verified menus, agent dead-ends. Under the constraint the answer is two-pronged: (1) **raise the pre-call menu hit-rate** so more restaurants are orderable without a call, and (2) when we still don't have a menu, **never dead-end and never call to ask** — fall back to restaurants whose menu we DO have (Domino's + cached + successfully-scraped) and say so plainly.

Principles that drive the sprint order:
- **A failed scrape is not negative evidence.** "We couldn't find the menu" ≠ "the restaurant doesn't carry it." So a menu-unknown restaurant is never presented as "they don't have your item" — it's "I don't have their menu; here's what I *can* order from." The gate stays (no menu → no call), but the refusal becomes a helpful redirect, not a dead-end.
- **Pre-call discovery is the core capability investment (Sprint C), not an afterthought.** Domino's + cache give a guaranteed floor; better scraping + the per-restaurant-agent endgame (Later horizons) raise the ceiling.
- **Two surfaces drifted:** MCP *over-refuses* into a dead-end (`isPrimaryGeneric → fallback_discovery`); A2A *under-blocks* (`enrichmentAttempted` never passed → can cart a generic template menu). Sprint A-3 + Sprint B bring them to lockstep: both gate on real-menu, both redirect helpfully (`tests/narration-parity.test.ts`).
- **One dispatch gate (gpt review).** Every path that can place a call routes through a single `assertCanDispatchCall(cart, restaurant, evidence)` contract (Sprint A-0) — the pre-call rule is enforced once, not re-implemented per surface, so no menu-unknown restaurant can be called through any path (MCP, A2A, retries, confirmed-cart, Bland).

### Sprint A — Floor, safety, instrumentation
*Ship first. Small/reversible EXCEPT A-0 + A-2 (medium). Goal: every call dispatch is gated by one contract, the A2A leak + cart-desync are closed, the menu-check beat is gone, and discovery is measured. (Sequencing per gpt review 2026-05-23: D-1 and the ITEM-CONFIRM removal are release-blockers, pulled into A.)*

- [ ] **A-0 — `OrderabilityEvidence` contract + single dispatch gate (foundational — gpt review's top add).** One function `assertCanDispatchCall(cart, restaurant, evidence)` that EVERY call-dispatch path routes through: MCP `place_order`, A2A proposed + confirmed, retries, the Bland connector. Bind the cart to evidence (restaurant id, menu source, menu version/hash, item ids/names, prices-if-voiced, timestamp) and **revalidate at dispatch**. **Source precedence:** verified chain/cache/scrape wins; a later *unknown* scrape never overrides or blocks a known-menu order. Ship with golden parity tests across surfaces (generic-template blocked · menu-unknown redirected · Domino's allowed · failed-scrape ≠ no_go · stale evidence blocked · cart/evidence desync blocked). This is the spine that makes "no menu-unknown restaurant is ever called, through any path" enforceable.
- [ ] **A-1 — Telemetry (thin; don't let it block A-2/A-3).** Per-attempt discovery event (URL, host type, fetch status, timeout y/n, HTML bytes, JS-shell y/n, extractor counts, item-match outcome) PLUS decision-level events: `menu_verified`, `menu_unknown`, `item_not_found`, `price_missing`, `coverage_unknown`, `call_blocked_reason`, `call_dispatched`. → `runtime/events.jsonl`. ~2h. `src/lib/menu-discovery.ts`, `src/lib/event-log.ts`.
- [ ] **A-2 — Domino's merge + coordinates (the floor — medium, not small).** `findNearbyRestaurants` (`restaurants.ts:561`; all 4 callers `server.ts:610,1749`, `a2a/executor.ts:268,498` + both surfaces inherit). Change Places-then-Domino's-only-if-empty (`:574`) → run **both in parallel** (`Promise.allSettled`, failure-isolated), dedupe by name+address / phone (prefer `dominos_*` over a `places_*` duplicate). Geocode Domino's store address (`dominos.ts mapToRestaurant`) so coverage stops being `unknown`. **Strong floor, not a guarantee** — a true `go` still needs store hours, delivery radius, cash acceptance, store-level menu/pricing. ~1 day incl. tests. `src/data/restaurants.ts`, `src/connectors/dominos.ts`.
- [ ] **A-3 — A2A honesty fix (route through A-0).** `executor.ts`: pass `{enrichmentAttempted:true}` in **both** branches (`:363-371`) incl. the unchanged-return case; add the `isPrimaryGeneric` guard MCP has but A2A lacks; the confirmed-order path (`:613-620`) goes through `assertCanDispatchCall`, not a fresh stateless assessment. ~half day. `src/a2a/executor.ts`.
- [ ] **A-4 — Cart/compatibility desync (ISS-005 / RT-201; moved up from Sprint D — core safety, not "adversarial later").** `place_order` recomputes compatibility against unbound `intent_style` → a caller can pass one intent and dispatch another cart. Derive compatibility from the bound cart+evidence (via A-0). ~30 LOC, `server.ts` + `executor.ts`.
- [ ] **A-5 — Remove the Bland ITEM-CONFIRM "do you carry X?" beat NOW (moved up from B; honors the pre-call constraint immediately).** Strip the conditional ITEM-CONFIRM step from `connectors/bland.ts buildCallPrompt` + mirrored narration in `server.ts`/`executor.ts`; update `tests/narration-parity.test.ts`. Small removal; no reason to wait for Sprint B. **Until this ships, real calls still violate the decided constraint.**

**Sprint Goal Test:** every call dispatch goes through `assertCanDispatchCall`; generic-template blocked on both surfaces; cart/evidence desync blocked; Bland prompt has NO menu-check beat; Domino's appears as orderable on a SF query; telemetry event per attempt + per decision.

### Sprint B — Graceful known-menu fallback (messaging/routing only)
*Replaces the dead-end refusal with a helpful redirect. Messaging + routing only — fetch/extract/verify of a pasted URL is a SEPARATE feature, don't scope it in. Class-B; short PRD first.*

- [ ] **B-1 — `fallback_discovery` → "known-menu options" with EXPLICIT user re-selection.** Rank the orderable real-menu restaurants (Domino's/cache/scraped) to the top, separated from menu-unknown, with "I have menus for these; couldn't get menus for those." **Do NOT silently substitute the restaurant** (gpt review) — the user must choose the alternative before any call. `server.ts:974-980` + `:876-924`. *Demo richness depends on A-2 (Domino's) + Cα-3 (cache-warm) being non-empty.*
- [ ] **B-2 — Gate messaging only (logic unchanged).** `enrichment_failed → no_go` stays (no menu = no call), but its `nextStep`/C-2 copy stops implying the restaurant lacks the item — redirect to known-menu options or "paste a menu URL." `compatibility.ts:921` copy.
- [ ] **B-3 — Bland failure rule: abort, never discover.** If staff say an item is unavailable *during placement*, the call must NOT ask for substitutes or do menu discovery — abort + report failure (gpt review; enforces "no menu discovery on the call" even in the failure path). `connectors/bland.ts` prompt + transcript parse.
- [ ] **B-4 — Lockstep via A-0.** Both surfaces emit the same redirect through the `assertCanDispatchCall` gate; narration-parity tests cover it.

**Sprint Goal Test:** a SF query where only Domino's/cached have real menus returns those as orderable options (not a dead-end, not a call-to-check); the user must re-select before a call fires; a menu-unknown restaurant is never dispatched a call through any path.

### Sprint C — Pre-call discovery capability (split per gpt review — it's a research backlog, not one sprint)
*The ceiling-raiser: every restaurant whose menu we resolve PRE-CALL becomes orderable. Measure by orderable N/20 per metro. Anything that produces a menu must bind real `OrderabilityEvidence` (A-0) before a call — "maybe menus" don't count.*

**C-alpha — capability quick wins (cheap, high-certainty):**
- [ ] **Cα-1 — `ENRICH_COUNT` > 1, parallel.** Attempt all candidates pre-call, not just top-1 (today's dominant gap — 19/20 never tried). `server.ts:708-730`.
- [ ] **Cα-2 — LLM-rank link discovery.** Haiku scores anchors 0-1 (catches `/our-fare/`, `/carte/`, foreign-language, JS-nav). ~1h.
- [ ] **Cα-3 — Cache-warm expansion (operator-curated verified menus).** Extend `scripts/cache-warm.ts` + `seeds/menu-cache.json` for demo metros — a guaranteed pre-call real-menu source independent of scrape success. Demo-critical; pull forward if B-1 needs non-Domino's options.

**C-beta — headless browser (gated on A-1 telemetry):**
- [ ] **Cβ-1 — Playwright for the top failing host classes** (Toast/DoorDash/SPA that 403 a curl UA — most independents; the biggest hit-rate lever). Build only after telemetry identifies the failing hosts. **Realistic effort > 1wk** (anti-bot, timeouts, rate limits, vendor DOMs, screenshot fallback, caching, ToS review).

**C-research — spikes, low priority:**
- [ ] **Cr-1 — Photos OCR via Claude vision** (cache-warm-first; ~10× tokens). `places.photos` → "is this a menu? extract items."
- [ ] **Cr-2 — `web_search`-for-menu** — valid ONLY if the SERVER fetches/parses/binds the evidence before the call (gpt review). An agent web-search hint alone can't justify voicing items.
- [ ] **Cr-3 — Places menu-adjacent fields** (`reviews[].text`, editorial/generative summary, `serves*`) — for candidate **RANKING only, NOT item/price evidence** (gpt review). Don't let review text justify voicing a menu item. Bumps to Enterprise+Atmosphere SKU.
- [ ] **Cr-4 — Actions Center Menus interest form** (paperwork; future first-party API).
- [ ] ~~Inline-Haiku on raw Maps HTML~~ — **CUT** per gpt review: brittle, policy-sensitive, lower leverage than cache-warm + Playwright. Revisit only if telemetry proves it beats normal discovery.

### Sprint D — Chores / unblock-as-needed (not a product pillar)
*RT-201 moved up to A-4 (it's core safety). What remains are chores per gpt review — do them when they block CI/release, not as sequenced product work.*

- [ ] **ISS-001.** Keyless geocoding fallback returns caution for known SF fixtures; add city-name string-match fallback.
- [ ] **ISS-002 (tooling).** codex CLI cold-start race on Windows; extend `providerAvailable()` with a `which codex` ping.
- [ ] **ISS-003 (account).** Gemini 3.1-pro 404 on free-tier key; upgrade to Tier 1+ Google Cloud billing or join the 3.1 preview allowlist.

### `businessMenus` clarification (keep — anti-misinformation record)

The Places API (New) **does not** have a `businessMenus` field. Confirmed across six canonical Google sources (REST reference, Place Details, Place Data Fields, release notes 2024-2026, the machine-readable discovery doc at `places.googleapis.com/$discovery/rest?version=v1`, official example curls). Aggregator blogs (foodspark.io et al.) fabricate it to drive their scraping service; LLM search tools absorbed the misinformation. Empirical: any curl with `fields=...,businessMenus` → 400 INVALID_ARGUMENT. (See CLAUDE.md "LLM-aggregator agreement is not independent confirmation.")

### Later horizons (not yet sprinted — preserved from prior backlog)

- **Per-restaurant agent / A2A restaurant card (the AI-Web endgame for pre-call discovery).** Give each restaurant its own A2A agent card carrying its real menu, hours, delivery radius, payment methods, and capabilities — so pre-call menu discovery becomes an agent-to-agent handshake instead of a scrape (directly satisfies the "menu known before the call" constraint). Our concierge queries the restaurant's card for the menu; longer term the order itself can go agent-to-agent. Bootstrap path: we synthesize + host cards from our best discovered/cached data per restaurant, then upgrade to restaurant-owned cards as the AI Web grows. Implement as another `VerifiedMenuSource` plug-in behind the A-0 evidence contract (gpt review) — restaurant-owned cards are the cleanest verified source, but **adoption is the hard part, so it's a later bet, not a near-term dependency**. Touches `src/a2a/agent-card.ts` + a per-restaurant card store; builds on the existing A2A surface. The structural long-term answer to Sprint C's hit-rate problem.
- **Menu connector depth.** Real Domino's menu adapter emitting the full `Cart` schema (modifiers/drinks/deals — today only pizzas/sides); new chain connectors (Pizza Hut, Papa John's, Little Caesars), each its own auth/rate-limit story.
- **Deal intelligence.** Compute whether a published deal beats the user's cart (per-component pricing, not total-vs-total; a wrong "you'd save $X" is worse than none); multi-restaurant/cross-chain bundles (out of scope v1).
- **Cart depth.** Half/whole topping placement (schema supports `SelectedModifier.half`); per-size modifier pricing (`priceDelta: number | {sizeId,price}[]`); tax / fees / tip line items.
- **Auth + identity** (multi-week; gates Profile depth). Per-user JWT signup/magic-link; identity store; per-user tokenHash from JWT claims (not the shared `WARP_MCP_KEY`); JWT validation at `/mcp` + `/a2a`; multi-user isolation tests.
- **Profile depth** (blocked on Auth; HTTP/MCP profile surface removed in SP-20260514-001 due to single-bearer cross-user leak). `preferred_drinks` / `preferred_modifiers` mined once N>10 users; structured address fields.
- **Voice quality.** Per-restaurant `speakable_name`; phonetic respelling for unusual items; SSML upgrade when Bland supports it; **Claude places the call itself** (real-time TTS/STT, removes Bland as runtime dep — significant integration).
- **Compliance + commerce.** Production-grade card flow (Stripe MPP or chain tokenization; supersedes the shipped alpha card-over-phone path; blocked on per-user auth); structured allergen fields per `MenuItem`.
- **Claude Desktop reliability — remainder.** SP-20260519-007 closed F1/F2/F4/F5; F3 done (2026-05-18). Remaining: F6 (stale `bridge-state.json` replay) + optional vendored stdio↔HTTP bridge replacing `mcp-remote` — build only if the cron canary shows recurring mcp-remote regressions.

---

## Human verification test (Phase 6 manual smoke)

Goal: prove the compatibility layer works end-to-end on real surfaces, with one positive flow and three blocker flows.

> **NOTE (2026-05-23):** Flow #5 (caution) behavior CHANGES under Sprint B — a menu-unknown Places restaurant becomes a "known-menu options" redirect (steer to Domino's/cached/scraped), NOT a dead-end and NOT a call-to-check-menu. The Bland ITEM-CONFIRM beat is removed (B-3). Re-baseline this table after B ships.

### Pre-flight (60 sec)

1. `npm run build` — should exit 0 clean.
2. `npm test` — should print all-pass (323+ as of SP-006; re-verify).
3. Confirm `runtime/events.jsonl` exists OR the runtime dir is writable.
4. Server: `npm run dev` — should bind on the configured port.

### Test plan — 5 flows × 2 surfaces (10 cases)

The two surfaces are **MCP** (Claude Desktop or `mcp-remote` bridge) and **A2A** (the test panel at https://aiweb-mcp.fly.dev). Run each flow on both.

| # | Flow | Address + intent | Expected `compatibility.overall` | place_order behavior | Notes |
|---|---|---|---|---|---|
| 1 | E (success path) | `1 Market St, San Francisco, CA 94105` + `meat_lovers` | `go` on `test_vlad` | dispatches Bland call cleanly | Demo Beat 3 — happy path |
| 2 | A (no-deliver) | same address + `pepperoni`, force `test_pickup_only` | `no_go` (delivery=`pickup_only`) | refuses with `compatibility_blocked` | Demo Beat 4 |
| 3 | C (wrong-item) | same address + `sushi`, target `test_vlad` | `no_go` (item=`not_available`) | refuses, surfaces `nextStep` | Demo Beat 5 |
| 4 | B (out-of-range) | distant address + any intent (far Domino's) | `no_go` (coverage=`out_of_range`) | refuses | Domino's `lat:0/lng:0` → `unknown` is the v2-delta C-1 mitigation |
| 5 | D (menu-unknown redirect) | same address + `meat_lovers`, force a `places_*` restaurant | `caution`/`no_go` today; "known-menu options" redirect after Sprint B | does NOT call a menu-unknown restaurant; offers known-menu ones instead | Verifies graceful redirect, not dead-end, not call-to-check |

### Per-surface checklist for each flow

**MCP (Claude Desktop):** connect `aiweb-pizza` server → send NL prompt → check the response reproduces `nextStep` verbatim on caution/no_go → confirm Bland fires (or doesn't) per expectation → inspect `runtime/events.jsonl` for a `compatibility` event (+ `compatibility-override` if used).

**A2A (test panel):** open https://aiweb-mcp.fly.dev (bearer + agent-card preloaded) → send structured message with the same address+intent → inspect `proposed_cart` for `compatibility` (delivery/coverage/item/overall + nextStep) → resubmit with `confirmed:true` (+ token); no_go → `compatibility_blocked`, go → Bland dispatch → same events inspection.

### What to look for that the gauntlet can't see

- Does the agent's NL reply on a caution/phone-confirm flow surface the unknown clearly to YOU, reproducing `nextStep` verbatim (not paraphrased)?
- Does the Bland ITEM-CONFIRM / confirm-before-commit step sound natural to the restaurant?
- On Beat 1: does the cart preview shown BEFORE confirmation match what Bland actually orders? Drift = ISS-005 territory in the honest path.

### Known gaps during your test (do not flag as bugs)

- **RT-201 / ISS-005:** mutating `intent_style` between `start_pizza_order` and `place_order` to a compatible value while keeping a no_go cart WILL pass the gate (deferred adversarial bypass → Sprint D-1). Honest-path testing won't trip it.
- **Gemini quota:** Gemini Pro 404s on this account (free-tier `limit:0`). Affects only redteam dispatch (already runs via openai).

---

## Crash-recovery / Resume instructions

**If a fresh-eyes session asks "where do I start?":**

1. Read this file's **Current state** (top) + the **Sprint plan → strategic frame**.
2. The menu-discovery reframe is the active thread. Full external analysis: `runtime/gpt55pro/answer.md` (gpt-5.5-pro @ high, 2026-05-23). Reasoning root-cause: RT-006 in `.claude/project/memory/traces.jsonl`.
3. **Start with Sprint A** (A-1 telemetry → A-2 Domino's merge → A-3 A2A honesty fix) — all small, reversible, no strategic dependency. Then Sprint B (`phone_confirm_order`) needs a `/sprint:plan` PRD before touching the order flow.
4. Open bugs: `issues.md` (ISS-005/RT-201 → D-1).

**If the session crashes mid-work:**

1. Reopen Claude Code here; SessionStart hook auto-loads the previous handoff.
2. Read this file → `git status && git log --oneline -10`.
3. If you were in adhoc mode: `node scripts/mode-set.js adhoc --by alpha`.
4. Resume from the first unchecked Sprint A item.

---

## Known risks

1. **Failed scrape treated as negative evidence (category error).** The `enrichment_failed → no_go` gate conflates "we couldn't find the menu" with "the restaurant lacks the item." The gate itself is CORRECT under the pre-call constraint (no menu → no call), but its messaging must redirect to known-menu options, not dead-end or imply the item is unavailable. Fix: Sprint B-1/B-2.
2. **A2A under-blocking (honesty leak).** `executor.ts` never passes `{enrichmentAttempted:true}` (both branches) and lacks MCP's `isPrimaryGeneric` guard → A2A can cart + voice a generic 3-item template menu over a real call. Fix: Sprint A-3.
3. **Domino's suppressed by Places.** `restaurants.ts:574` queries Domino's only when Places returns zero → in any populated metro the one guaranteed-real-menu source is excluded. Fix: Sprint A-2.
4. **Places restaurants ship `deliveryRadius: null`.** Coverage is always `unknown` for non-Domino's discoveries. Phone-confirm (Sprint B) is the structural mitigation.
5. **Domino's lat/lng=0 in API response.** Coverage short-circuits to `unknown` for Domino's (PRD-V2-DELTA C-1). Real fix: geocode store address — folded into Sprint A-2.
6. **Token-binding mutation surface (RT-201).** Any second-pass validation must re-derive inputs from already-bound data. Generalizes beyond compatibility. Fix: Sprint D-1.
7. **Demo-environment fragility.** `test_vlad` is hardcoded with SF coordinates; demo uses `1 Market St, San Francisco`. Do NOT use distant addresses (e.g. Riddle, OR — ~600 mi away).
8. **3-strike fix-cap.** If a recurring bug class hits cap 3+ in a single sprint, log to issues.md and defer (Beta P-025, HARD-RULE).

---

## Notes

- **YC application materials:** `yc-application.md` (running session journal), `yc-application-brief.md` (paste-ready pitch), `yc-export-01.md` / `yc-export-02.txt` (session exports). Menu-delivery analysis: `yc-menu-delivery-compatibility.md`.
- **Sprint discipline:** main branch must stay shippable. Exploratory work on feature branches in `.worktrees/`. Every PR passes `npm run build` clean before merge.
- **Cross-repo parity:** WarpOS framework changes flagged in `warpos-to-update.md` drain on `/warp:promote` or `/warp:release`. Don't propagate manually.
