# QA Checklist — Compatibility Layer

Focused QA for the five flows. **No long-running modes.** No full-codebase audits. Each item is binary pass/fail with a defined input.

---

## Flow A: Business Does Not Deliver

| # | Setup | Action | Expected | Pass? |
|---|---|---|---|---|
| A.1 | Add a fixture restaurant `test_pickup_only` with `serviceType: 'pickup_only'`. | `start_pizza_order` with intent=pepperoni, address near pickup_only fixture | response includes restaurant with `compatibility.delivery.state == 'pickup_only'`, `compatibility.overall == 'no_go'`, `recommended == false` | |
| A.2 | Same setup. | `place_order` against `test_pickup_only` without override | response = `compatibility_blocked` error, no Bland dispatch | |
| A.3 | Same setup. | Inspect events log after A.2 | `EVT-compatibility` row with state=pickup_only emitted | |

## Flow B: Business Delivers, But Not To User

| # | Setup | Action | Expected | Pass? |
|---|---|---|---|---|
| B.1 | Use real Domino's API call (or mock) where store has `MaxDistance: 5`. User address is geographically 30 mi away. | `start_pizza_order` with that address + intent=pepperoni | response includes Domino's restaurant with `compatibility.coverage.state == 'out_of_range'`, `overall == 'no_go'` | |
| B.2 | Same setup. | `place_order` against the out-of-range restaurant | `compatibility_blocked`, no Bland call | |
| B.3 | Same setup but user address inside radius (5 mi). | `start_pizza_order` | `coverage.state == 'in_range'`, no block | |

## Flow C: Business Does Not Have Requested Pizza

| # | Setup | Action | Expected | Pass? |
|---|---|---|---|---|
| C.1 | test_vlad fixture (real menu) | `start_pizza_order` with intent=sushi | `compatibility.item.state == 'not_available'`, `overall == 'no_go'`, nextStep mentions substitute | |
| C.2 | Same setup. | `place_order` against test_vlad with intent=sushi | `compatibility_blocked` | |
| C.3 | Same restaurant, intent=meat_lovers (which IS in menu). | `start_pizza_order` | `item.state == 'available'` | |

## Flow D: Unknown Compatibility

| # | Setup | Action | Expected | Pass? |
|---|---|---|---|---|
| D.1 | Force a `places_*` restaurant in results (mock/fixture). | `start_pizza_order` with that address + intent=meat_lovers | restaurant returned with `delivery.state==unknown`, `coverage.state==unknown`, `item.state==unknown` (or likely_available if intent matches generic menu), `overall == 'caution'`, nextStep is non-null | |
| D.2 | Same setup. | Compatibility output's confidence | all unknowns ≤ 0.5 confidence | |
| D.3 | Same setup. | `place_order` without override | NOT blocked (caution is not no_go) — call proceeds; ITEM-CONFIRM block appears in Bland prompt when item.state is unknown | |
| D.4 | User address omitted (no userLat/userLng). | `assessCompatibility` directly with undefined coords | `coverage.state == 'requires_address'`, overall == 'caution' | |
| D.5 | intent_style empty/undefined | `assessCompatibility` | `item.state == 'unknown'`, nextStep mentions "ask user" | |

## Flow E: Successful Compatibility Path

| # | Setup | Action | Expected | Pass? |
|---|---|---|---|---|
| E.1 | test_vlad fixture, user nearby, intent=meat_lovers | `start_pizza_order` | `overall: 'go'`, `recommended: true`, no nextStep | |
| E.2 | Same setup. | Run end-to-end: prepare_order → place_order with confirmation_token | Bland dispatched, success path | |
| E.3 | Same setup. | Inspect events log | `EVT-compatibility` with overall=go | |

---

## Cross-flow regressions

| # | Action | Expected |
|---|---|---|
| R.1 | `start_pizza_order` without compatibility-related changes (no intent_style passed) | Still works; compatibility.item.state = unknown but not failing |
| R.2 | All existing tests in `tests/*.test.ts` | Still pass |
| R.3 | `npm run build` | Clean |
| R.4 | A2A test message → `proposed_cart` | Artifact contains `compatibility` field for chosen restaurant |
| R.5 | Token-binding tests (`tests/confirmation-token.test.ts`) | Still pass — compatibility is NOT in the token |
| R.6 | place_order with override_compatibility=true on a no_go | Bypasses block, dispatches Bland, logs `EVT-compatibility-override` |

---

## Out-of-scope for this QA pass

- Performance/load testing (deferred — sprint is YC-demo-focused)
- Multi-language input
- Geocoding accuracy (use existing logic)
- Real Domino's network failure simulation (out of scope; existing fallback works)
- Rate-limiting concerns
