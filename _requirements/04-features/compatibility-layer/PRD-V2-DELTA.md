# PRD v2 Delta — Compatibility Layer

> Spec-reviewer (gpt-5.5) found 4 CRITICAL + 8 MAJOR + several minor defects in v1 PRD before any builder code landed. This file is the definitive set of fixes the builder MUST apply on top of `PRD.md`. When the two disagree, this file wins.
>
> Source review: `_requirements/04-features/compatibility-layer/SPEC-REVIEW-V1.md` (saved separately if needed for audit).

## CRITICAL fixes (block any build)

### C-1 — Domino's `lat: 0, lng: 0` breaks coverage

**Problem:** `src/connectors/dominos.ts:65-66` hardcodes lat/lng to 0. Haversine vs (0°,0°) computes ~5000mi for any US user → every Domino's store falsely flagged `out_of_range` → demo Flow B/E inverts.

**Fix (cheapest, demo-safe):** In `checkDeliveryCoverage`, when `restaurant.id.startsWith("dominos_")` AND `restaurant.lat === 0 && restaurant.lng === 0`, return `state: 'unknown'`, `confidence: 0.4`, `source: 'dominos_api_coords_missing'`, `nextStep: "Confirm coverage on call (Domino's API didn't return store coordinates)."` This is conservative and demo-safe.

**Future fix (out of this sprint):** Geocode `restaurant.address` in `dominos.ts:mapToRestaurant` OR pull from `StoreCoordinates` field if Domino's exposes it. Add as a follow-up issue in `issues.md`.

**Test added:** new case in `compatibility.test.ts`: domino's restaurant with lat=0,lng=0 → coverage unknown (not in_range, not out_of_range).

### C-2 — PRD A3 contradicts §6.1 on places coverage

**Problem:** A3 says "places_api OR null radius → unknown"; §6.1 says "places_ id AND deliveryRadius is computed → unknown". After §6.4 sets places `deliveryRadius: null`, the second case is dead code.

**Fix:** Drop the id-prefix rule from coverage logic. **Single rule:** `restaurant.deliveryRadius == null` → state `unknown`, confidence 0.4. The id prefix only determines the `source` tag for diagnostics. PRD AC3 is the authoritative wording.

### C-3 — Canonical logger doesn't exist in `src/`

**Problem:** PRD A11 references "canonical logger pattern" — no `logger`, `appendEvent`, or events writer exists in product code. Builder would invent something incompatible.

**Fix:** Add a new file in scope: `src/lib/event-log.ts` exporting `logCompatibilityEvent(data)` and `logCompatibilityOverride(data)`. Implementation: `appendFileSync` to `runtime/events.jsonl` (creating `runtime/` if missing) with shape:

```ts
{ id: `EVT-compat-${randomId()}`, ts: new Date().toISOString(), cat: "compatibility", actor: "alex", data: <payload> }
```

