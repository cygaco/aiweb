# PRD: Compatibility Layer (Delivery / Coverage / Item)

## 1. Title + Classification

**Compatibility Layer for Delivery Orders** — medium feature / new module + four touch points across MCP server, A2A executor, and connectors.

YC-application sprint, 2026-05-06. Wedge feature: prevents the agent from blindly attempting a delivery order it cannot fulfill. Maps to a larger agent-economy compatibility-and-trust layer.

## 2. Surface

- `src/lib/compatibility.ts` — **new**. Three checks (`checkDeliveryAvailability`, `checkDeliveryCoverage`, `checkItemAvailability`) + combined `assessCompatibility()` returning the verdict, confidence, source, reason, next-step.
- `src/lib/compatibility.test.ts` — **new**. Unit tests for each check + `assessCompatibility`.
- `src/data/restaurants.ts` — extend `Restaurant` with optional `serviceType?: 'delivery' | 'pickup_only' | 'unknown'` (existing `deliveryRadius` retained but its source now annotated). Test fixture `test_vlad` keeps `serviceType: 'delivery'`.
- `src/connectors/dominos.ts` — set `serviceType: 'delivery'` on returned restaurants (real Domino's API filters non-delivery already, so this is just truthful labeling).
- `src/connectors/places.ts` — set `serviceType: 'unknown'` (Places API doesn't tell us delivery capability — be honest about it). Stop fabricating `deliveryRadius` from haversine; emit `deliveryRadius: null` and let the compatibility layer mark coverage UNKNOWN.
- `src/server.ts` — `start_pizza_order` handler embeds `compatibility` block per-restaurant in response, sorts/annotates accordingly, updates tool description so Claude reads compatibility states. `place_order` blocks when `assessCompatibility().overall === 'no_go'` unless caller passes `override_compatibility: true`.
- `src/a2a/executor.ts` — surface compatibility in `proposed_cart` artifact for A2A clients.
- `src/connectors/bland.ts` — when item availability is `unknown`, append a confirmation question to the call prompt: *"Do you carry [item]? If yes, proceed; if not, ask the customer if they'd like an alternative."*

## 3. Context

The current pizza concierge has caused three real demo failures:

1. **No-pizza failure:** restaurant returned by discovery did not actually carry the requested style. Agent placed call anyway, restaurant said "we don't have meat lovers."
2. **No-deliver failure:** restaurant in the result list was pickup-only or third-party-only. Agent called, restaurant said "we don't deliver."
3. **No-coverage failure:** restaurant delivers but not to the user's address. Agent called, restaurant said "we don't deliver to that area."

Existing flow lets all three through:

- `places.ts:136` invents `deliveryRadius` as `Math.max(5, Math.ceil(distMi * 1.5))` — this is fabricated, not real data.
- `places.ts` returns any "pizza"-named restaurant with no signal about whether it actually delivers.
- `server.ts:start_pizza_order` returns the full list to the LLM with no compatibility annotation.
- `presets.ts:pickSizeForPizza` returns null when the requested pizza isn't on the menu, but `start_pizza_order` doesn't surface that as a top-level "this restaurant can't fulfill your intent" signal.
- `place_order` accepts the call request and fires Bland regardless of any of the above.

The fix is a **compatibility layer**: a small module that answers the three questions cheaply and near the call, with explicit confidence and source for each verdict, surfacing UNKNOWN honestly instead of faking confidence.

## 4. Goal

The agent never places a Bland call when a cheap compatibility check would tell it the order is doomed. When compatibility is genuinely UNKNOWN, the agent picks the cheapest safe resolution (existing data → user clarification → confirm-on-call) instead of pretending it knows.

## 5. Acceptance Criteria

> **Requirements registry IDs** (for graph indexing):
> - REQ-compat-types-001 → §6.1 module types + exports (AC1)
> - REQ-compat-delivery-001 → delivery availability check (AC2)
> - REQ-compat-coverage-001 → delivery coverage check (AC3)
> - REQ-compat-item-001 → item availability check (AC4)
> - REQ-compat-combiner-001 → assess + verdict rules (AC5)
> - REQ-compat-server-001 → start_pizza_order embed + sort + recommended flag (AC6)
> - REQ-compat-tooldesc-001 → start_pizza_order description with reproduce-verbatim (AC7)
> - REQ-compat-block-001 → place_order hard-blocks no_go (AC8)
> - REQ-compat-a2a-001 → A2A proposed_cart artifact embeds compatibility (AC9)
> - REQ-compat-bland-001 → Bland prompt ITEM-CONFIRM step (AC10)
> - REQ-compat-logging-001 → structured EVT-compatibility events (AC11)
> - REQ-compat-truth-001 → no fabricated confidence; deliveryRadius:null for places (AC12)

1. **A1 — `compatibility.ts` exports three named checks + one combined assess.** Each check returns a `CompatibilityCheckResult` with `state` (enum), `confidence` (0..1), `source` (string tag), `reason` (string), `nextStep` (string or null). `assessCompatibility(restaurant, userAddress, intent)` returns `{ delivery, coverage, item, overall, nextStep }` where `overall` is `'go' | 'caution' | 'no_go'`.

2. **A2 — Delivery availability check derives from real data when present, UNKNOWN otherwise.** `restaurant.serviceType === 'delivery'` → state `available`, confidence 0.95, source `restaurant.fields`. `serviceType === 'pickup_only'` → state `pickup_only`, confidence 0.95. `serviceType === 'unknown'` → state `unknown`, confidence 0.4, source `places_api`, nextStep `"Confirm on call or ask user."`. No restaurant ever gets `available` without explicit data backing it.

3. **A3 — Delivery coverage check uses real `deliveryRadius` when sourced from a real API, UNKNOWN when fabricated.** When `restaurant.deliveryRadius` is null OR the restaurant came from `places_api`, coverage state is `unknown`, confidence 0.4. When it's from `dominos_api` (real `MaxDistance`), use real geocoding distance vs radius. Test fixtures keep their hardcoded radius (it's truthful for the demo).

4. **A4 — Item availability check matches `intent_style` against menu.** For each pizza in `restaurant.menu.pizzas`, normalize and compare against `intent_style` (the same fuzzy match logic in `presets.ts:pickSizeForPizza`). Match found → state `available`, confidence 0.9 (real menu) or 0.6 (generic Places menu). No match → state `not_available`, confidence 0.85 (real menu) or `unknown`, confidence 0.4 (Places generic). Empty intent_style → state `unknown`, confidence 0.5, nextStep `"Ask user what they want."`

5. **A5 — Overall verdict combines the three.** Rules:
   - Any state in `{not_available, out_of_range, pickup_only}` → `overall: no_go` + `nextStep` derived from the failing check.
   - Any state in `{unknown}` AND no `no_go` → `overall: caution` + `nextStep` derived from the lowest-confidence check.
   - All states `{available, in_range}` → `overall: go` + `nextStep: null`.

6. **A6 — `start_pizza_order` response carries compatibility per restaurant.** Each restaurant entry in the response gets a `compatibility` field with the four sub-fields (delivery, coverage, item, overall) and a top-level `nextStep` string. Restaurants are sorted: `go` > `caution` > `no_go`. `no_go` restaurants are still returned (so the agent can explain why they were excluded), but with a `recommended: false` flag.

7. **A7 — `start_pizza_order` tool description tells Claude what to do with compatibility.** New section in the description right after the entry-points block:

   > BEFORE PROCEEDING TO ORDER: Each returned restaurant has a `compatibility.overall` field.
   > - `go`: proceed to cart-flow normally.
   > - `caution`: proceed but surface the unknown to the user; resolve via cheapest safe option (existing data > user clarification > targeted call).
   > - `no_go`: DO NOT call this restaurant. Explain blocker to user; pick a `go`/`caution` alternative or ask user how to proceed.

8. **A8 — `place_order` hard-blocks when overall is `no_go`.** When `place_order` receives a request and `assessCompatibility(...)` returns `overall: 'no_go'`, the handler returns `{ status: "error", error_code: "compatibility_blocked", reason: <state-specific>, next_step: <recommendation>, override_field: "override_compatibility" }` and does NOT fire the Bland call. If the caller sets `override_compatibility: true`, the block is bypassed; an `EVT-compatibility-override` event is logged.

9. **A9 — A2A `proposed_cart` artifact echoes compatibility.** When the executor builds the artifact, it includes the compatibility block alongside the cart so A2A clients see it.

10. **A10 — Bland prompt confirms item UNKNOWN on call.** When item availability is `unknown` (i.e., we ARE calling because the user accepted the caution path), the Bland call prompt prepends a confirmation step: *"Before placing the order, ask if they carry [item_style]. If they say no, ask the customer (relayed via Bland) if they'd like an alternative."* Implementation: `bland.ts:buildCallPrompt` adds a conditional block when `order.itemAvailabilityUnknown` is set.

11. **A11 — Logging emits structured compatibility events.** Every `assessCompatibility()` call emits `EVT-compatibility` to the events log via the canonical logger pattern: `{ cat: "compatibility", restaurant_id, intent_style, delivery, coverage, item, overall }`. Survives session crash for retro analysis.

12. **A12 — No backward-compat hacks.** Don't keep fabricated `deliveryRadius` for places_api once the new field is in place. Stop lying. (Tests will fail loudly if any caller still relies on the fake value.)

## 6. Approach

### 6.1 — `src/lib/compatibility.ts` (new file, ~250 lines)

Module structure:

```ts
import type { Restaurant } from "../data/restaurants.js";

export type DeliveryAvailabilityState = 'available' | 'pickup_only' | 'third_party_only' | 'unknown' | 'no';
export type DeliveryCoverageState = 'in_range' | 'out_of_range' | 'unknown' | 'requires_address';
export type ItemAvailabilityState = 'available' | 'likely_available' | 'not_available' | 'unknown' | 'requires_substitution';
export type OverallVerdict = 'go' | 'caution' | 'no_go';

export interface CompatibilityCheckResult<S extends string> {
  state: S;
  confidence: number;       // 0..1
  source: string;            // 'restaurant.fields' | 'dominos_api' | 'places_api' | 'menu_match' | 'computed' | ...
  reason: string;            // human-readable
  nextStep: string | null;   // recommendation for resolution
}

export interface CompatibilityAssessment {
  delivery: CompatibilityCheckResult<DeliveryAvailabilityState>;
  coverage: CompatibilityCheckResult<DeliveryCoverageState>;
  item: CompatibilityCheckResult<ItemAvailabilityState>;
  overall: OverallVerdict;
  nextStep: string | null;
}

export function checkDeliveryAvailability(restaurant: Restaurant): CompatibilityCheckResult<DeliveryAvailabilityState> { ... }
export function checkDeliveryCoverage(restaurant: Restaurant, userLat: number, userLng: number): CompatibilityCheckResult<DeliveryCoverageState> { ... }
export function checkItemAvailability(restaurant: Restaurant, intentStyle: string | undefined): CompatibilityCheckResult<ItemAvailabilityState> { ... }
export function assessCompatibility(restaurant: Restaurant, userLat: number, userLng: number, intentStyle: string | undefined): CompatibilityAssessment { ... }
```

Rules in `checkDeliveryAvailability`:

- `restaurant.serviceType === 'delivery'` → available, 0.95, `restaurant.fields`
- `restaurant.serviceType === 'pickup_only'` → pickup_only, 0.95, `restaurant.fields`
- `restaurant.serviceType === 'third_party_only'` → third_party_only, 0.95, `restaurant.fields`
- `restaurant.serviceType === 'unknown'` OR not set → unknown, 0.4, `places_api` (or whichever source), nextStep: `"Ask user about pickup, or call to confirm."`
- (No `'no'` state from current data; reserved for future explicit non-delivery flag.)

Rules in `checkDeliveryCoverage`:

- `restaurant.deliveryRadius == null` → unknown, 0.4, source: `places_api`, nextStep: `"Confirm coverage on call."`
- `restaurant.id` starts with `places_` AND `deliveryRadius` is computed → unknown, 0.4 (don't trust the fabrication)
- `restaurant.id` starts with `dominos_` OR `restaurant.isTest` → use Haversine distance vs radius:
  - distance ≤ radius → in_range, 0.9, `dominos_api` (or `test_fixture`)
  - distance > radius → out_of_range, 0.9, with nextStep: `"Find a closer restaurant."`

Rules in `checkItemAvailability`:

- `intentStyle` empty/undefined → unknown, 0.5, `none`, nextStep: `"Ask user what they want."`
- `restaurant.isTest` OR id starts with `dominos_`:
  - normalize-match in `restaurant.menu.pizzas`: exact name → available, 0.95, `menu_match`
  - fuzzy match (substring either direction) → available, 0.8
  - no match → not_available, 0.85, nextStep: `"Suggest a substitute or alternative restaurant."`
- `places_*` restaurants (use generic 3-item menu):
  - exact match in generic menu → likely_available, 0.6, `places_generic_menu`
  - no match → unknown, 0.4 (the generic menu is incomplete), nextStep: `"Confirm on call: 'Do you carry [intent]?'"`

Rules in `assessCompatibility` (the combiner):

```ts
const states = [delivery.state, coverage.state, item.state];
const noGo = states.some(s => ['pickup_only', 'third_party_only', 'no', 'out_of_range', 'not_available'].includes(s));
const unknown = states.some(s => ['unknown', 'requires_address', 'requires_substitution', 'likely_available'].includes(s));
let overall: OverallVerdict;
let nextStep: string | null;
if (noGo) {
  overall = 'no_go';
  // first failing check determines nextStep
  nextStep = [delivery, coverage, item].find(c => isNoGoState(c.state))?.nextStep ?? "Pick a different restaurant.";
} else if (unknown) {
  overall = 'caution';
  // lowest confidence drives the resolution path
  const lowest = [delivery, coverage, item].reduce((a, b) => a.confidence < b.confidence ? a : b);
  nextStep = lowest.nextStep;
} else {
  overall = 'go';
  nextStep = null;
}
```

### 6.2 — `src/data/restaurants.ts`

Add to `Restaurant` interface:

```ts
serviceType?: 'delivery' | 'pickup_only' | 'third_party_only' | 'unknown';
```

Test fixtures (Vlad's, etc.) get `serviceType: 'delivery'` explicitly.

### 6.3 — `src/connectors/dominos.ts`

In `mapToRestaurant`, set `serviceType: 'delivery'`. The Domino's API already filters by `IsDeliveryStore && AllowDeliveryOrders`, so this is honest labeling.

### 6.4 — `src/connectors/places.ts`

In `mapToRestaurant` (places.ts:117), change:

```ts
deliveryRadius: Math.max(5, Math.ceil(distMi * 1.5)),
```

to:

```ts
deliveryRadius: null,    // Places API doesn't tell us — compatibility layer marks UNKNOWN
serviceType: 'unknown',  // honest signal
```

Update the `Restaurant` type to allow `deliveryRadius: number | null`. Update all consumers; `bland.ts:isWithinDeliveryRadius` etc. should treat null as unknown.

### 6.5 — `src/server.ts` `start_pizza_order` handler

Inside the handler, after `findNearbyRestaurants(...)` and before building `result.restaurants`, geocode the user address once (cache the result), then per-restaurant call `assessCompatibility`. Embed the result in the per-restaurant entry. Sort the array `go > caution > no_go`. Add `recommended: result.overall !== 'no_go'`.

### 6.6 — `src/server.ts` `place_order` handler

Before `dispatchCall`, call `findNearbyRestaurants` again (or pass through from `start_pizza_order` via a cache — for now, redo the lookup to avoid state). Find the matching restaurant by id. Call `assessCompatibility`. If `overall === 'no_go'` AND `override_compatibility !== true`, return error response and do NOT fire Bland.

Add to schema:

```ts
override_compatibility: z.boolean().optional().describe("Set true to bypass compatibility blocking. Use only when the agent has explicit user approval to proceed despite a known mismatch (e.g., user wants pickup from a no-delivery restaurant)."),
```

### 6.7 — `src/server.ts` tool descriptions

Update `start_pizza_order` description to include the compatibility-state guidance (see A7). Update `place_order` description to mention `override_compatibility` and the block.

### 6.8 — `src/a2a/executor.ts`

In the `proposed_cart` artifact, include `compatibility` field (the full assessment for the chosen restaurant). The A2A client can surface this to the user.

### 6.9 — `src/connectors/bland.ts`

In `buildCallPrompt`, if `order.itemAvailabilityUnknown === true`, prepend a confirmation step in the call instructions:

```
ITEM-CONFIRM (FIRST STEP): Before placing the order, ask: "Quick question — do you carry [intent_style]?" If they say no, ask if you can substitute or note this back to the customer. If they say yes, proceed normally.
```

`PlaceOrderRequest` gains `itemAvailabilityUnknown?: boolean`. `server.ts:place_order` sets it from the assessment.

## 7. Dependencies / Blockers

- None new. Pure module addition + minor type/handler updates.
- Geocoding for coverage check uses existing `places.ts:geocodeAddress` if available. Compatibility module accepts `userLat/userLng` directly so callers handle geocoding.

## 8. Out of Scope

- **Restaurant onboarding marketplace** — for the larger agent-economy vision but not this sprint.
- **Trust/reputation system** — adjacent feature, separate sprint.
- **Voice-side menu extraction** — parsing the call transcript for menu items is a follow-up.
- **Multi-restaurant comparison shopping** — agent picks one path; no parallel calls.
- **Address geocoding accuracy improvements** — use existing logic.
- **Profile-stored compatibility preferences** — defer.
- **Real-time price re-checking** — out of scope.
- **Dietary/allergen compatibility** — separate concern, intersects but not bundled here.
- **A new restaurant ID prefix taxonomy** — keep current `dominos_*` / `places_*` / `test_*` naming.

## 9. Test Plan

### `src/lib/compatibility.test.ts`

| # | Scenario | Expected |
|---|---|---|
| 1 | `checkDeliveryAvailability` on test_vlad (serviceType=delivery) | state=available, confidence>=0.9 |
| 2 | `checkDeliveryAvailability` on a places_* restaurant (serviceType unset) | state=unknown, confidence~0.4 |
| 3 | `checkDeliveryAvailability` with explicit `pickup_only` | state=pickup_only |
| 4 | `checkDeliveryCoverage` on test_vlad with user 5 mi away (radius=10) | in_range, confidence>=0.9 |
| 5 | `checkDeliveryCoverage` on test_vlad with user 50 mi away | out_of_range |
| 6 | `checkDeliveryCoverage` on places_* (deliveryRadius=null) | unknown, confidence~0.4 |
| 7 | `checkItemAvailability` test_vlad + intent="meat_lovers" (matches menu) | available, confidence>=0.9 |
| 8 | `checkItemAvailability` test_vlad + intent="sushi" (no match) | not_available |
| 9 | `checkItemAvailability` places_* + intent="pepperoni" (matches generic) | likely_available, confidence~0.6 |
| 10 | `checkItemAvailability` places_* + intent="meat_lovers" (not in generic) | unknown |
| 11 | `checkItemAvailability` with empty intent | unknown, nextStep mentions "ask user" |
| 12 | `assessCompatibility` all-go scenario | overall=go, nextStep=null |
| 13 | `assessCompatibility` with one no_go (out_of_range) | overall=no_go, nextStep mentions different restaurant |
| 14 | `assessCompatibility` with two unknowns | overall=caution, nextStep targets lowest-confidence check |
| 15 | `assessCompatibility` with mix of go + caution + no_go | overall=no_go (no_go wins) |

### Integration smoke

- `npm run build` — TypeScript types pass.
- Manual: `start_pizza_order` with `intent_style: 'meat_lovers'` and an address. Verify the response contains `compatibility` per restaurant and the field is populated correctly.
- Manual: `place_order` with a known no_go restaurant. Verify it returns `compatibility_blocked` and no Bland call fires.
- Manual: `place_order` with `override_compatibility: true` on the same input. Verify the call fires and an override event is logged.
- A2A: send a message that hits a no_go path. Verify the `proposed_cart` artifact carries the compatibility block and the executor refuses to fire the call.

### QA checklist

See `_requirements/04-features/compatibility-layer/QA-CHECKLIST.md`.

### Red-team checklist

See `_requirements/04-features/compatibility-layer/REDTEAM-CHECKLIST.md`.

## 10. Files Modified

| File | Change |
|---|---|
| `src/lib/compatibility.ts` | NEW — three checks + assessCompatibility + types. |
| `src/lib/compatibility.test.ts` | NEW — 15 unit cases. |
| `src/data/restaurants.ts` | Add `serviceType?` to Restaurant; set `serviceType: 'delivery'` on test fixtures; allow `deliveryRadius: number | null`. |
| `src/connectors/dominos.ts` | Set `serviceType: 'delivery'` in `mapToRestaurant`. |
| `src/connectors/places.ts` | Set `deliveryRadius: null` and `serviceType: 'unknown'` in `mapToRestaurant`. Update consumers that read `deliveryRadius` to handle null. |
| `src/server.ts` | (a) `start_pizza_order` handler: geocode, assess each restaurant, embed `compatibility` per entry, sort by overall verdict, set `recommended` flag. (b) `start_pizza_order` description: add compatibility-state guidance section. (c) `place_order` schema: add `override_compatibility?` field. (d) `place_order` handler: assess pre-call, block on `no_go` unless override, log override event. (e) `place_order` description: mention block. |
| `src/a2a/executor.ts` | Embed compatibility in `proposed_cart` artifact. |
| `src/connectors/bland.ts` | Conditional ITEM-CONFIRM step in call prompt when `order.itemAvailabilityUnknown` is set. `PlaceOrderRequest` gains the field. |

## 11. Critical Constraints

- **No fabricated confidence.** A check that doesn't have real data MUST emit `unknown` with confidence ≤ 0.5. Never fake `available` to keep the demo flowing.
- **Compatibility is NOT bound into the confirmation token.** It's a pre-call gate, not part of the order contract. Adding it to the token would break the existing token-binding tests and add re-evaluation churn on resubmission.
- **Logging is mandatory.** Every assess call emits `EVT-compatibility` with full state. This is YC-evidence material for the demo retro.
- **Block-by-default.** `place_order` blocks `no_go` UNLESS `override_compatibility: true`. Don't soft-warn; refuse.
- **Override is logged loudly.** When override fires, emit `EVT-compatibility-override` with all assessment fields so we can audit demo-time choices.
- **Don't re-derive geocoding twice.** If `start_pizza_order` already resolved lat/lng, pass it through (or cache for short TTL). For this sprint, accepting a re-lookup at `place_order` time is fine; document it.
- **No new sanitization paths in Bland prompt.** The conditional ITEM-CONFIRM step uses existing `wrapCustomerData` for the intent_style render (defense in depth — intent comes from the user).
- **Backward compat for callers that don't pass `userLat/userLng`.** `assessCompatibility` accepts undefined coordinates → coverage state = `requires_address`, confidence 0.3.

## 12. Why now / YC demo context

The user is applying to YC and demoing the pizza concierge. Three real demo failures (no-pizza, no-deliver, no-coverage) drove this sprint plan. The compatibility layer is the wedge that maps to the larger vision: protocol-agnostic discovery, compatibility, and trust for the supply-side agentic economy (long-tail SMBs not covered by Shopify Agentic Storefronts, UCP, or foundation-model app stores).

Garry Tan's YC application advice ("earnestness > polish, real discoveries from interacting with the technology") fits this exactly: three real-world failures became three product requirements became a coherent compatibility model. The story writes itself.
