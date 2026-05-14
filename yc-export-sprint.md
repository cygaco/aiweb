# YC Export — Pizza Concierge Sprint
## AIWeb Wave 00 — 2026-05-07

---

## What We Built

A pizza ordering AI that calls restaurants by phone. Not a wrapper around a delivery app — an actual agent that phones a pizza place, confirms availability, and places the order verbally via Bland.ai.

The session goal: demonstrate that an AI agent can handle **real-world compatibility failures** before committing an external action (a phone call).

---

## The Three Real Demo Failures That Drove This Sprint

These were not hypothetical. These were actual breakdowns observed in live testing before this sprint:

**1. "Does this place even have pepperoni?"**
The agent was suggesting restaurants from the Google Places API. Places returns a generic hardcoded 3-item menu (Pepperoni, Cheese, Veggie) for every non-chain restaurant — not real menu data. The system was treating a template match as a real signal and returning `likely_available`. That's a false positive that sends the agent into a call with a restaurant that might not carry the item.

**2. "Does this place deliver?"**
Places API doesn't expose delivery capability. `serviceType` was `unknown` for every Places restaurant. The agent had no way to know before calling whether the restaurant even delivered.

**3. "Does this place deliver to where I am?"**
Places doesn't expose a delivery radius. `deliveryRadius` was `null` for every Places restaurant. The agent couldn't determine coverage.

All three failures had the same root cause: **the agent was committing to an external action (a phone call) without checking compatibility first.** Every failure wasted a real phone call and gave the user a bad experience.

---

## What the Compatibility Gate Does

`src/lib/compatibility.ts` — three checks, one combiner.

**Check 1 — Delivery Availability**
Does this restaurant deliver at all? Sources: `serviceType` field (delivery / pickup_only / third_party_only / unknown). Domino's chain stores have known `delivery`. Places restaurants default to `unknown` until enriched.

**Check 2 — Delivery Coverage**
Does this restaurant deliver to where the user is? Haversine distance check against `deliveryRadius`. Falls to `unknown` when radius is null (Places). Falls to `unknown` when Domino's API doesn't return coordinates.

**Check 3 — Item Availability**
Does this restaurant carry what the user wants? Menu fuzzy-match against `intent_style`. Places restaurants have a 3-item generic template — after this sprint, that produces `unknown` (not `likely_available`), because a template match is not real evidence.

**Combined verdict:** `go` | `caution` | `no_go`. Used by `start_pizza_order` to sort candidates and by `place_order` to block.

**Key design principle:** fail-open on unknown, not fail-closed. `caution` means "proceed with Bland's built-in ITEM-CONFIRM step." `no_go` means don't call.

---

## The Menu Enrichment Layer (This Sprint)

The compatibility gate had a fundamental problem: for non-chain restaurants discovered via Places, all three checks returned `unknown`. Every Places restaurant was perpetually `caution`. The enrichment layer fixes this by fetching real evidence.

**Flow:**
1. After initial sort, identify the top `ENRICH_COUNT` (default: 1) `caution` restaurants where item or coverage is `unknown`
2. `enrichEvidence(restaurant, intent_style)` fetches restaurant website (3s timeout), extracts menu + delivery cues via Claude Haiku (4s total cap), caches result for 24h
3. Re-run `assessCompatibility` on the enriched restaurant
4. If enrichment reveals the restaurant carries the item and delivers: `go` instead of `caution`
5. Fail-open: any error/timeout returns the original restaurant unchanged; caution state stands

**Cache design:** `runtime/menu-cache/<restaurant-id>.json`, 24h TTL. Cache hit skips all network calls — the second request for the same restaurant is free.

**Delivery cues:** same fetch, same extraction prompt, zero extra cost. `offersDelivery: true/false/null` and `deliveryRadiusMiles` extracted alongside the menu. Applied to `serviceType` and `deliveryRadius` before re-running compatibility.

---

## The `menuSource` Bug Found During Reviewer Pass

A non-obvious correctness issue that would have silently broken enrichment in production.

