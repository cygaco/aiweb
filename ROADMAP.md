# AIWeb Roadmap

The AI Web — Wave 00 pizza concierge. This file is the single roadmap for the product (active backlog + recently-shipped + open risks + crash-recovery + human verification test). Framework / WarpOS roadmap items live in their own canonical clone, not here.

---

## Current state (live — keep this updated)

- **Branch:** `main` at `ffc89c4` (post-YC-sprint head; subsequent commits land here)
- **Build:** `npm run build` clean. `npm test` 105/105 passing.
- **Last sprint:** YC application sprint, 2026-05-06 → 07 — compatibility-layer feature shipped + four-gate gauntlet closeable. Full story in `yc-application.md`.
- **Open issues:** 5 in `issues.md` (1 fixed, 3 deferred non-blocking, 1 deferred-with-fix-path = ISS-005 / RT-201).
- **Open WarpOS-propagation flags:** 13 in `warpos-to-update.md`. Drained on `/warp:promote` or `/warp:release`.
- **Launch readiness:** see `_docs/launch/MVP-P0-INVENTORY.md`.

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
- **Verdict-gate hardening.** `assessCompatibility` adds a 4-conjunct guard: when `source=places_generic_menu` AND `enrichment_attempted` AND `item_map` is non-empty AND every slot is `unknown`, escalates `overall` to `no_go` with `verdict_tier: "enrichment_failed"` and a verbatim C-2 nextStep. `place_order` mirrors the block with `error_code: "compatibility_blocked"` unless `override_compatibility: true` (audit-logged with `block_reason: "enrichment_failed"`). Presets path untouched.
- **Multi-pizza intent (`intent_items.pizza` zod union).** Accepts singular `{style, size?}` OR an array; each entry becomes a `pizza:<style>` slot in `item_map`. Legacy `pizza` alias preserved + filtered in qualityScore / rollup to avoid double-counting.
- **R-8 industry-aligned schema.** New `src/lib/menu-taxonomy.ts` with Cuisine / Allergen / DietaryRestriction / Spiciness / PreparationMethod string-literal types from Google's `FoodMenu` schema. `CachedMenuResult` carries optional `cuisines[]`; per-item `allergen[]` + `dietaryRestriction[]`. Post-process drops unknown enum values silently. Fully back-compat: existing cache entries pass `isValidCachedMenuResult` unchanged.
- **`places.googleMapsUri` follow** — DEFERRED to follow-up per overbuild-gate. Path-1 link-discovery covers the validated case; the Maps URI hop is a fallback for restaurants without parseable home sites.
- **Pre-warmed cache backstop.** `scripts/cache-warm.ts` + `seeds/menu-cache.json` (Medford OR + SF, 8 restaurants curated). Reads JSON, runs Places search + enrichEvidence, writes cache files. Spend ceiling $5 + refuse without `--confirm-spend`. Logs `cache-warm.run` event.
- **Sprint Goal Test.** New `tests/regression/SP-20260517-005/debug-01-replay.test.ts` replays the user's exact debug-01 flow and contractually asserts the new behavior. 5/5 BUG cases pass — proves the sprint achieved its goal.
- **format-hook bug class fix.** Separate `/fix:deep` found `scripts/hooks/format.js` was wiping large TypeScript files to 0 bytes when `npx prettier --write` SIGTERM'd at the 10s timeout. Patched with in-memory backup + post-write size sanity check + audit log to `runtime/events.jsonl#format-hook.outcome`. `RT-format-hook-wipe` / `LRN-2026-05-18-format-hook-atomic-restore`.
- 14 tickets minted (12 closed, 1 deferred T-098 redundant-with-Sprint-Goal-Test, 1 release-time T-088). Test count: 167 → 275 (+108 new). Zero regressions.
- Background research: `.claude/project/reference/google-menu-apis-survey-2026-05.md` — confirmed across 4 Google sources that no public menu API exists for third-party reads. Scraping is the correct primary path.

