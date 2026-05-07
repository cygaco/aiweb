# YC Export — Menu + Delivery Discovery Sprint

## AIWeb Wave 00 — 2026-05-07

---

## What We Built

A pizza ordering AI that calls restaurants by phone. Not a wrapper around a delivery app — an actual agent that phones a pizza place, confirms availability, and places the order verbally via Bland.ai.

The session goal: stop the agent from committing to a phone call when it doesn't know whether the restaurant can fulfill the order. **Real-world compatibility failures, resolved before action.**

---

## The Three Real Demo Failures That Drove This Sprint

These were observed in live testing before the sprint. Three failures, one structural cause.

**1. "Does this place even have pepperoni?"** Google Places returns a hardcoded 3-item generic menu (Pepperoni / Cheese / Specialty) for every non-chain restaurant — not real menu data. The agent treated a template match as evidence and returned `likely_available`. False confidence sent the bot into a call with a restaurant that might not carry the item.

**2. "Does this place deliver?"** Places API doesn't expose delivery capability. `serviceType` was `unknown` for every Places restaurant. The agent had no way to know before calling whether the restaurant delivered at all.

**3. "Does this place deliver to where I am?"** Places doesn't expose a delivery radius. `deliveryRadius` was `null` for every Places restaurant. The agent couldn't determine coverage without calling first and asking.

All three had the same root cause: **the agent committed to an external action (a phone call) without checking compatibility first.** Every wasted call gave a user a bad experience and burned a real restaurant's attention.

---

## What the Compatibility Gate Already Did (Pre-Sprint)

`src/lib/compatibility.ts` — three checks, one combiner. Shipped in the previous sprint.

- **Check 1 — Delivery Availability** — does this restaurant deliver at all? `serviceType` field (delivery / pickup_only / third_party_only / unknown). Domino's API → `delivery`. Places API → `unknown`.
- **Check 2 — Delivery Coverage** — does this restaurant deliver to my address? Haversine distance against `deliveryRadius`. Null radius → `unknown`. Domino's API also returns lat/lng=0 (a known limitation), so coverage is `unknown` for Domino's too.
- **Check 3 — Item Availability** — does this restaurant carry what I want? Menu fuzzy-match against `intent_style`.
- **Combiner** — `go | caution | no_go`. `start_pizza_order` sorts candidates by verdict; `place_order` blocks on `no_go`.

**Design principle:** fail-open on unknown. `caution` proceeds with a Bland-prompt ITEM-CONFIRM step at call time. `no_go` refuses the call.

The gate worked. The gate's *inputs* were garbage.

---

## What This Sprint Built — The Evidence Enrichment Layer

The gate had a structural problem: for non-chain Places restaurants, all three checks returned `unknown`. Every Places restaurant landed in `caution` perpetually. The user's complaint in their Claude Desktop session boiled down to "I don't know what they have, so I'll call them and ask mid-order" — which is technically correct fail-open behavior, but operationally awful.

The fix is **upstream of the gate**: enrich the evidence before the gate fires.

**`src/lib/menu-discovery.ts`** (new module): given a restaurant, fetch its website, extract real menu items + delivery cues via Claude Haiku, cache the result, return an enriched restaurant.

**Flow:**
1. After initial sort by gate verdict, identify the top-1 caution candidate where `item.state === "unknown"` OR `coverage.state === "unknown"`
2. `enrichEvidence(restaurant, intent_style)` — cache check (24h TTL) → website fetch (3s timeout, abort-signal-enforced) → Claude Haiku extraction (4s total time budget) → cache write
3. Re-run `assessCompatibility` on the enriched restaurant
4. Re-sort the candidate list — a flipped verdict (`caution → go`) bubbles to the top
5. Fail-open at every error path: network error, timeout, parse failure, body-too-large (>500KB), missing API key, no website, malformed cache, malformed extraction → original `caution` state stands; the bot falls back to Bland's existing ITEM-CONFIRM step

**Cache:** `runtime/menu-cache/<restaurant-id>.json`. Schema-validated on read. Stale cache (>24h) treated as miss. Cache write is best-effort — fs error logged, never thrown.

**Symmetric wiring:** the same enrichment runs in `start_pizza_order` (MCP server) and in the A2A `proposed_cart` artifact. Both surfaces respect `ENRICH_COUNT=0` (kill switch). Both emit `EVT-enrichment` events to `runtime/events.jsonl` for trace. Both attach an `enrichment: { ran, source, durationMs }` block so consumers can see what happened.