**The bug:** `checkItemAvailability` detected generic-template restaurants by checking `restaurant.id.startsWith("places_")`. The enrichment loop enriches a restaurant and calls `assessCompatibility` on the enriched object. But enriched restaurants retain their `places_` ID — so re-running `assessCompatibility` on an enriched restaurant would still hit the generic-template branch and return `unknown` for item availability, defeating the entire enrichment.

**The fix:**
- Added `menuSource?: "restaurant_website"` to the `Restaurant` interface (`src/data/restaurants.ts`)
- `applyEnrichment()` sets `menuSource: "restaurant_website"` on the enriched object (`src/lib/menu-discovery.ts`)
- `isPlaces` check updated: `restaurant.id.startsWith("places_") && restaurant.menuSource !== "restaurant_website"` (`src/lib/compatibility.ts:269`)
- Enriched restaurants with real menus now get real compatibility scoring

**Without this fix:** enrichment would run, cache would be written, but the item check would always return `unknown` for Places restaurants regardless of what the menu contained.

---

## Test Coverage

**`tests/compatibility.test.ts`** — 22 tests
- Tests 1–8: original coverage (Domino's real menu, unknown serviceType, null radius, etc.)
- Test 9: generic template → `unknown` (not `likely_available`) — the core tightening
- Tests 14, 18–20: generic template rejected, Domino's unaffected, places+sushi→unknown
- Tests 21–22: enriched Places (`menuSource=restaurant_website`) → `available`; item missing → `not_available`

**`tests/menu-discovery.test.ts`** — 8 tests
- No-website → unchanged (fail-open)
- No ANTHROPIC_API_KEY → unchanged (fail-open)
- Cache hit within TTL → returns cache, delivery cues applied
- `offersDelivery=false` → `serviceType` becomes `pickup_only`
- `offersDelivery=null` → `serviceType` unchanged
- Stale cache (>24h) → cache miss, falls through to unchanged
- Immutability: original restaurant object not mutated on cache hit
- `menuSource=restaurant_website` set on cache hit

---

## What the Agent Gets Right That Delivery Apps Get Wrong

Delivery apps (DoorDash, UberEats) only work with restaurants that have signed up. This agent works with any restaurant that has a phone number — the long tail of local pizzerias that aren't on any platform.

The compatibility layer is how the agent handles the uncertainty of that long tail:
- Known chain (Domino's): high-confidence checks, direct API data
- Unknown local restaurant (Places): enrichment attempt, graceful fallback to Bland's call-time confirmation
- Complete unknown: `caution` with specific `nextStep` baked into the Bland script

The YC wedge: pizza ordering. The actual product: a compatibility-aware agent layer that can be applied to any phone-based ordering domain where the long tail of small operators has no API, no integration, and no platform presence.

---

## Deferred Items

**ISS-005 / RT-201** — Adversarial prompt injection via `intent_style` into the Bland prompt. MEDIUM risk; deferred per Beta DECIDE (confidence 0.88). Not YC-demo-blocking given controlled demo environment. Logged in `issues.md`.

**N-1 pre-call menu confirmation** — Show the user the enriched menu before placing the call, so they can confirm the restaurant carries their item before the agent dials. Deferred to next iteration. Logged in `ROADMAP.md`.

---

## Files Changed This Sprint

| File | Change |
|---|---|
| `src/lib/menu-discovery.ts` | New — website fetch + LLM extraction + 24h cache |
| `src/lib/compatibility.ts` | `isPlaces` guard updated; generic template → `unknown` |
| `src/data/restaurants.ts` | Added `website?`, `menuSource?` to `Restaurant` |
| `src/connectors/places.ts` | Added `websiteUri` to field mask; wired to `website` |
| `src/server.ts` | Enrichment loop in `start_pizza_order` |
| `src/a2a/executor.ts` | Enrichment loop in `proposed_cart` path |
| `package.json` | Added `@anthropic-ai/sdk` |
| `tests/compatibility.test.ts` | Extended: tests 9, 18–22 added |
| `tests/menu-discovery.test.ts` | New — 8 tests |

---

## Current Status

Build: TypeScript compilation passing.
Tests: written and logically correct; run `! npm test` to verify before committing.
Commit: sprint work uncommitted pending test verification.
