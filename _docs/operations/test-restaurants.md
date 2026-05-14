# Test restaurants — `INCLUDE_TEST_RESTAURANTS` env gate

Operational reference for the always-on-test fixtures (`Vlad's Pizza Restaurant`, `Kevin's Pizza Restaurant`) that ship inside the aiweb-pizza MCP server.

## What they are

Two hardcoded entries in `src/data/restaurants.ts` (`TEST_RESTAURANTS` array):

| ID | Name | Phone | Address | Notes |
|---|---|---|---|---|
| `test_vlad` | Vlad's Pizza Restaurant | `+14152335033` | San Francisco, CA | Real Bland.ai test endpoint — answers as staff |
| `test_kevin` | Kevin's Pizza Restaurant | `+13308198912` | Ohio, USA | Real Bland.ai test endpoint — answers as staff |

Both restaurants carry `isTest: true` so the agent can label them in conversation, and both have realistic menus, delivery radius, and `serviceType: 'delivery'`.

They exist so that any demo, test run, or pilot-customer interaction has a guaranteed-working order target — independent of Google Places coverage, Domino's API state, or address quality. The phones ring real Bland.ai numbers that answer as restaurant staff; this is what lets us close the order loop in `place_order` without contacting third parties.

## The gate

`findNearbyRestaurants()` in `src/data/restaurants.ts` reads `process.env.INCLUDE_TEST_RESTAURANTS`. Behavior:

| Value | Discovery result |
|---|---|
| unset / any value except `'false'` | live results + `TEST_RESTAURANTS` appended (default) |
| `'false'` | live results only |

**Discovery-only gate.** `getRestaurantById()` and `getRestaurantPhone()` ignore the flag — if some other part of the codebase or an in-flight session holds a `test_vlad` ID, it still resolves. The gate controls what shows up in search results, not what exists.

## When to set `=false`

- **Production deployments.** Already set in `fly.toml` (`[env]` block).
- **Pilot user testing on real addresses** where mixing fixtures into results would confuse the agent's compatibility verdict (e.g. Vlad's reports `serviceType: 'delivery'` with a 10-mile radius from SF; for a user in Oregon, that gives `coverage: out_of_range` not a misleading `caution`).
- **Any session where you want to verify the live discovery path end-to-end** without the safety net.

## When to leave it unset (or `=true`)

- Local dev (`npm run dev`) — default behavior.
- Demo recordings — guarantees a clean order can be placed.
- CI / smoke tests — fixtures are reliable, live APIs flake.

## Verification

```bash
# default — fixtures included
node -e "import('./dist/data/restaurants.js').then(m => m.findNearbyRestaurants('Riddle, OR').then(r => console.log(r.filter(x => x.isTest).map(x => x.id))))"
# → [ 'test_vlad', 'test_kevin' ]

# gated off — fixtures suppressed
INCLUDE_TEST_RESTAURANTS=false node -e "import('./dist/data/restaurants.js').then(m => m.findNearbyRestaurants('Riddle, OR').then(r => console.log(r.filter(x => x.isTest).map(x => x.id))))"
# → []
```

## Related

- `src/data/restaurants.ts` — `TEST_RESTAURANTS` definition and `findNearbyRestaurants` gate site.
- `src/connectors/bland.ts` — places the real phone calls to the test numbers.
- `_docs/operations/profiles-db-safety.md` — sibling ops doc.