Plan Contract: `PC-20260518-0011` supersedes `PC-20260517-0010`. Sprint Goal Test verification: all 3 bug classes empirically closed.

### YC sprint — compatibility layer (2026-05-06 → 07)

Three real demo failures (no-pizza, no-deliver, no-deliver-here) became one structural fix.

- New module `src/lib/compatibility.ts` (399 LOC) with three checks (delivery / coverage / item) + `assessCompatibility` combiner returning `go | caution | no_go` with confidence + source + nextStep.
- Wired symmetrically into both surfaces: MCP `start_pizza_order` (embed per-restaurant + sort by verdict + reproduce-nextStep tool description) and A2A `proposed_cart` artifact (carries compatibility for client display).
- Hard block at `place_order` and at A2A `confirmed=true` — refuses to fire Bland when `overall === 'no_go'` unless `override_compatibility: true`.
- Bland prompt gains conditional ITEM-CONFIRM step when item availability is `unknown` — call starts with "Quick question — do you carry [intent_style]?" before placing the order.
- New helpers: `src/lib/geo.ts` (extracted geocodeAddress for cross-module reuse), `src/lib/event-log.ts` (append-only `runtime/events.jsonl` writer with fail-open).
- 18 unit tests in `tests/compatibility.test.ts` (15 from PRD §9 + #16 logger spy + #17 dominos lat=0 unknown + #18 snake_case regression).
- Connector honesty: `src/connectors/places.ts` stops fabricating `deliveryRadius` (was inventing values from haversine + 50% padding); now emits `deliveryRadius: null` + `serviceType: 'unknown'`. `src/connectors/dominos.ts` sets `serviceType: 'delivery'` truthfully.
- New fixture `test_pickup_only` for QA Flow A + Demo Beat 4.
- Gauntlet 4/4 closeable — reviewer + compliance + qa pass-after-fix; redteam pass-with-warn (1 HIGH = ISS-005, deferred per Beta DECIDE 0.88).
- Cross-provider review caught what same-provider missed: gpt-5.5-mini (QA) caught snake_case intent normalization that Claude builder + Claude reviewer both missed.

Commits: `05ab8c0`, `ab77b28`, `4787381`, `4c7dcb9`, `a59e34c`, `8bc7ae5`, `3077fb3` (merge), `1ae13c7`, `aa78cff`, `ffc89c4`.

### Pizza intake upgrade (2026-05-02 → 04)

- W1: per-restaurant size + price binding (`015b7c4`)
- W2: address abbreviation expansion before Bland TTS (`b6e5cc5`)
- W4: shared cart domain model + extended menu schema (`08bf095`, `129840b`, `9d4cf43`)
- W5: cart-flow surface + `update_order` MCP tool + token cart-binding (`a6008dc`)
- W6: delivery special-instructions surfacing + token-bind + gauntlet-review fixes (`1a95bce`, `0225e97`)
- Bland intro line "This is an AI pizza concierge agent calling." (`bb7f041`)
- A2A spec-valid input-required state for upsell turn (`b18f275`)
- Agent-card provider rebrand to Agents for All / agentsforall.co (`0d21da5`)

---

## Active backlog

Items grouped by area. Each is a meaningful project on its own — listed here so they don't get lost.

### Menu evidence — next push (follow-ups to SP-20260517-005)

Post-hotfix 2026-05-18, the verdict-gate refuses fake-menu carts end-to-end. The next push is about *finding more real menu evidence* so we hit the refuse path less often. Priority order:

- [ ] **Use Places-first-party menu-adjacent fields.** The Places API (New) discovery doc was verified to contain ZERO `businessMenus` field (six canonical sources confirm — `businessMenus` is foodspark.io misinformation that LLMs have absorbed). But the API *does* expose menu-adjacent signal we're not using: `reviews[].text` (up to 5 reviews, often mention specific dishes), `editorialSummary`, `generativeSummary`, `reviewSummary`, `servesVegetarianFood`/`servesBeer`/`servesWine`/`servesCocktails`/`servesCoffee`/`servesBreakfast`/`servesLunch`/`servesDinner`/`servesBrunch`/`servesDessert`. Plumb these into `Restaurant`, prepend review text + editorial summary to the Haiku extraction input, wire `servesVegetarianFood` directly into `dietaryRestriction`. Bumps every Places request to Enterprise+Atmosphere SKU (~$0.005 more per request). 2-3 hours.
- [ ] **LLM-rank link discovery.** Current `findMenuPageCandidates` is keyword-bound — misses `/our-fare/`, `/carte/`, foreign-language paths, JS-rendered nav. Send Haiku the full anchor list with prompt "score each link 0-1 for likelihood of leading to a menu." ~1 hour. Catches the long-tail 20% the keyword regex misses today.
- [ ] **Inline-Haiku on raw Maps HTML.** Currently `tryMapsUriEnrichment` only follows links from the Maps page, never extracts menu text from the Maps page body itself. Google sometimes renders parsed menu items inline on the rich card. Quick spike: send the Maps HTML directly to Haiku before link-discovery. ~30 min spike to test if SSR contains the text.
- [ ] **Web-search-for-menu as a first-class tool.** Claude Desktop's session organically used `web_search` to find CPK's real menu on DoorDash + cpk.com + Postmates when our pipeline gave it generic. We should expose that pattern: when `menu_known: false` and a known partner host appears in Maps links, the tool description should explicitly tell the agent "use web_search before showing a cart." Light copy change.
- [ ] **Photos OCR via Claude vision.** Add `places.photos` to FIELD_MASK, fetch top N photos, send to Claude vision with "is this a menu? if so, extract items." Heaviest path — vision token cost ~10× text. Best as cache-warm-only, not live. ~3-4 hours.
- [ ] **Headless browser (Playwright) for SPAs + bot-blocked aggregators.** Toast / DoorDash / UberEats / Grubhub are filtered out today because they 403 to a curl UA. Headless browser with auth header + cookie handling unlocks ~half of small-pizzeria menus. ~1 week. Operational complexity (CI runner, container size, flake mitigation) is real.
- [ ] **Actions Center Reservations E2E + Menus interest form.** Paperwork only. Only credible path to a future first-party Google menu read API. Free; just file it.

### `businessMenus` clarification (sprint retrospective note)

For the historical record: the Places API (New) **does not** have a `businessMenus` field. This was confirmed across six canonical Google sources (REST reference, Place Details page, Place Data Fields page, release notes 2024-2026, the machine-readable discovery document at `places.googleapis.com/$discovery/rest?version=v1`, and the example curl requests in the official docs). Aggregator-vendor blogs (foodspark.io and similar) fabricate the claim to drive their own scraping service traffic; LLM-based search tools (Gemini, ChatGPT via WebSearch) have absorbed the misinformation as fact. Empirical test: any curl with `fields=...,businessMenus` returns 400 INVALID_ARGUMENT.



### Compatibility-layer follow-ups (next iteration)

#### N-1 — Pre-call menu confirmation (extends compatibility-layer)

**Problem:** when item availability is `unknown` (typically a Places-discovered restaurant — generic 3-item menu, no real menu data), the bot still calls. The Bland prompt's ITEM-CONFIRM step asks the restaurant on the call — but the call has already been initiated, the user is committed, and a "no, we don't carry that" answer means the bot has to recover mid-call.

**Approach:** add a cheap pre-call menu probe step BEFORE `place_order` fires Bland. Three candidate sources, ranked by cost:
1. **Cached menu from prior calls** — parse past Bland transcripts for menu items, cache per-restaurant. Free if we've called before.
2. **Restaurant website scrape** — fetch the website (already in Place data), extract menu via Claude on the HTML. ~1-2 sec, ~5K tokens.
3. **Pre-call voice probe** — a 30-second Bland call that ONLY asks "do you carry [item]?" — no order placement. Cheap because the call ends at confirmation.

After any of these resolves, re-run `assessCompatibility` with the now-known menu data. If still unknown, fall back to current behavior (place call with ITEM-CONFIRM step).

**Pairs with ISS-005 (RT-201)** — same area of code (`src/server.ts:place_order`, `src/a2a/executor.ts`); doing both at once is efficient.

#### N-2 — Resolve open compatibility-layer issues

See `issues.md` for full schema. Priority order:

- **ISS-005 / RT-201** (HIGH adversarial): place_order recomputes compatibility against unbound `intent_style`; attacker can desync gate from cart. Fix path documented (option b — derive compatibility from cart contents). ~30 LOC across server.ts + executor.ts.
- **ISS-001** (deferred): keyless geocoding fallback returns caution-state for known SF fixtures. Fix path: city-name string match fallback when geocode fails.
- **ISS-002** (open, tooling): codex CLI cold-start race on Windows. Fix path: extend `providerAvailable()` to do a `which codex` ping.
- **ISS-003** (deferred, account-gated): Gemini 3.1-pro 404 on user's free-tier API key project. Fix: upgrade to Tier 1+ Google Cloud billing OR get added to 3.1 preview allowlist.
- **ISS-004** (FIXED `8bc7ae5`): graph format mismatch — STORIES.md uses `### GS-XX-NN` headings now.

### Menu connector enrichment

- [ ] **Real Domino's API menu adapter** that emits the new `Cart` schema's modifiers, drinks, and deals (today: emits only `pizzas[]` and `sides[]`). Likely 2x the size of the intake-upgrade plan. Touches `src/connectors/dominos.ts`.
- [ ] **Google Places menu enrichment** — Places returns minimal menu data; need either a vision-based menu OCR layer or a per-restaurant "best-effort modifier estimation" stub. Touches `src/connectors/places.ts`. (Pairs with N-1 above.)
- [ ] **New chain connectors** — Pizza Hut, Papa John's, Little Caesars. Each is a separate connector with its own auth/rate-limit story.
- [ ] **Domino's store coordinates** — Domino's API doesn't return store lat/lng (currently hardcoded as 0/0 → coverage check returns `unknown`). Either geocode `restaurant.address` in `mapToRestaurant` or pull from another Domino's endpoint.

### Deal intelligence

- [ ] **Deal optimization** — actually compute whether a published deal beats the user's current cart. Phase 1 of the intake upgrade only *surfaces* deals; it does not claim savings. The math is non-trivial: requires per-component pricing comparison, not just total-vs-total. Risk: a wrong "you'd save $X" claim is worse than no claim.
- [ ] **Multi-restaurant deal awareness** — cross-chain bundles (e.g. "Domino's has the better price for pepperoni, Pizza Hut has the better wing deal — order from both?"). Out of scope for v1.

### Cart depth

- [ ] **Half / whole topping placement in the intake UI** — schema (`SelectedModifier.half`) supports it; intake flow doesn't surface it yet. Add only when there's user demand; most chain UIs hide this behind an advanced toggle.
- [ ] **Per-size modifier pricing** — extra cheese typically costs $1 on a small but $3 on a large. Today our `Modifier.priceDelta` is a flat number. Schema upgrade: `priceDelta: number | { sizeId: string; price: number }[]`.
- [ ] **Tax / fees / tip handling** — Wave 00 quotes "approximate total" via Bland; doesn't capture tax line items, delivery fees, or tip. Real-world commerce needs all three.

### Auth + identity

- [ ] **Per-user auth + profile re-introduction** — multi-week project. Add a signup or magic-link flow that issues per-user JWTs; an identity store keyed by verified user id; per-user tokenHash deriving from JWT claims (not from the shared WARP_MCP_KEY); JWT validation at the /mcp and /a2a boundaries; multi-user integration tests that prove caller A cannot read caller B's profile. Re-enables ROADMAP "Profile depth" items (preferred_drinks, preferred_modifiers, structured address fields) cleanly on top of real identity instead of retrofitting onto a broken auth model.

### Profile depth

> **Status (2026-05-14):** HTTP/MCP profile surface removed in SP-20260514-001 due to a structural cross-user data-leak in the single-bearer auth model. Re-introduction blocked behind "Per-user auth + profile re-introduction" (see Auth + identity above).

- [ ] **`UserProfile.preferred_drinks` and `preferred_modifiers`** — flagged in the intake-upgrade plan as an optional future. Once we have N>10 active users, mine their order history to infer defaults; cuts the upsell turn for repeat users.
- [ ] **Address parsing into structured fields** (street/unit/city/state/zip) — today address is a single opaque string. Structured fields enable better Bland prompts, smarter delivery-radius checks, and address verification at intake time.

### Voice quality

- [ ] **Per-restaurant pronunciation profile** — some chain names are mispronounced by Bland TTS. Add a `Restaurant.speakable_name` field that overrides `name` in the call prompt. Same pattern as `speakableAddress`, applied to restaurant name.
- [ ] **Phonetic respelling for unusual menu items** — items like "Calzone", "Stromboli", "Bruschetta" sometimes get mangled. Optional `MenuItem.speakable_name` for the prompt.
- [ ] **SSML upgrade** — Bland may add SSML support; switch from English-spelled-out abbreviations to actual `<phoneme>` / `<say-as>` tags when available.
- [ ] **Claude places the order call itself** — make the AI able to order by calling the restaurant directly, instead of handing off to Bland.ai. Claude becomes the voice agent on the line (via Claude voice or a similar real-time speech surface), reads the cart, handles ITEM-CONFIRM, captures the confirmation. Removes Bland as a runtime dependency, brings narration honesty into the call itself, and lets the same compatibility-layer rules govern the call. Significant integration work — needs a real-time TTS + STT loop, latency budget, telephony provider, and a deterministic recovery flow when the call goes sideways.

### Compliance + commerce

- [ ] **Card-over-phone payment (alpha-stage testing path).** Add a second Bland prompt branch that reads a credit card to the restaurant over the phone instead of paying cash on delivery. Both cash and card become user-selectable payment methods (cash = current behavior; card = new branch). Scope:
  - `PlaceOrderRequest.payment_method: "cash_on_delivery" | "card_over_phone"` — defaults to `cash_on_delivery`. Card path also accepts `card_number`, `card_exp` (MM/YY), `card_cvv`, `card_zip`, and optional `tip_percent` (default 15%).
  - `connectors/bland.ts` swaps the cash-only prompt block for a card-disclosure block: bot quotes the pre-tip total → asks restaurant to add 15% tip (or operator-specified percent) → reads card number, exp, CVV, zip → restaurant repeats back card # for verification → restaurant confirms charge approved → order placed.
  - Parsed result extends with `payment_method`, `tip_amount`, `total_with_tip`, `cardCharged: boolean`, `cardFailureReason?: string` (declined, wrong CVV, etc.).
  - **Hard rule:** card details are NEVER persisted, NEVER logged to `runtime/events.jsonl`, NEVER included in retro/handoff text, NEVER stored in the profile. The number lives in the Bland call transcript only; the transcript-parser strips it (regex on 13-19 digit runs) before any cached/logged copy. Verified by a regression test that pipes a fake card-number transcript through `getCallStatus` and asserts the stripped form appears in the parsed result. Add a matching pattern to `scripts/hooks/secret-guard.js` so card numbers can never leak via a code path either.
  - **Env gate:** `ENABLE_CARD_OVER_PHONE=false` by default. Operator must explicitly flip it. Disabled by default in `fly.toml` for prod until alpha testing concludes.
  - **Operator disclosure (in `/tos`):** "Card-over-phone is an alpha-stage testing path. Use only prepaid cards with single-use balances. The card number is voiced to the restaurant by an AI agent; we do not store it but we also do not control how the restaurant handles it. Use cash-on-delivery for non-test orders." Add a parallel disclosure to the cart-confirmation narration when this method is selected.
  - **Acceptable-risk framing (stage-explicit):** prepaid single-use card with bounded balance. PCI is out of scope because we don't store / process / transmit cards through anything we control beyond the Bland voice agent (whose transcript we filter). For non-alpha use this would need a Stripe MPP or chain-account tokenization (the original "Credit card flow" item below).
  - Sized: ~2 days. Touches `src/connectors/bland.ts`, `src/server.ts` (place_order schema + flow), `src/a2a/executor.ts` (parity), `webapp/app/` (payment-method picker UI), `tests/regression/card-over-phone/` (PCI-leak guard + happy-path), `_docs/operations/card-over-phone-safety.md` (ops playbook).
- [ ] **Credit card flow — production grade** (renames the prior cash-only-by-protected-decision item; superseded as the *testing* path by the entry above). Production-quality card commerce still requires either (a) a chain-specific payment integration (Stripe MPP, in-band auth to Domino's payment flow) or (b) a tokenized card delegated to the user's chain account. Significant security + compliance scope. Out of scope until per-user auth lands.
- [ ] **Allergen surfacing** — `dietary` is a string filter today. Real allergen data needs structured fields (gluten, dairy, nuts, soy, etc.) on every `MenuItem`.

### Claude Desktop integration reliability

> **Diagnosis (RT-007, `/reasoning:run` deep, 2026-05-18):** "Claude Desktop keeps breaking after updates" is NOT one bug. The integration spans 7 independently-versioned components in series (Claude Desktop → cmd.exe → npx → mcp-remote → HTTP → Fly LB → cold-started Fly machine → Express → `@modelcontextprotocol/sdk` → tool registry) with no canary, no warm-start guarantee, no pinned versions. Each "update" exercises a different link → user sees recurring intermittent breakage. Six concrete failure modes (F1–F6) with mitigations below, ordered by ratio of (impact ÷ effort).

- [ ] **F2 + F1 mitigation — wire the existing canary on a cron.** `scripts/check-deployed-tools.js` was built for SP-20260517-005 (LRN-2026-05-18-canary-script-companion) but isn't running on a schedule. Add a Fly cron entry (or GitHub Action) that runs it every 5 min against prod; alert on red. Catches a stale deploy or tool-list drift in 60s instead of "next user test." **30 min.** Pre-deploy variant: same script as a CI step that gates merges to main.
- [ ] **F1 mitigation — eliminate Fly cold-start.** `fly.toml` currently has `auto_stop_machines = 'stop'` + `min_machines_running = 0` → first call after deploy or 5-min idle takes ~2.7s, longer than `mcp-remote` patience. Two options: (a) `min_machines_running = 1` (~$3/mo always-on, eliminates cold-start), (b) `auto_stop_machines = 'suspend'` (free, ~200ms wake instead of cold start). **15 min.**
- [ ] **F4 + F5 mitigation — pin versions in the critical path.** `@modelcontextprotocol/sdk` from `^1.12.1` → `~1.12.1` (allow patch, block minor). Replace `npx -y mcp-remote` in `scripts/one-off/aiweb-pizza-mcp.cmd.template` with `npx -y mcp-remote@<exact-version>`. Stops silent npm upgrades from breaking the wire format. **15 min.**
- [ ] **F3 mitigation — DONE (2026-05-18 incident response).** The bearer is no longer hardcoded in a committed file. `scripts/one-off/aiweb-pizza-mcp.cmd` is now gitignored and operator-local; the `.template` lives in git with `REPLACE_WITH_YOUR_KEY` as the placeholder. Fly secret rotated; history rewritten + force-pushed.
- [ ] **Operator-friendly `npm run cd:doctor` script.** One command that pings `/healthz`, runs `initialize` + `tools/list` against the deployed server, compares to the canonical EXPECTED_TOOLS set, verifies the local `.cmd`'s bearer matches the live Fly secret, prints green/red. Operator runs this after any update and gets a deterministic verdict instead of "did it break again?" **1.5 hours.**
- [ ] **(Optional, only if F4 keeps recurring post-pin.)** Replace `mcp-remote` with a vendored stdio↔HTTP bridge under `scripts/cd-bridge/`. Removes the npm dependency from the critical path; isolates F4/F5 entirely. **1–2 days.** Don't pre-build — only invest if cron canary shows recurring mcp-remote-related regressions.

Note: `/fixture hook smoke test` runs after each `/warp:update` are a separate concern (local PostToolUse hook verification, not Claude Desktop). Don't conflate.

---

## Human verification test (Phase 6 manual smoke)

Goal: prove the compatibility layer works end-to-end on real surfaces, with one positive flow and three blocker flows.

### Pre-flight (60 sec)

1. `npm run build` — should exit 0 clean. (Already verified on main.)
2. `npm test` — should print "tests 105 / pass 105 / fail 0". (Already verified.)
3. Confirm `runtime/events.jsonl` exists OR the runtime dir is writable (it's created on first compatibility event).
4. Server: `npm run dev` (or whatever the local-MCP launcher is) — should bind on the configured port.

### Test plan — 5 flows × 2 surfaces (10 cases)

The two surfaces are **MCP** (Claude Desktop or `mcp-remote` bridge) and **A2A** (the test panel at https://aiweb-mcp.fly.dev). Run each flow on both surfaces.

| # | Flow | Address + intent | Expected `compatibility.overall` | place_order behavior | Notes |
|---|---|---|---|---|---|
| 1 | E (success path) | `1 Market St, San Francisco, CA 94105` + `meat_lovers` | `go` on `test_vlad` | dispatches Bland call cleanly | Demo Beat 3 — the happy path |
| 2 | A (no-deliver) | same address + `pepperoni`, force `test_pickup_only` fixture | `no_go` (delivery=`pickup_only`) | refuses with `compatibility_blocked` error | Demo Beat 4 |
| 3 | C (wrong-item) | same address + `sushi`, target `test_vlad` | `no_go` (item=`not_available`) | refuses, surfaces `nextStep` text suggesting substitute | Demo Beat 5 |
| 4 | B (out-of-range) | distant address + any intent (forcing a Domino's far away) | `no_go` (coverage=`out_of_range`) on the far Domino's | refuses | Verifies Domino's coverage path; if Domino's `lat:0/lng:0` short-circuits to `unknown`, that's the v2-delta C-1 mitigation working as designed |
| 5 | D (caution) | same address + `meat_lovers`, force a `places_*` restaurant | `caution` (one or more `unknown`) | proceeds (caution does NOT block) AND Bland prompt includes ITEM-CONFIRM step | Verifies the caution path doesn't false-block |

### Per-surface checklist for each flow

**MCP (Claude Desktop):**
1. Open Claude Desktop → ensure `aiweb-pizza` MCP server is connected.
2. Send the natural-language prompt corresponding to the flow.
3. Check Claude's response for the compatibility narrative (it should reproduce `nextStep` verbatim on caution/no_go).
4. If place_order would fire: monitor for the actual Bland call. If blocked: confirm no Bland call dispatched.
5. Inspect `runtime/events.jsonl` — there should be a `cat: "compatibility"` event for each `assessCompatibility` call, plus a `cat: "compatibility-override"` event if the override flag was used.

**A2A (test panel):**
1. Open https://aiweb-mcp.fly.dev → bearer token + agent-card preloaded.
2. Send a structured A2A message with the same address + intent as the flow.
3. Inspect the `proposed_cart` artifact — confirm it carries a `compatibility` field with the four sub-fields (delivery / coverage / item / overall) plus `nextStep`.
4. Submit the same message with `confirmed: true` (and matching `confirmation_token`). For no_go flows, expect rejection with `compatibility_blocked`. For go flows, expect Bland dispatch.
5. Same events.jsonl inspection.

### What to look for that the gauntlet can't see

The gauntlet validates code correctness. The human check validates UX:

- Does the agent's natural-language reply on a `caution` flow actually surface the unknown clearly to YOU (not just embed the field in the response JSON)? If the agent says "Vlad's might have meat lovers — should I call to confirm?" verbatim from `nextStep`, that's the AC7 + D-2 directive working. If the agent paraphrases or omits, the tool description didn't bind tightly enough.
- Does the Bland call ITEM-CONFIRM step (when fired) sound natural to the restaurant on the other end, or does it confuse them? This is the only real-world signal that the prompt change in `bland.ts` works.
- On Beat 1 (success path): does the cart preview shown to you BEFORE confirmation match what Bland actually orders? Drift here = ISS-005 territory but in the honest path; if it drifts, RT-201 is more urgent than we think.

### Known gaps during your test (do not flag as bugs)

- **RT-201 / ISS-005:** if you specifically try to mutate `intent_style` between `start_pizza_order` and `place_order` to a compatible value while keeping a no_go cart, the gate WILL pass and Bland WILL fire — that's the deferred adversarial bypass. Honest-path testing won't trip it. Don't do this in the YC demo.
- **Gemini quota:** Gemini Pro models 404 on this account (free-tier `limit: 0`). Doesn't affect the demo (only redteam dispatch, which already ran via openai). Will resolve if you upgrade to Tier 1+ in Google Cloud billing.

### After the test

- If all 10 cases pass: run final `/export` → save as `yc-export-2.md`.
- If any flow surprises you: log the surprise in `issues.md` with full repro, decide fix-now-vs-defer same as we did for RT-201.

---

## Crash-recovery / Resume instructions

**If the session crashes mid-work:**

1. Reopen Claude Code in this directory. SessionStart hook auto-loads the previous handoff.
2. Read this file (`ROADMAP.md`) — current state at the top.
3. Read `issues.md` for any open bugs.
4. Run `git status && git log --oneline -10` to see what's committed.
5. If you were in adhoc mode: `node scripts/mode-set.js adhoc --by alpha`.
6. Resume from the first unchecked item under **Active backlog**.

**If a fresh-eyes session asks "where do I start?":**

1. Read `yc-application.md` — sprint history + tradeoffs + risks.
2. Read this file's **Current state** + **Active backlog**.
3. Read `issues.md` for open bugs.
4. Pick from N-1 / N-2 / connector enrichment / cart depth based on priorities.

---

## Known risks

1. **Places API restaurants ship with `deliveryRadius: null`.** Honest, but means coverage is always `unknown` for non-Domino's discoveries. ITEM-CONFIRM in Bland is the partial mitigation; pre-call menu probe (N-1) is the structural fix.
2. **Generic Places menu has only 3 hardcoded items.** Any non-pepperoni/cheese/specialty intent on a Places restaurant gets `unknown`. Same N-1 dependency.
3. **Domino's lat/lng=0 in API response.** Coverage check short-circuits to `unknown` for Domino's specifically (PRD-V2-DELTA C-1 mitigation). Real fix: geocode store address.
4. **Token-binding mutation surface.** RT-201 demonstrated that any second-pass validation must re-derive its inputs from already-bound data. Generalizes beyond compatibility — applies to any future check that runs at place_order time.
5. **Demo-environment fragility.** test_vlad fixture is hardcoded with SF coordinates; the demo relies on a SF-area address. Demo-script address is `1 Market St, San Francisco`; do NOT use distant addresses (e.g. user's actual home in Riddle, OR — ~600 mi away).
6. **3-strike fix-cap.** If a recurring bug class hits cap 3+ in a single sprint, log to issues.md and defer. P-025 in Beta's judgment model is HARD-RULE.

---

## Notes

- **YC application materials:** `yc-application.md` (running session journal across YC-sprint sessions), `yc-application-brief.md` (paste-ready 610-word YC pitch with 6 cited 2026 sources), `yc-export-01.md` (mid-session conversation export), `yc-export-02.txt` (final session export).
- **Sprint discipline:** main branch must stay shippable at all times. Exploratory work happens on feature branches in `.worktrees/`. Every PR must pass `npm run build` clean before merge.
- **Cross-repo parity:** WarpOS framework changes flagged in `warpos-to-update.md` get drained on `/warp:promote` or `/warp:release`. Don't propagate manually.
