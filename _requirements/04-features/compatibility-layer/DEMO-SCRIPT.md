# Demo Script — Compatibility Layer

The 90-second YC demo walkthrough. Runnable end-to-end against `test_vlad` fixture so it never depends on real Places API at demo time.

---

## Pre-demo setup

1. Ensure local server up on `:3001`.
2. Confirm `test_vlad` fixture is in `restaurants.ts` and serviceType=delivery.
3. Have the A2A test panel open at `https://aiweb-mcp.fly.dev` with bearer token + agent card pre-loaded.
4. Have `ROADMAP.md`, `issues.md`, and `yc-export.md` open in a side window for show-and-tell.

---

## Live walkthrough

### Beat 1 — Setup the failure (10s)

> "Last week I tried to order pizza through this agent and it called a market that doesn't deliver. Then it tried to order from a place that delivered, but not to me. Then it ordered from a place that didn't have what I wanted. Three real failures, all the same root cause: the agent didn't check compatibility before committing."

### Beat 2 — Show the wedge (15s)

> "What I built is a compatibility layer. Three checks before any call: does this place deliver, do they deliver to me, do they have what I want. Each check has a confidence and a source. When a check fails, the agent doesn't pick up the phone."

Open `ROADMAP.md`, scroll to "Current Objective" and "Compatibility Questions" sections.

### Beat 3 — Run flow E (success) (20s)

In Claude Desktop:

> "Order me a meat lovers pizza, delivery to 1 Market St, San Francisco, CA 94105, name Vlad, phone +14152335033."

**Address note:** Use a SF-area demo address — test_vlad fixture coordinates are (37.7749, -122.4194) with `deliveryRadius: 10`. The Riddle, OR address (~600 mi from SF) would fail coverage on test_vlad. For the live demo, use 1 Market St (~0.5 mi from test_vlad center) so Flow E succeeds. The Riddle, OR address can be saved in the user's actual profile but is NOT the demo address.

Agent:
- Calls `start_pizza_order` (intent=meat_lovers, address)
- Returns `test_vlad` with `compatibility.overall: 'go'`
- Builds cart, prepares_order, place_order
- Bland dispatches; on the call, restaurant confirms order

### Beat 4 — Run flow A (no-deliver) (15s)

> "Now order from somewhere I know is pickup-only."

Agent receives the `test_pickup_only` fixture (Slice Box, Mission St, SF — added in PRD-V2-DELTA M-8); surfaces the blocker.

> "This place is pickup-only — would you like pickup, or another restaurant?"

### Beat 5 — Run flow C (wrong item) (15s)

> "Order me sushi from Vlad's Pizza."

Agent:
- start_pizza_order with intent=sushi
- compatibility.item.state = not_available
- Refuses to call. Suggests substitution.

### Beat 6 — Show the YC hook (15s)

> "The pizza concierge is a wedge. The compatibility layer generalizes to plumbers, CPAs, paralegals, boutique consultants — long-tail SMBs not covered by Shopify Agentic Storefronts or any foundation-model app store. We're building protocol-agnostic discovery, compatibility, and trust for the supply-side agentic economy. Pizza is just the proof."

---

## Rollback / fallback if anything fails live

| If | Then |
|---|---|
| Bland call fails | Show the events log with `EVT-compatibility` rows — proves the flow ran even if voice didn't |
| A2A panel times out | Switch to Claude Desktop (same tools) |
| Geocoding API fails | test_vlad fixture is hardcoded with lat/lng; fallback works |
| Server crashes | restart `npm run dev` and resume |
| Unknown 500 | Show issues.md — bug tracking story is itself a YC moment ("we ship under constraint") |

---

## Test commands (for self-rehearsal)

```bash
# Server up
npm run dev &

# Manual smoke
curl -X POST http://localhost:3001/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"method": "tools/call", "params": {"name": "start_pizza_order", "arguments": {"delivery_address": "5208 Riddle Bypass Rd, Riddle, OR 97469", "intent_style": "meat_lovers"}}}'

# Inspect compatibility in response
# Verify: response.restaurants[0].compatibility.overall === "go"
```

---

## What the audience sees

1. The agent refuses to call a restaurant when it doesn't make sense to call.
2. The agent explains why.
3. The agent picks an alternative or asks the user how to proceed.
4. When everything checks out, the call goes through and the order completes.
5. The state model is explicit: every refusal has a reason, source, confidence.

That is the YC story.