**Domino's adapter unchanged.** An explicit `dominos_*` id-prefix skip at the top of `enrichEvidence` ensures the provider adapter's truthful API data is never overwritten by a generic dominos.com marketing page.

---

## Two User-Flagged Correctness Issues, Caught Before YC

**1. "Domino's HAS a website."**

The user pointed out, partway through the build, that the implicit "skip enrichment if `restaurant.website` is missing" wasn't enough — Domino's restaurants have a real website (dominos.com), and a future commit populating that field on the connector would silently let enrichment run on a Domino's listing, potentially overwriting the truthful API data with a marketing page.

The fix: `dominos_*` id-prefix early-return at the top of `enrichEvidence`. Test #9 verifies that a Domino's restaurant with `website: "https://www.dominos.com/"` returns `source: 'unchanged'` with no fetch attempted.

**2. The `menuSource` ambiguity bug.**

`checkItemAvailability` detected generic-template Places restaurants by checking `restaurant.id.startsWith("places_")`. The enrichment loop enriches the restaurant and calls `assessCompatibility` on the enriched object — but the enriched restaurant retains its `places_` id. So re-running compatibility on an enriched restaurant would still hit the generic-template branch and return `unknown` regardless of what the real menu contained. Enrichment would run, cache would be written, the bot would still say "I don't know."

The fix:
- Added `menuSource?: "restaurant_website"` field to the `Restaurant` interface
- `applyEnrichment` sets `menuSource: "restaurant_website"` on the enriched object
- `checkItemAvailability` updated: `isPlaces = id.startsWith("places_") && menuSource !== "restaurant_website"`

Without this, the entire enrichment layer would have shipped looking like it worked but doing nothing user-visible. Tests 21+22 in `tests/compatibility.test.ts` cover both branches (enriched + on-menu = available; enriched + not-on-menu = not_available).

---

## The Gauntlet Pass — Real Findings, Real Fixes

After the foundation work landed, we ran a 3-gate cross-provider gauntlet (reviewer + compliance + qa via OpenAI codex/gpt-5.5 at xhigh effort). The gauntlet flagged **4 HIGH issues** — none of which the test suite would have caught:

1. **Enrichment metadata not surfaced.** Server response and A2A artifact reassessed compatibility against the enriched restaurant, but didn't tell the consumer that enrichment had run, what its source was, or how long it took. AC12 unsatisfied.
2. **No `EVT-enrichment` event writer.** `runtime/events.jsonl` had no trace of enrichment activity — only compatibility events. The demo's "fetch → parse → confirm" beat would have no observable trail. Bonus: the event-id prefix was hardcoded `EVT-compat-` regardless of category.
3. **`applyEnrichment` could throw on malformed cache or partial extraction.** A cache file with missing `deliveryCues` (older schema, partial write) would dereference `data.deliveryCues.offersDelivery` and crash the order flow. Fail-open contract broken.
4. **A2A cart staleness.** Cart items were built from the pre-enrichment restaurant; compatibility was attached to the post-enrichment artifact. So the artifact could honestly say "real menu confirms" while showing cart items from the generic template.

All four addressed in commit `5d88b6c`. Tests still 119/119; build clean.

The reviewer's pass-2 surfaced 4 mediums (test coverage gaps, third-party-only schema gap, source-enum granularity, delivery cues discarded when pizzas=[]). All deferred to ISS-007 with a starting reference: branch `feat/menu-discovery-fix-1` has DI scaffolding + 6 mock-based tests ready to pick up.

---

## A Side Story — Why Cross-Provider Review Almost Didn't Happen

The gauntlet went through three failures before it ran. Worth a brief note because it speaks to the framework story behind the product.

**Symptom:** Gamma (the orchestrator agent) dispatched 7 codex CLI processes against the feature branch. All 7 silently died — 0 bytes stdout, 0 bytes stderr, no errors logged. Lock files held by dead PIDs lingered past their 20-min TTL because the auto-prune was lazy. Codex worked at the command line. Claude worked. Auth was fine. The dispatches just... vanished.

