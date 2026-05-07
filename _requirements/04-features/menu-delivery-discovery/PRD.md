# PRD: Menu + Delivery Discovery (evidence enrichment)

## 1. Title + Classification

**Menu + Delivery Discovery** — small feature / one new module + four touch points (compatibility.ts label tightening, server.ts wire-in, executor.ts wire-in, tests).

YC-application sprint follow-up. Wedge: the previous sprint shipped the compatibility *gate*; this sprint feeds it real evidence so the gate isn't just labeling generic templates as "likely available." Maps to the larger agentic-economy compatibility-and-trust layer.

## 2. Surface

- `src/lib/menu-discovery.ts` — **new**. One module, two purposes: extract real per-restaurant menu + delivery cues from a single website fetch. Exports `enrichRestaurant(restaurant, intent, opts?)` returning an `EnrichedRestaurant` (original `Restaurant` shape + populated `menu` + populated `serviceType` + populated `deliveryRadius` + `evidence` metadata).
- `runtime/menu-cache/<restaurantId>.json` — **new** (created on first cache write). File-per-restaurant, keyed by `restaurant.id`. Stores `EnrichedRestaurant` payload + `discoveredAt` ISO timestamp + `source: 'restaurant_website' | 'cache_hit'`.
- `src/lib/compatibility.ts` — modify `checkItemAvailability` so generic-template matches return state `unknown` (currently returns `likely_available` with confidence 0.6). Source tag stays `places_generic_menu`. The `nextStep` becomes `"Menu unknown — call to confirm or run discovery."`. No other change to compatibility.ts. The output type contract is unchanged.
- `src/server.ts` — `start_pizza_order` handler: after initial `assessCompatibility(...)` per restaurant, if the top-1 candidate's `overall === 'caution'` due to item-unknown OR coverage-unknown, run `enrichRestaurant(top, intent_style)`, then re-run `assessCompatibility` against the enriched restaurant. Use the enriched verdict in the response. Hard time cap from `ENRICH_TIMEOUT_MS` env (default 4000). Fail-open: if enrichment errors/times out, original assessment stands. Add `enrichment` block to the response describing what happened (`{ ran: bool, source: 'restaurant_website'|'cache_hit'|'skipped'|'failed', durationMs: number, reason: string }`).
- `src/a2a/executor.ts` — symmetric: same enrichment hook in the path that emits `proposed_cart`, before assessing compatibility for the artifact.
- `tests/menu-discovery.test.ts` — **new**. Mocks `fetch` + Anthropic SDK. Tests: cache hit, cache miss → fetch → parse, fetch timeout → fail-open, parse failure → fail-open, generic-template detection, real-menu extraction normalizes to `Restaurant['menu']`.
- `tests/compatibility.test.ts` — extend with one new test: generic-template now returns `unknown` (not `likely_available`).

**Files unchanged:** `src/connectors/places.ts`, `src/connectors/dominos.ts`, `src/data/restaurants.ts`, `src/lib/event-log.ts`. Domino's adapter path is preserved end-to-end.

## 3. Context

The compatibility gate (`src/lib/compatibility.ts`) shipped last sprint and works (105/105 tests green). It correctly labels evidence quality:
- Domino's: real `serviceType: 'delivery'` + real `deliveryRadius` (sometimes; `MaxDistance ?? 5`) → `available` with confidence 0.95
- Places: hardcoded `serviceType: 'unknown'` + `deliveryRadius: null` + 3-item generic menu → states degrade to `unknown` / `likely_available`

The honest labeling is correct, but the user-facing failure mode is that **caution doesn't block**. The bot proceeds to call, the Bland prompt's ITEM-CONFIRM step asks the restaurant mid-call, and a "no, we don't carry that" answer means the bot has to recover after the user has already committed and the restaurant has answered the phone. This is the exact failure surfaced in the user's Claude Desktop transcript ("Did we check if they have the item? — Honest answer: no, not directly.").

