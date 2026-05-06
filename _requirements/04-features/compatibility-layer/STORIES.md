# Granular Stories — Compatibility Layer

Implementation-level stories. Each is verifiable in isolation. Each has dependencies, data requirements, entry state, and a verification target.

---

## S-1 — Define types and module skeleton

**File:** `src/lib/compatibility.ts` (new)

**Depends on:** none

**Description:** Create the module file with all exported types (`DeliveryAvailabilityState`, `DeliveryCoverageState`, `ItemAvailabilityState`, `OverallVerdict`, `CompatibilityCheckResult<S>`, `CompatibilityAssessment`) and stub exports for the four functions.

**Verifiable by:** `npm run build` passes; `import { assessCompatibility } from "../lib/compatibility.js"` works in another file.

**Parallel-safe:** yes (foundation only)

---

## S-2 — Extend Restaurant type

**File:** `src/data/restaurants.ts`

**Depends on:** none

**Description:** Add optional `serviceType?: 'delivery' | 'pickup_only' | 'third_party_only' | 'unknown'` to `Restaurant`. Allow `deliveryRadius: number | null`. Set `serviceType: 'delivery'` on `test_vlad` (and any other test fixtures).

**Entry state:** `Restaurant` interface lacks the field; test fixtures lack the value.

**Verifiable by:** `npm run build` passes; `restaurant.serviceType` is typed; test fixtures have it.

**Parallel-safe:** yes

---

## S-3 — Domino's serviceType

**File:** `src/connectors/dominos.ts`

**Depends on:** S-2

**Description:** In `mapToRestaurant`, set `serviceType: 'delivery'`. Domino's API already filters by `IsDeliveryStore && AllowDeliveryOrders`, so this is honest labeling.

**Verifiable by:** any Domino's-derived restaurant in test data has `serviceType === 'delivery'`.

---

## S-4 — Places: stop fabricating delivery data

**File:** `src/connectors/places.ts`

**Depends on:** S-2

**Description:** In `mapToRestaurant`, set `deliveryRadius: null` (instead of computing from haversine) and `serviceType: 'unknown'`. Add a comment marking this as the truth-telling fix. Update any consumer that reads `deliveryRadius` (search the repo) to handle null.

**Verifiable by:** all places-derived restaurants have `deliveryRadius: null` and `serviceType: 'unknown'`. No consumer crashes on null.

---

## S-5 — Implement `checkDeliveryAvailability`

**File:** `src/lib/compatibility.ts`

**Depends on:** S-1, S-2

**Description:** Implement per the rules in PRD §6.1. Test fixture with `serviceType: 'delivery'` → `available`/0.95. Places-derived (no serviceType OR `'unknown'`) → `unknown`/0.4. Pickup-only → `pickup_only`/0.95. Third-party-only → `third_party_only`/0.95.

**Verifiable by:** unit tests S-15 cases #1-3.

---

## S-6 — Implement `checkDeliveryCoverage`

**File:** `src/lib/compatibility.ts`

**Depends on:** S-1, S-2

**Description:** Take `(restaurant, userLat?, userLng?)`. If lat/lng undefined → `requires_address`/0.3. If `restaurant.deliveryRadius == null` → `unknown`/0.4. Else compute haversine distance; ≤ radius → `in_range`/0.9; > radius → `out_of_range`/0.9. Source tag from restaurant id prefix (`dominos_*` → `dominos_api`, `test_*` → `test_fixture`, `places_*` → `places_api` (but radius will be null → unknown)).

**Verifiable by:** unit tests S-15 cases #4-6.

---

## S-7 — Implement `checkItemAvailability`

**File:** `src/lib/compatibility.ts`

**Depends on:** S-1, S-2

**Description:** Reuse normalize + fuzzy match logic similar to `presets.ts:pickSizeForPizza`. Empty `intentStyle` → `unknown`/0.5 with nextStep "ask user." Test/Domino's restaurant with exact match → `available`/0.95. Fuzzy match → `available`/0.8. No match in real menu → `not_available`/0.85. Places restaurant with generic menu match → `likely_available`/0.6. Places miss → `unknown`/0.4 with nextStep "confirm on call."

**Verifiable by:** unit tests S-15 cases #7-11.

---

## S-8 — Implement `assessCompatibility` combiner

**File:** `src/lib/compatibility.ts`

**Depends on:** S-5, S-6, S-7

**Description:** Run the three checks, then combine per the rules in COMPATIBILITY-MODEL.md verdict rules. no_go beats caution beats go. nextStep selection: first failing check for no_go; lowest-confidence check for caution; null for go.

**Verifiable by:** unit tests S-15 cases #12-15.

---

