# Compatibility State Model

Internal data model for the compatibility layer. Single source of truth referenced by `compatibility.ts`, the test suite, the QA checklist, and the demo script.

---

## Three checks

Each check returns a `CompatibilityCheckResult<S>`:

```ts
{
  state: S,             // enum specific to the check
  confidence: number,   // 0..1
  source: string,       // tag identifying where the data came from
  reason: string,       // human-readable explanation
  nextStep: string | null  // resolution recommendation if state is uncertain or failing
}
```

### Check 1 — Delivery Availability

**Question:** *Can this business deliver at all?*

| state | meaning | when to emit |
|---|---|---|
| `available` | yes, the restaurant delivers | `restaurant.serviceType === 'delivery'` |
| `pickup_only` | the restaurant exists, doesn't deliver | `restaurant.serviceType === 'pickup_only'` |
| `third_party_only` | only via DoorDash/UberEats etc. | `restaurant.serviceType === 'third_party_only'` |
| `unknown` | we have no signal | no serviceType field OR serviceType=='unknown' |
| `no` | known not to deliver (reserved; not currently emitted) | future: explicit non-delivery flag |

**Confidence guide:**
- `available`/`pickup_only`/`third_party_only` from real fields → 0.95
- `unknown` from places_api → 0.4
- Test fixtures → 0.95

**Source tags:** `restaurant.fields`, `dominos_api`, `places_api`, `test_fixture`

### Check 2 — Delivery Coverage

**Question:** *Can it deliver to the user's address?*

| state | meaning | when to emit |
|---|---|---|
| `in_range` | yes, the user is inside the delivery radius | distance ≤ radius (real data) |
| `out_of_range` | the user is outside the radius | distance > radius (real data) |
| `unknown` | radius is fabricated/missing OR user lat/lng missing | deliveryRadius is null OR source is unreliable |
| `requires_address` | we don't have a user address | userLat/userLng undefined |

**Confidence guide:**
- `in_range`/`out_of_range` from Domino's MaxDistance or test fixture → 0.9
- `unknown` from places_api → 0.4 (radius was previously fabricated)
- `requires_address` → 0.3

**Source tags:** `dominos_api`, `places_api`, `test_fixture`, `none`

### Check 3 — Item Availability

**Question:** *Does the business have what the user wants?*

| state | meaning | when to emit |
|---|---|---|
| `available` | exact menu match for the requested style | normalize-equal in real menu |
| `likely_available` | match in generic Places menu (incomplete data) | match in 3-item generic menu |
| `not_available` | no match in a real menu | exhaustive menu, no match |
| `unknown` | menu is incomplete; we can't be sure | places_api restaurant + miss in generic menu |
| `requires_substitution` | reserved — match by intent class but different name | future: "Hawaiian → tropical" mapping |

**Confidence guide:**
- `available` from real menu (test/dominos) → 0.95
- `available` from fuzzy match → 0.8
- `not_available` from real menu → 0.85
- `likely_available` from generic Places menu → 0.6
- `unknown` from places_api miss → 0.4

**Source tags:** `menu_match`, `dominos_api_menu`, `test_fixture_menu`, `places_generic_menu`, `none`

---

## Combined verdict

`assessCompatibility` returns:

```ts
{
  delivery: CompatibilityCheckResult<DeliveryAvailabilityState>,
  coverage: CompatibilityCheckResult<DeliveryCoverageState>,
  item: CompatibilityCheckResult<ItemAvailabilityState>,
  overall: 'go' | 'caution' | 'no_go',
  nextStep: string | null,
}
```

### Verdict rules

| Combination | overall | nextStep |
|---|---|---|
| All three checks state ∈ `{available, in_range}` | **go** | `null` |
| Any check ∈ `{pickup_only, third_party_only, no, out_of_range, not_available}` | **no_go** | nextStep of the FIRST failing check |
| Any check ∈ `{unknown, requires_address, requires_substitution, likely_available}` AND no no_go | **caution** | nextStep of the LOWEST-confidence check |

**Tiebreakers:**
- Multiple no_go states → first failing check wins (delivery > coverage > item check order)
- Multiple unknowns → lowest-confidence one drives the next step

### State → Decision mapping (for the agent)

