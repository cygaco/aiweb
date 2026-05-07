# HL Stories — Compatibility Layer

The five Critical UX flows from the YC sprint plan, mapped to the compatibility model.

---

## Flow A — Business Does Not Deliver

**As a user**, I want to ask for delivery and have the agent **not call** a pickup-only restaurant, so I'm not waiting for food that won't arrive.

- Trigger: user asks for delivery; one of the candidate restaurants has `serviceType !== 'delivery'`.
- Agent behavior:
  - `start_pizza_order` returns the restaurant marked `recommended: false` and `compatibility.overall: 'no_go'` with reason "pickup_only".
  - Agent's response to user explains: *"This place is pickup-only — would you like to (a) pick another restaurant, (b) switch to pickup, or (c) keep looking?"*
  - If user picks another restaurant or asks for an alternative, the agent picks the next `go`/`caution` candidate.
  - If user picks pickup: agent acknowledges but does NOT auto-fire `place_order` for delivery. (Out of scope: a separate pickup-flow path.)
- Demo success: agent does not place a Bland call to a pickup-only restaurant.

## Flow B — Business Delivers, But Not To User

**As a user**, I want to ask for delivery and have the agent **not call** a restaurant whose delivery range doesn't cover my address.

- Trigger: `restaurant.deliveryRadius < distance(user, restaurant)`.
- Agent behavior:
  - `start_pizza_order` returns the restaurant with `compatibility.overall: 'no_go'`, reason "out_of_range", nextStep "Find a closer restaurant."
  - Agent surfaces blocker, picks an in-range alternative.
- Demo success: agent does not call a restaurant outside the user's range.

## Flow C — Business Does Not Have Requested Pizza

**As a user**, I want the agent to **not order the wrong pizza** when my requested style isn't on the menu.

- Trigger: `intent_style` doesn't match any pizza in `restaurant.menu.pizzas`.
- Agent behavior:
  - `start_pizza_order` marks `compatibility.item.state: 'not_available'` and overall `'no_go'`.
  - Agent says: *"This restaurant doesn't carry [intent]. Want me to (a) try another restaurant, or (b) substitute with one of [their actual styles]?"*
- Demo success: agent does not place an order for an item the restaurant doesn't carry.

## Flow D — Unknown Compatibility (caution path)

**As a user**, I want the agent to **be honest about what it doesn't know** instead of pretending it knows. AC8 + QA D.3 win: caution does NOT auto-block `place_order`.

- Trigger: any check returns a `caution`-bucket state (`unknown`, `requires_address`, `requires_substitution`, `likely_available`). No `no_go` checks.
- Agent behavior:
  - `compatibility.overall: 'caution'`, `nextStep` names the cheapest safe resolution.
  - The agent's natural-language reply to the user MUST include the verbatim `compatibility.nextStep` text — don't paraphrase. (Tool description, AC7 + D-2 in PRD-V2-DELTA, instructs Claude to do this.)
  - **Item caution (`item.state === 'unknown' | 'likely_available'`):** if user proceeds, `place_order` fires Bland with `itemAvailabilityUnknown: true`, which adds the ITEM-CONFIRM step to the call prompt. Restaurant confirms or substitutes on the call. **place_order does NOT auto-block.**
  - **Coverage caution (`coverage.state === 'unknown' | 'requires_address'`):** agent surfaces the unknown and asks the user for address clarification or to choose another restaurant. place_order is not auto-blocked but the agent should require user confirmation.
  - **Delivery caution (`delivery.state === 'unknown'`):** rare in practice (only when serviceType is missing on a restaurant). Agent surfaces and asks.
- Resolution priority for the agent's choice of next step: existing structured data → user clarification → targeted phone call (via Bland ITEM-CONFIRM).
- Demo success: agent never claims `available` or `in_range` without real data; agent surfaces unknowns; ITEM-CONFIRM step appears in the Bland prompt when item is unknown.

## Flow E — Successful Compatibility Path

**As a user**, when everything checks out, I want the agent to **proceed cleanly** without unnecessary friction.

- Trigger: all three checks `available` / `in_range` / `available`.
- Agent behavior:
  - `compatibility.overall: 'go'`. nextStep null. Cart flow proceeds normally; place_order fires Bland call.
- Demo success: end-to-end order completion. (For the demo, this is the test_vlad happy path.)

---

## Acceptance summary across flows

| Flow | Restaurant | userLat/Lng | intent_style | overall | place_order calls Bland? |
|---|---|---|---|---|---|
| A | pickup_only | yes | "pepperoni" | no_go | no |
| B | dominos (5mi radius), user 30mi | yes | "pepperoni" | no_go | no |
| C | test_vlad, intent="sushi" | yes | "sushi" | no_go | no |
| D | places_*, missing menu | yes | "meat_lovers" | caution | only after user accepts caution path |
| E | test_vlad, intent="pepperoni" | yes | "pepperoni" | go | yes |