**Three real evidence sources we are NOT using:**
1. The restaurant website URL — Places API already returns `places.websiteUri` (we don't currently request that field, but Places exposes it). For a restaurant we can fetch in <3s, Claude can extract menu items from HTML in <2s.
2. The same fetch — pages typically declare delivery info inline ("we deliver within 5 miles", "pickup only", ZIP lists, "online ordering").
3. Cached prior fetches — we already emit `runtime/events.jsonl` with `cat: 'compatibility'` events; we can write a thin per-restaurant cache file for menu evidence with freshness metadata.

**Out-of-scope evidence sources (per Beta DECIDE 2026-05-07):**
- Pre-call voice probe (option 3 from N-1 backlog) — too expensive for sprint
- Per-chain ordering-flow scraping (Pizza Hut, Papa John's online ordering address validation) — N+ scope
- Generic semantic match against rich item taxonomies — overbuilds matcher

## 4. Goal

When the compatibility gate says "I don't know if this restaurant has X or delivers here," the bot tries to find out before placing the call — by fetching the restaurant's own website and reading what they say. If the bot still doesn't know after that, it proceeds to a focused confirmation call (existing behavior). It never fabricates confidence from a generic template.

## 5. Acceptance Criteria

> **Requirements registry IDs** (for graph indexing — match `### GS-MENU-DEL-NN` heading format in STORIES.md):
> - REQ-mendel-types-001 → §6.1 module exports + types (AC1)
> - REQ-mendel-fetch-001 → website fetch + timeout (AC2)
> - REQ-mendel-extract-001 → Claude HTML→menu extraction (AC3)
> - REQ-mendel-delivery-cues-001 → delivery cues from same fetch (AC4)
> - REQ-mendel-cache-001 → file cache with freshness metadata (AC5)
> - REQ-mendel-failopen-001 → fail-open on every error path (AC6)
> - REQ-mendel-server-001 → server.ts wire-in for start_pizza_order (AC7)
> - REQ-mendel-a2a-001 → A2A executor wire-in for proposed_cart (AC8)
> - REQ-mendel-compat-001 → compatibility.ts generic-template label flip (AC9)
> - REQ-mendel-tests-001 → menu-discovery.test.ts coverage (AC10)
> - REQ-mendel-tests-002 → compat regression tests stay green (AC11)
> - REQ-mendel-evidence-001 → enrichment metadata appears in response + events log (AC12)

1. **AC1 — `menu-discovery.ts` exports a single function.** Signature:
   ```ts
   export interface EnrichmentResult {
     restaurant: Restaurant;
     ran: boolean;
     source: 'restaurant_website' | 'cache_hit' | 'skipped' | 'failed';
     reason: string;
     durationMs: number;
     discoveredAt: string | null;
   }
   export async function enrichRestaurant(
     restaurant: Restaurant,
     intent: string | undefined,
     opts?: { timeoutMs?: number; cacheDir?: string; bypassCache?: boolean }
   ): Promise<EnrichmentResult>;
   ```
   The returned `restaurant` is a shallow-cloned `Restaurant` with `menu`, `serviceType`, and `deliveryRadius` potentially overwritten with discovered values. Original input is never mutated.

2. **AC2 — Website fetch uses `restaurant.website` (string field) with a hard timeout.** Read timeout from `opts.timeoutMs ?? process.env.ENRICH_TIMEOUT_MS ?? 4000`. Use `AbortController` for cancel. If `restaurant.website` is missing/empty/non-http, return `{ ran: false, source: 'skipped', reason: 'no website url' }` immediately. (NOTE: extending `Restaurant` to include optional `website?: string` field is part of this AC — if not already present.)

3. **AC3 — Claude extracts menu from HTML via the existing Anthropic SDK.** Use the same SDK module the project already imports (find via grep). Model: `claude-haiku-4-5-20251001` (fast, cheap, good enough for HTML extraction; matches the prompt-pipeline pattern in `scripts/hooks/smart-context.js`). Prompt instructs: extract pizza items into `{ name, description?, sizes?: [{name, price}] }[]`, return strict JSON, no narrative. If extraction returns 0 pizzas OR fails to parse JSON, treat as `{ ran: true, source: 'failed', reason: 'no menu extracted' }` — fail-open path (AC6).

4. **AC4 — Same Claude call returns delivery cues.** Same prompt asks for `{ deliveryAvailability: 'delivers'|'pickup_only'|'third_party_only'|'unknown', deliveryRadiusMiles: number|null, deliveryZips: string[]|null, evidence: string }` alongside the menu. The cues map onto `Restaurant.serviceType` and `Restaurant.deliveryRadius`. If cues come back as `unknown` / `null`, leave the original values alone (do not overwrite real Domino's data with discovered nothings).

5. **AC5 — File cache `runtime/menu-cache/<sanitized-id>.json`.** On cache write: include `discoveredAt: <ISO>`, `restaurantId`, `enriched: <Restaurant>`, `evidence: <raw extraction text, ≤2KB truncated>`, `version: 1`. On cache read: parse, check `discoveredAt` is within freshness window (default 7 days, configurable via `MENU_CACHE_TTL_DAYS`). Stale cache treated as miss. Cache hit returns `{ ran: true, source: 'cache_hit', durationMs: <small>, restaurant: <enriched>, discoveredAt }`. `bypassCache: true` opt skips read but still writes on success. Cache writes are best-effort — fs error logged to console, never thrown.

6. **AC6 — Fail-open on every error path.** Network error / timeout / non-200 / HTML too large (>500KB) / Claude API error / JSON parse fail / cache fs error → return `{ ran: true, source: 'failed', reason: <descriptive>, restaurant: <original> }`. Never throw to the caller. Caller sees the original restaurant object back, with metadata explaining what happened.

7. **AC7 — `server.ts:start_pizza_order` calls enrichment for top-1 caution candidate.** After initial `assessCompatibility(...)` per restaurant, sort candidates by verdict (existing logic). If top-1's `overall === 'caution'` AND the failing checks include item-unknown OR coverage-unknown AND `process.env.ENRICH_COUNT !== '0'`, await `enrichRestaurant(top, intent_style)`, then re-run `assessCompatibility(enriched.restaurant, userLat, userLng, intent_style)`. Replace the top-1 entry's `compatibility` block with the new assessment. Add an `enrichment` block to the top-1 entry: `{ ran, source, durationMs, reason }`. Log an `EVT-enrichment` event with the same payload + restaurant_id. Top-2..N candidates not enriched in v1 (config flag `ENRICH_COUNT` lets us raise this if needed).

8. **AC8 — `a2a/executor.ts` symmetric.** Same enrichment hook in the path that builds `proposed_cart`. Re-assesses against enriched restaurant. Adds `enrichment` to the artifact metadata.

9. **AC9 — `compatibility.ts:checkItemAvailability` generic-template branch returns `unknown`.** Current behavior (line 268-285): when `isPlaces && match`, returns state `likely_available` with confidence 0.6 and source `places_generic_menu`. New behavior: `state: 'unknown'`, confidence 0.4, source `places_generic_menu`, reason `"Generic Places menu — not real evidence."`, nextStep `"Menu unknown — run discovery or call to confirm."`. The non-match branch (`!match`) stays as-is. Real menu (test_* and dominos_*) branch unchanged.

10. **AC10 — `tests/menu-discovery.test.ts` covers:**
    - Cache hit returns enriched restaurant without fetch
    - Cache miss → fetch → Claude extract → write cache → return enriched
    - Fetch timeout → `{ source: 'failed', reason: '...timeout' }`, original restaurant returned
    - Claude returns invalid JSON → fail-open, no cache write
    - Restaurant missing website → `{ source: 'skipped' }` immediately
    - Domino's restaurant passed in → `{ source: 'skipped', reason: 'dominos adapter handled' }` (skip enrichment for `dominos_*`; their data is already truthful)
    - Stale cache (>7 days) → miss → fresh fetch
    - Cache directory doesn't exist → creates it, writes succeeds
    - All file/network ops mocked; no real I/O

11. **AC11 — Existing `tests/compatibility.test.ts` stays green; one test updated.** The existing test that asserts Places generic-menu match returns `likely_available` is updated to assert `unknown`. All 18 other tests stay verbatim. After change: `npm test` reports 105/105 + new menu-discovery tests = at least 113/113 (depends on test count, but no regressions).

12. **AC12 — Enrichment metadata appears in responses + events log.** `start_pizza_order` response includes `enrichment` block on the enriched candidate. A2A `proposed_cart` artifact includes `enrichment` in metadata. `runtime/events.jsonl` gains `EVT-enrichment` events with `cat: 'enrichment'`, `restaurant_id`, `source`, `ran`, `durationMs`, `reason`. Existing `EVT-compatibility` events continue to fire (one per `assessCompatibility` call — so caution candidates that get enriched will show TWO compatibility events, before + after, useful for demo trace).

## 6. Demo script (3 beats)

**Beat 1 — Generic-template rejected.**
User: "I want pepperoni pizza delivered to 1 Market St, San Francisco."
Demo bot finds `places_X` pizza restaurant. Initial gate: item state was `likely_available` (old) → after relabel, `unknown` (new). Bot says: *"I found a candidate but I don't have a real menu for them — let me check."*

**Beat 2 — Discovery fills the gap.**
Bot calls `enrichRestaurant(places_X, "pepperoni")`. Module fetches the restaurant's website, Claude extracts: `[{name: "Pepperoni", sizes: [{name: "Large", price: 18.99}]}, ...]`. Module also extracts: `{deliveryAvailability: "delivers", deliveryRadiusMiles: 5}`. Module writes cache. Bot re-assesses: now `item.state === 'available'` (source `restaurant_website`, confidence 0.85) and `delivery.state === 'available'` and `coverage.state === 'in_range'`. Verdict flips from `caution` → `go`. Bot says: *"Confirmed — they have pepperoni pizza, large $18.99. They deliver to your area. Placing the order."*

**Beat 3 — Discovery fails gracefully.**
Same flow with a Places restaurant whose website 404s or returns garbage. Module returns `{source: 'failed', reason: 'fetch timeout 4001ms'}`. Original caution-state assessment stands. Bot falls back to existing ITEM-CONFIRM-on-call behavior. Bot says: *"I couldn't find their menu online. I'll ask them when I call — they may not carry pepperoni."*

These three beats demonstrate the inference→evidence transition end-to-end: Beat 1 rejects fake confidence, Beat 2 discovers real evidence, Beat 3 stays graceful when discovery fails.

## 7. Implementation map

| Phase | Files | Owner |
|---|---|---|
| 1 | `_requirements/04-features/menu-delivery-discovery/PRD.md` (this file), `STORIES.md` | Alpha |
| 2 | `src/lib/menu-discovery.ts` — new module | Builder |
| 3 | `src/data/restaurants.ts` — add `website?: string` | Builder |
| 4 | `src/connectors/places.ts` — populate `website` from `places.websiteUri` (extend FIELD_MASK) | Builder |
| 5 | `src/lib/compatibility.ts` — flip generic-template branch to `unknown` | Builder |
| 6 | `src/server.ts:start_pizza_order` — wire enrichment hook | Builder |
| 7 | `src/a2a/executor.ts:proposed_cart path` — wire enrichment hook | Builder |
| 8 | `tests/menu-discovery.test.ts` — new | Builder |
| 9 | `tests/compatibility.test.ts` — update one assertion | Builder |
| 10 | Reviewer + compliance + QA gauntlet | Gamma |
| 11 | Fix loop | Gamma → Fixer |
| 12 | Merge to `main` | Alpha |

## 8. Test plan

**Unit (in-test):**
- `menu-discovery.test.ts` (10 cases per AC10)
- `compatibility.test.ts` (1 updated assertion per AC11)

**Integration (manual):**
- Run `npm run build` → exit 0
- Run `npm test` → all green, count >= 105 (existing) + ~10 (new)
- `npm run dev` (or local MCP launcher) — invoke `start_pizza_order` with SF address + `pepperoni` intent, verify a Places restaurant gets enrichment block in response, verify cache file appears in `runtime/menu-cache/`
- Same flow on A2A test panel — `proposed_cart` artifact carries `enrichment` metadata

**Demo verification:** see §6 demo script.

## 9. Out of scope (explicit non-goals)

- Pre-call voice probe (per Beta DECIDE: too expensive for sprint)
- Per-chain ordering-flow scraping (Pizza Hut, Papa John's, etc.)
- Generic semantic-match upgrade (the existing fuzzy match in `compatibility.ts:findPizzaMatch` is enough for v1)
- Address validation through restaurant ordering flows (per-chain scraping is N+)
- Connector/adapter formal interface (per Beta DECIDE: defer to N+1 — premature)
- Concurrent enrichment of multiple candidates (top-1 only in v1; `ENRICH_COUNT` flag preserves the option for later)
- Cache invalidation by content hash (TTL-based only in v1)
- Vision/OCR for image-only menus
- Modifier extraction (toppings, options) — only pizza names + sizes + prices in v1
- ISS-005 / RT-201 fix (deferred per prior Beta DECIDE 0.88)

## 10. Risks

1. **Restaurant websites are heterogeneous.** A modern SPA returns mostly JS; HTML extraction won't work. **Mitigation:** fail-open + cache the failure for some short period to avoid re-fetching every search.
2. **Some restaurants forbid scraping in ToS.** **Mitigation:** identify ourselves with a polite User-Agent (`PizzaConcierge/1.0 (compatibility check; +https://agentsforall.co)`); respect robots.txt where convenient. We are reading the same content a human would when deciding where to order, so the legal exposure is low. The team has discussed this and accepts the risk for the wedge demo.
3. **Claude HTML extraction can hallucinate menu items.** **Mitigation:** prompt requires JSON-only output with explicit "if you cannot find a structured menu, return `{ pizzas: [], evidence: 'no menu found' }`". Test the failure path explicitly. Confidence on discovered items is 0.85 (lower than test-fixture 0.95).
4. **Enrichment latency.** 4s timeout per restaurant; only top-1 candidate enriched. Worst case adds ~4s to `start_pizza_order` for caution candidates. Acceptable for the demo.
5. **Cache poisoning.** A bad fetch could write a wrong menu to cache for 7 days. **Mitigation:** TTL of 7 days is short enough that it self-heals; manual cache wipe is `rm -rf runtime/menu-cache/`.

## 11. References

- ROADMAP.md → "Active backlog → Compatibility-layer follow-ups → N-1 Pre-call menu confirmation"
- yc-menu-delivery-compatibility.md (sprint live state)
- Beta consultation 2026-05-07 (8 DECIDE verdicts in recovery doc)
- Existing compatibility-layer feature: `_requirements/04-features/compatibility-layer/PRD.md`