Fail-open silently if write fails (don't break the order flow on log failures). New story **S-9.5** added below.

### C-4 — HL-STORIES Flow D vs QA D.3 / AC8 contradict

**Problem:** HL-STORIES Flow D says "[caution] only after user accepts caution path". QA D.3 + AC8 say `caution` does NOT block `place_order`.

**Resolution:** AC8 + QA D.3 win — `caution` does NOT auto-block. Flow D updated:

> **Flow D — Unknown Compatibility:** Trigger: any check returns `unknown`. Agent behavior: `start_pizza_order` returns `compatibility.overall: 'caution'` and a `nextStep`. The agent's natural-language reply MUST surface the unknown to the user verbatim from `nextStep` (e.g., "I'm not sure if they have meat lovers — should I call to confirm?"). User can proceed (place_order fires with ITEM-CONFIRM in Bland call) or decline (agent picks alternative). `place_order` does NOT block on caution; the ITEM-CONFIRM step in Bland resolves item-unknown on the call. Address-unknown / coverage-unknown caution paths require user clarification before place_order.

## MAJOR fixes (block-before-merge)

### M-1 — Test-fixture audit

**Add to S-2 acceptance:** "Audit all `tests/*.test.ts` Restaurant literals. Any that mocks a Restaurant and asserts compatibility-impacted behavior must have `serviceType: 'delivery'` (or appropriate variant) explicitly set; otherwise `checkDeliveryAvailability` returns `unknown` and may invalidate test assertions."

### M-2 — `assessCompatibility` signature

**Fix AC1:** `assessCompatibility(restaurant, userLat: number | undefined, userLng: number | undefined, intentStyle: string | undefined)` — coordinates are number|undefined (not just number; undefined → coverage state `requires_address`). Drop the "userAddress" wording from A1.

### M-3 — AC5 caution bucket missing states

**Fix AC5 wording:** "Any state in `{unknown, requires_address, requires_substitution, likely_available}` AND no `no_go` → caution." (Adds three states omitted from v1.)

### M-4 — Drop `bland.ts:isWithinDeliveryRadius`

**Fix §6.4:** Function does not exist. Remove the reference. The only consumers of `restaurant.deliveryRadius` post-build are: (a) the new `compatibility.ts`, (b) test fixtures. Tests that read `deliveryRadius` continue to work because test fixtures keep numeric values (only places.ts emits null).

### M-5 — Second-pass assessment on token re-submit

**Add new story S-11.5:** "If `place_order` receives a valid `confirmation_token` but a fresh `assessCompatibility` (re-run server-side) yields `overall: 'no_go'`, return `compatibility_blocked` even though token is valid. This catches data drift between prepare_order and place_order. Override via `override_compatibility: true` still works."

### M-6 — Export `geocodeAddress`

**Add to S-10 + new file:** Move `geocodeAddress` from `places.ts` (currently private) to a new `src/lib/geo.ts` exporting `geocodeAddress(address: string, apiKey?: string): Promise<{lat, lng} | null>`. Both `places.ts` and `server.ts:start_pizza_order/place_order` import from there. If apiKey is missing, return null (graceful degrade). When null, callers fall back to `requires_address` coverage state.

### M-7 — AC4 confidence values aligned with COMPATIBILITY-MODEL

**Fix AC4 (replace v1 wording entirely):**
- Real menu (test/dominos) exact match → state `available`, confidence **0.95**, source `menu_match`
- Real menu fuzzy match → state `available`, confidence **0.8**, source `menu_match`
- Real menu no match → state `not_available`, confidence **0.85**, nextStep `"Suggest a substitute or alternative restaurant."`
- Generic Places menu match → state **`likely_available`** (NOT `available`), confidence 0.6, source `places_generic_menu`
- Generic Places menu miss → state `unknown`, confidence 0.4, nextStep `"Confirm on call: 'Do you carry [intent]?'"`
- Empty `intentStyle` → state `unknown`, confidence 0.5, nextStep `"Ask user what they want."`

### M-8 — Add `test_pickup_only` fixture for Demo Beat 4 + QA A.1

**Add to S-2:** include a new fixture in `restaurants.ts` `TEST_RESTAURANTS`:

```ts
{
  id: "test_pickup_only",
  name: "Slice Box (Pickup Only)",
  phone: "+14155550199",
  address: "Mission St, San Francisco, CA",
  lat: 37.7749, lng: -122.4194,
  deliveryRadius: 0,        // legacy field; ignored due to serviceType
  estimatedDeliveryMinutes: 0,
  acceptsCash: true,
  serviceType: "pickup_only",   // <-- the test signal
  menu: { pizzas: [...minimal pepperoni+cheese...], sides: [{name:"Garlic Knots",sizes:[{name:"Regular",price:5.99}]}] },
  hours: "Daily 11am–10pm",
  isTest: true
}
```

This is what QA A.1 mocks against and what Demo Beat 4 demos against.

## Demo-readiness fixes

### D-1 — Demo address must be SF-area, not Riddle, OR

**Fix DEMO-SCRIPT.md:** Replace `5208 Riddle Bypass Rd, Riddle, OR 97469` with a SF-area address that test_vlad's coordinates (37.7749, -122.4194) reach in-range. Use `1 Market St, San Francisco, CA 94105` for the demo (real address, ~0.5 mi from test_vlad). The Riddle, OR address can stay in user's environment as a real-world address but is NOT used in the demo flow.

### D-2 — Tool description must instruct agent to reproduce nextStep

**Fix tool description (extending PRD AC7):** Add a final line to the BEFORE PROCEEDING TO ORDER section in `start_pizza_order` description:

> When `compatibility.overall === 'caution'` or `'no_go'`, your reply to the user MUST include the verbatim text from `compatibility.nextStep`. Don't paraphrase. The nextStep is the agent's resolution-path recommendation.

## Minor fixes (apply if cheap, defer if not)

- **N-1**: PRD §2 line 13: add `'third_party_only'` to the inline serviceType union (already correct in §6.2; cosmetic).
- **N-2**: AC11 event shape: nest under `data` key, add `actor: "alex"` (matches `events.jsonl` convention). Already implied by C-3 fix.
- **N-3**: S-14 verification: change "string match on 'compatibility.overall'" to "exact substring match on 'BEFORE PROCEEDING TO ORDER:'" — sentinel header.
- **N-5**: Already covered by D-2.
- **N-6**: STORIES S-15: drop the "+#16 logging spy" wording; add as test #16 inside S-15 description ("Test #16: spy on logger; assert event emitted with full data") so PRD §9 + S-15 align (16 cases total now: 15 existing + 1 new logger spy).

## New stories to add

### S-3a — Domino's lat/lng workaround

**File:** `src/connectors/dominos.ts`
**Depends on:** S-3
**Description:** Document (in code comment, not just spec) that Domino's locator API does not return store coordinates. The compatibility layer's `checkDeliveryCoverage` handles this by emitting `unknown` when lat===0 && lng===0 for `dominos_*` restaurants.
**Verifiable by:** code comment present at the lat/lng=0 lines.

### S-9.5 — Event-log helper

**File:** `src/lib/event-log.ts` (new)
**Depends on:** none
**Description:** Export `logCompatibilityEvent(data)` and `logCompatibilityOverride(data)`. appendFileSync to `runtime/events.jsonl` (mkdir -p `runtime/` if missing). Shape: `{id, ts, cat:"compatibility"|"compatibility-override", actor:"alex", data}`. Fail-open silently on write errors.
**Verifiable by:** new test in `compatibility.test.ts` that calls `assessCompatibility` and verifies `runtime/events.jsonl` gains a line.

### S-11.5 — Second-pass assessment in place_order

**File:** `src/server.ts`
**Depends on:** S-11
**Description:** When `place_order` validates a token, also re-run `assessCompatibility` on the bound restaurant_id + intent_style. If `overall === 'no_go'` AND `override_compatibility !== true`, return `compatibility_blocked` even though token is valid. Catches data drift between prepare and place.
**Verifiable by:** integration test — issue token at time T1 with caution-state, mutate restaurant data to no_go, attempt place_order at T2 with valid token → blocked.

## Builder dispatch order

After v2 PRD is in place, dispatch order remains: S-1, S-2 → S-3, S-3a, S-4 → S-5, S-6, S-7 → S-8 → S-9 → S-9.5 → S-15 → S-10 → S-11 → S-11.5 → S-12 → S-13 → S-14.

`compatibility.test.ts` cases now total 17 (15 from v1 §9 + #16 logger spy + #17 dominos lat=0 unknown).

## Files modified by v2 (delta on top of v1)

- `src/lib/event-log.ts` — NEW (S-9.5)
- `src/lib/geo.ts` — NEW (M-6)
- `src/data/restaurants.ts` — add `test_pickup_only` fixture (M-8) + `serviceType` audit (M-1)
- `src/connectors/dominos.ts` — code comment on lat/lng=0 (S-3a)
- `src/connectors/places.ts` — import `geocodeAddress` from `geo.ts` (M-6)
- `src/lib/compatibility.ts` — handle `dominos_*` lat=0 (C-1), single-rule places coverage (C-2), updated AC4 confidence (M-7), event logging via `event-log.ts` (C-3), correct AC5 caution bucket (M-3)
- `src/server.ts` — re-assess inside `place_order` (S-11.5), import geocodeAddress from geo.ts (M-6), updated tool description (D-2)
- `src/lib/compatibility.test.ts` — 17 cases (15 + 16 + 17)
- `_requirements/04-features/compatibility-layer/HL-STORIES.md` — Flow D rewritten (C-4)
- `_requirements/04-features/compatibility-layer/DEMO-SCRIPT.md` — SF address (D-1)