## S-9 — Compatibility logging hook

**File:** `src/lib/compatibility.ts`

**Depends on:** S-8

**Description:** Inside `assessCompatibility`, after computing the verdict, call the canonical logger with `cat: "compatibility"` and the full assessment. If logger is unavailable (e.g. tests), fail open silently.

**Verifiable by:** S-15 case #16: spy on logger; assert event emitted with full data.

---

## S-10 — `start_pizza_order` integration

**File:** `src/server.ts`

**Depends on:** S-1..S-9

**Description:** In `start_pizza_order` handler:
1. Geocode `resolvedAddress` once (use existing `geocodeAddress` from places.ts or expose as a helper).
2. Per restaurant, call `assessCompatibility(restaurant, userLat, userLng, intent_style)`.
3. Embed `compatibility` in each response entry.
4. Sort restaurants: `go` > `caution` > `no_go`.
5. Add `recommended: result.overall !== 'no_go'`.
6. Update `start_pizza_order` description to add the "BEFORE PROCEEDING TO ORDER" guidance section (PRD A7).

**Verifiable by:** integration smoke — call `start_pizza_order` with `intent_style: 'meat_lovers'` and verify the response shape; manually inspect.

---

## S-11 — `place_order` block

**File:** `src/server.ts`

**Depends on:** S-1..S-9, S-10

**Description:** Add `override_compatibility?: boolean` to `place_order` schema. In handler:
1. After resolving the restaurant (existing logic), call `assessCompatibility`.
2. If `overall === 'no_go'` and `override_compatibility !== true`, return error response with `error_code: 'compatibility_blocked'` and the assessment fields, no Bland call.
3. If override, log `EVT-compatibility-override` and proceed.

**Verifiable by:** smoke — `place_order` with no_go restaurant returns error and does not fire Bland; with override, proceeds and event is logged.

---

## S-12 — A2A `proposed_cart` artifact embeds compatibility

**File:** `src/a2a/executor.ts`

**Depends on:** S-1..S-9

**Description:** In the `proposed_cart` artifact emission, include the compatibility assessment for the chosen restaurant.

**Verifiable by:** A2A round-trip — artifact body includes `compatibility` field.

---

## S-13 — Bland prompt ITEM-CONFIRM step

**File:** `src/connectors/bland.ts`

**Depends on:** S-1..S-9

**Description:** Add optional `itemAvailabilityUnknown?: boolean` to `PlaceOrderRequest`. In `buildCallPrompt`, when set, prepend an ITEM-CONFIRM block to call instructions. Sanitize intent through existing `wrapCustomerData`. Prompt:

> ITEM-CONFIRM (FIRST STEP): Before placing the order, ask: "Quick question — do you carry [intent_style]?" If they say no, ask if you can substitute or note this back to the customer. If they say yes, proceed.

`server.ts:place_order` sets the flag from `assessCompatibility().item.state === 'unknown'`.

**Verifiable by:** unit test on `buildCallPrompt` confirming the block appears when set; absent when unset.

---

## S-14 — Update tool descriptions

**File:** `src/server.ts`

**Depends on:** S-10, S-11, S-13

**Description:** Update `start_pizza_order` description to add compatibility-state guidance section (per PRD A7). Update `place_order` description to mention `override_compatibility` and the block.

**Verifiable by:** description text contains "compatibility.overall", "go", "caution", "no_go" verbatim.

---

## S-15 — Unit tests

**File:** `src/lib/compatibility.test.ts` (new)

**Depends on:** S-5..S-9

**Description:** Sixteen cases (15 from PRD §9 + #16 logging spy). Use vitest if present in the repo; otherwise plain node:test.

**Verifiable by:** `npm test` (or whatever the project runs).

---

## Dependency graph

```
S-1 (types) ──┬─→ S-5 ─┬─→ S-8 ─→ S-9 ──┬─→ S-10 ─→ S-14
              ├─→ S-6 ─┤                ├─→ S-11
              └─→ S-7 ─┘                ├─→ S-12
                                        ├─→ S-13
                                        └─→ S-15
S-2 (Restaurant) ──┬─→ S-3
                   └─→ S-4
                   └─→ S-5..S-7 (consume the field)
```

S-1 + S-2 are foundation; S-3 + S-4 update connectors; S-5..S-9 implement logic; S-10..S-13 wire integration; S-14 polishes descriptions; S-15 covers with tests.

Approximate sequencing for one builder: S-1, S-2 (parallel-safe) → S-3, S-4 (parallel-safe) → S-5, S-6, S-7 (parallel-safe) → S-8 → S-9 → S-15 (parallel with S-10..S-14) → S-10 → S-11 → S-12 → S-13 → S-14.