**Root cause** (diagnosed via `/fix:deep` RT-004): Gamma's invocation route bypassed `runProvider`, our Windows-stdin-safe wrapper. The original Windows-stdin bug (LRN-2026-04-17-n, ~13 days prior) was patched only inside `runProvider` — direct invocations like `cat prompt.txt | codex exec ...` from raw bash on Windows recur the bug class. The framework had a known fix that lived in one place and a calling convention that wasn't enforced.

**Recovery:** `scripts/one-off/run-gauntlet-alpha.js` calls `runProvider` directly per role from Alpha's context, sequentially. All 3 gates ran cleanly: reviewer 197s, compliance 175s, qa 44s. Real findings followed.

**Permanent fix path** (logged upstream in `warpos-to-update.md`): write-time guard hook for raw `codex exec` / `claude -p` / `gemini` patterns; orchestrator-side telemetry to make silent deaths visible; active prune in concurrency-lock; smoke probe in `/oneshot:preflight` and `/mode:adhoc`.

This is the kind of debugging an investor probably won't see in a demo — but it's exactly the kind of operational rigor that determines whether an agentic product ships reliably or accumulates silent failure modes that erode trust.

---

## Test Coverage

**`tests/compatibility.test.ts`** — 22 tests
- Tests 1–8: original coverage (Domino's real menu, unknown `serviceType`, null radius, lat=0/lng=0 edge case, etc.)
- Tests 9 + 14 + 18–20: generic-template behaviors (template → `unknown`, real menu unaffected, edge cases)
- Tests 21–22: enriched Places (`menuSource = "restaurant_website"`) → `available` when item present; → `not_available` when item missing

**`tests/menu-discovery.test.ts`** — 9 tests
- No-website / no-API-key fail-open paths
- Cache hit + TTL semantics
- `offersDelivery` cue mapping (true → delivery; false → pickup_only; null → unchanged)
- Stale-cache miss
- Immutability of input restaurant on cache hit
- `menuSource = "restaurant_website"` propagation
- Domino's id-skip with website set

**Total:** 119/119 passing. Build clean (`tsc`).

**Known gap (ISS-007):** the discovery-success and discovery-failure paths are exercised manually but not yet via test mocks (no `fetch` or Anthropic SDK mocking). Branch `feat/menu-discovery-fix-1` has 6 mock-based tests ready to pick up next iteration.

---

## What the Agent Gets Right That Delivery Apps Get Wrong

Delivery apps (DoorDash, UberEats) only work with restaurants that have signed up. This agent works with any restaurant that has a phone number — the long tail of local pizzerias that aren't on any platform.

The compatibility layer is how the agent handles the uncertainty of that long tail:
- **Known chain (Domino's):** high-confidence provider-adapter data, no enrichment needed
- **Unknown local restaurant (Places + website):** real-evidence enrichment via website fetch + LLM extraction; fail-open to existing call-time ITEM-CONFIRM if discovery fails
- **Complete unknown (no website, no API):** `caution` with a specific `nextStep` baked into the Bland prompt — confirm at call time

**The YC wedge:** pizza ordering for restaurants without a delivery-app presence.
**The actual product:** a compatibility + evidence layer for any phone-based agentic transaction, where the long tail of small operators has no API, no integration, and no platform presence.

---

## Deferred Items (Explicit Non-Goals This Sprint)

- **ISS-005 / RT-201** — Adversarial prompt-injection of `intent_style` into the Bland call prompt. HIGH adversarial; deferred per Beta DECIDE confidence 0.88. Honest-path demo doesn't trip it. Mitigation path documented (option b: derive compatibility from cart contents instead of `intent_style`, ~30 LOC).
- **ISS-006** — Gamma's gauntlet dispatches die silently on Windows when bypassing `runProvider`. Workaround in place via Alpha-driven gauntlet; permanent fix tracked in `warpos-to-update.md`.
- **ISS-007** — Test coverage gaps + third_party_only schema + source-enum failure-mode granularity + delivery cues discarded with empty pizzas. Branch `feat/menu-discovery-fix-1` has scaffolding for #1 + #3.
- **N-1** (in `ROADMAP.md`) — Pre-call menu confirmation: show the user the enriched menu before dialing so they confirm the restaurant carries their item. Pairs with ISS-005 — same area of code, doing both at once is efficient.
- **Provider adapter pattern formalization** — defer to N+1 per Beta DECIDE 0.86. Premature abstraction before there are two concrete adapters in production.

---

## Files Changed This Sprint

| File | Change |
|---|---|
| `src/lib/menu-discovery.ts` | New — website fetch + Claude Haiku extraction + 24h cache + AbortController-enforced timeouts + shape-validation guards (`isValidDeliveryCues` + `isValidCachedMenuResult`) + body-too-large fail-open + explicit `dominos_*` id-skip |
| `src/lib/compatibility.ts` | Generic-template branch: `likely_available` → `unknown` (template is not evidence). `isPlaces` check now bypasses generic when `menuSource === 'restaurant_website'`. nextStep wording suggests "run discovery, or confirm on call." |
| `src/lib/event-log.ts` | Added `logEnrichmentEvent`. Fixed event-id prefix bug — was hardcoded `EVT-compat-` regardless of category; now derived from `cat` (`EVT-compat-` for compatibility, `EVT-enrichment-` for enrichment). |
| `src/data/restaurants.ts` | Added `website?: string` and `menuSource?: "restaurant_website"` to `Restaurant` interface |
| `src/connectors/places.ts` | Added `places.websiteUri` to FIELD_MASK; wired to `restaurant.website` |
| `src/server.ts` | Enrichment loop in `start_pizza_order` — top-1 caution gate, re-sort after enrichment, enrichment block in response, `EVT-enrichment` events emitted, respects `ENRICH_COUNT=0` |
| `src/a2a/executor.ts` | Symmetric enrichment wiring in `proposed_cart` path — same gate, cart construction moved AFTER enrichment so cart items reflect the enriched menu |
| `package.json` | Added `@anthropic-ai/sdk: ^0.90.0` |
| `tests/compatibility.test.ts` | Extended — generic-template-rejected + enriched-real-menu-respected branches |
| `tests/menu-discovery.test.ts` | New — 9 tests for cache + fail-open + Domino's-skip semantics |
| `_requirements/04-features/menu-delivery-discovery/PRD.md` + `STORIES.md` | New feature spec — 12 ACs (REQ-mendel-*) + 14 granular stories (### GS-MENU-DEL-NN) |
| `issues.md` | ISS-006 (dispatch infra workaround) + ISS-007 (deferred review findings) |
| `warpos-to-update.md` | Two new flags — write-time guard hook for raw CLI invocations + orchestrator dispatch telemetry |
| `yc-menu-delivery-compatibility.md` | Sprint live state + crash-recovery doc |

---

## Current Status

**Branch:** `feat/menu-discovery` @ `5d88b6c` — 3 commits ahead of `main`
**Build:** TypeScript compilation clean (`npm run build`)
**Tests:** 119/119 passing (`npm test`)
**Gauntlet:** 4 originally-flagged HIGH findings closed; 4 mediums deferred to ISS-007
**Gauntlet method:** Alpha-driven via `runProvider` (codex 0.128 + gpt-5.5 xhigh) — Gamma's normal dispatch path was infra-blocked by the silent-stdin issue

**Pending decision (user):** merge `feat/menu-discovery` → `main` (squash / no-ff / rebase) + push to remote.

**Manual smoke test recommended before merge:**
- Set `ANTHROPIC_API_KEY` + `GOOGLE_PLACES_API_KEY`
- `npm run dev`
- Invoke `start_pizza_order` with `address: "1 Market St, San Francisco, CA 94105"` + `intent_style: "pepperoni"`
- Verify: a `places_*` candidate appears in the response with an `enrichment: { ran, source, durationMs }` block; `runtime/menu-cache/places_<id>.json` exists; `runtime/events.jsonl` has new `EVT-enrichment-*` lines

---

## What's Next

After merge:
1. **N-1 + ISS-005 paired sprint** — add pre-call menu confirmation UX + fix the RT-201 wrong-item bypass at the same time. Same area of code, single PR.
2. **ISS-007 cleanup** — pick up `feat/menu-discovery-fix-1` branch as a starting point. Adds DI scaffolding, mock-based test coverage, source-enum granularity, third_party_only schema.
3. **Real Domino's API menu adapter** — current adapter emits a hardcoded subset; real API exposes modifiers, drinks, deals.
4. **Multi-chain connectors** — Pizza Hut, Papa John's, Little Caesars. Each is its own provider adapter with auth + rate-limit story.