| Overall | Agent should… |
|---|---|
| `go` | Proceed to cart-flow. Place call when user confirms. |
| `caution` | Surface the unknown to the user. Resolve via cheapest safe option (existing data > user clarification > targeted call). The "next-step" string tells the agent which path. |
| `no_go` | Do NOT call. Explain blocker. Find a `go`/`caution` alternative or ask user how to proceed (pickup, different restaurant, different intent). |

---

## Example assessments

### Example A — Vlad's Pizza, user 5 mi away, intent "meat_lovers"

```json
{
  "delivery": { "state": "available", "confidence": 0.95, "source": "test_fixture", "reason": "Vlad's Pizza serviceType=delivery", "nextStep": null },
  "coverage": { "state": "in_range", "confidence": 0.9, "source": "test_fixture", "reason": "5.0 mi <= 10 mi radius", "nextStep": null },
  "item": { "state": "available", "confidence": 0.95, "source": "menu_match", "reason": "Meat Lovers in restaurant menu", "nextStep": null },
  "overall": "go",
  "nextStep": null
}
```

### Example B — Places restaurant, user 8 mi away, intent "meat_lovers"

```json
{
  "delivery": { "state": "unknown", "confidence": 0.4, "source": "places_api", "reason": "Places API does not signal delivery capability", "nextStep": "Ask user about pickup, or call to confirm." },
  "coverage": { "state": "unknown", "confidence": 0.4, "source": "places_api", "reason": "Delivery radius unknown for Places-discovered restaurant", "nextStep": "Confirm coverage on call." },
  "item": { "state": "unknown", "confidence": 0.4, "source": "places_generic_menu", "reason": "Meat Lovers not in generic 3-item menu; real menu unknown", "nextStep": "Confirm on call: 'Do you carry Meat Lovers?'" },
  "overall": "caution",
  "nextStep": "Ask user about pickup, or call to confirm."
}
```

### Example C — Domino's, user 30 mi away (radius 5), intent "pepperoni"

```json
{
  "delivery": { "state": "available", "confidence": 0.95, "source": "dominos_api", "reason": "AllowDeliveryOrders=true", "nextStep": null },
  "coverage": { "state": "out_of_range", "confidence": 0.9, "source": "dominos_api", "reason": "30.0 mi > 5 mi MaxDistance", "nextStep": "Find a closer restaurant." },
  "item": { "state": "available", "confidence": 0.95, "source": "dominos_api_menu", "reason": "Pepperoni in standard menu", "nextStep": null },
  "overall": "no_go",
  "nextStep": "Find a closer restaurant."
}
```

### Example D — test_vlad, user with no coordinates, intent ""

```json
{
  "delivery": { "state": "available", "confidence": 0.95, "source": "test_fixture", "reason": "...", "nextStep": null },
  "coverage": { "state": "requires_address", "confidence": 0.3, "source": "none", "reason": "No userLat/userLng provided", "nextStep": "Confirm user delivery address." },
  "item": { "state": "unknown", "confidence": 0.5, "source": "none", "reason": "No intent_style provided", "nextStep": "Ask user what they want." },
  "overall": "caution",
  "nextStep": "Confirm user delivery address."
}
```

---

## Logging contract

Every call to `assessCompatibility` emits an event:

```json
{
  "cat": "compatibility",
  "actor": "alex",
  "data": {
    "restaurant_id": "test_vlad",
    "intent_style": "meat_lovers",
    "delivery": { "state": "...", "confidence": 0.95, "source": "..." },
    "coverage": { "state": "...", "confidence": 0.9, "source": "..." },
    "item": { "state": "...", "confidence": 0.95, "source": "..." },
    "overall": "go"
  }
}
```

Override events when `place_order` bypasses a `no_go`:

```json
{
  "cat": "compatibility-override",
  "actor": "alex",
  "data": {
    "restaurant_id": "places_xyz",
    "block_reason": "out_of_range",
    "user_intent": "..."
  }
}
```

---

## Out-of-scope states (reserved, not implemented this sprint)

- `requires_call` — explicit "we'd need to call the restaurant to learn this." Currently subsumed by `unknown` + nextStep.
- `depends_on_order_size` — delivery available but only for orders > $X. Future, requires per-restaurant fee modeling.
- `requires_substitution` — "we have something close, but not exact." Future, needs a substitution graph.
- A confidence-decay function based on data age — Places menus are stale; should down-weight over time. Future.
