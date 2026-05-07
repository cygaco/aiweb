# YC Sprint — Menu Discovery + Delivery Generalization

> Crash-recovery doc. Resumable from any step. Live state at top.
>
> **Sprint goal:** make the pizza concierge's compatibility layer use **real evidence** for menus and delivery — not hardcoded generic templates and not Domino's-only branches. The compatibility *gate* (`src/lib/compatibility.ts`) already exists and works. This sprint enriches the *evidence* feeding into it.

---

## Live state — keep this updated

- **Mode:** adhoc (α + β + γ)
- **Branch:** `main` (post-YC-sprint head `ffc89c4`; new work lands here)
- **Phase:** Phase 9 — build complete, needs `npm install` then test run
- **Last action:** Beta built all phases: menu-discovery.ts, compatibility.ts tightened, server.ts + executor.ts wired, compatibility.test.ts updated (tests 9/14 fixed + 3 new), menu-discovery.test.ts added (7 tests).
- **Next action:** Run `npm install` then `npm test` — verify all pass. Then commit + gauntlet.

---

## Why this sprint exists (one-paragraph)

The previous sprint shipped the compatibility *gate* — three checks (delivery / coverage / item) + a combiner producing `go | caution | no_go`. The gate works: it labels Places-discovered restaurants as `places_generic_menu` evidence with low confidence, and it correctly degrades to `unknown` when delivery radius is null. But the gate is **fed garbage**: `src/connectors/places.ts:24-59` hardcodes a 3-item generic menu, and `:123,126` hardcodes `deliveryRadius: null` + `serviceType: 'unknown'` for every Places restaurant. Every non-Domino's restaurant therefore lands in `caution`, and `caution` doesn't block — so the bot makes the call anyway, with item confirmation deferred to the call itself. That's the "I don't know what they have, but I'll call them and ask mid-order" failure the user described in Claude Desktop. The fix is **upstream of the gate**: enrich the evidence (real menu via website fetch + LLM extraction; real delivery cues via same fetch) so the gate has actual ground truth to reason from. Domino's stays as a provider adapter; everything else gets a generic web-discovery adapter.

---

## Scope (the Beta-approved version goes here once Beta responds)

**In scope:**
- Stop treating `places_generic_menu` matches as `likely_available` — tighten to `unknown` (it's a template, not evidence)
- New module `src/lib/menu-discovery.ts`: website fetch + LLM extraction → real per-restaurant menu evidence with freshness metadata
- New module `src/lib/delivery-discovery.ts` (or extend menu-discovery): same fetch, parse delivery cues (radius / ZIP / "we deliver" / "pickup only")
- Lightweight cache (file-based, per-restaurant, freshness timestamps) — `runtime/menu-cache/<restaurantId>.json`
- Wire enrichment into `start_pizza_order` (server.ts) and A2A `proposed_cart` (executor.ts) — symmetric. Run only when initial `assessCompatibility` flags caution from item or coverage. Hard time cap (4s default). Fail-open: if enrichment errors or times out, keep the original caution-state assessment.
- Domino's adapter stays as-is; new module is the **non-Domino's path**, not a replacement
- Tests: extend `tests/compatibility.test.ts` (existing 18 tests stay green) — new tests for generic-template-rejected, website-extracted, enrichment-timeout, Domino's-unchanged

**Out of scope (this sprint):**
- Pre-call voice probe (the third option from N-1 backlog) — too expensive for this sprint, defer to follow-up
- Full menu DB / marketplace
- New chain connectors (Pizza Hut, Papa John's, etc.)
- Address validation through restaurant ordering flows (would need provider-specific scraping per chain)
- Tax/fees/tip handling
- Cart depth (half/whole, per-size modifier pricing)
- ISS-005 / RT-201 fix (deferred per Beta DECIDE 0.88; honest-path demo doesn't trip it)

**Non-goals (explicit):**
- No backwards-compat shims; if something needs to change in the call signature, change it
- No big refactor of compatibility.ts — extend its inputs, don't reshape its output types
- No new third-party deps unless Beta approves (we already have Anthropic SDK; that's enough for HTML→menu)

---

## Architecture (current → target)

### Current

```
start_pizza_order(address, intent, surface)
  ├── findNearbyPizzaPlaces(address)         [places.ts]
  │     └── places_<X> restaurants ship with GENERIC_PIZZA_MENU + deliveryRadius:null + serviceType:'unknown'
  ├── findDominosStores(address)              [dominos.ts]
  │     └── dominos_<X> restaurants ship with real menu + lat/lng=0/0 + serviceType:'delivery'
  └── for each restaurant: assessCompatibility(...) → go|caution|no_go
        ├── delivery: dominos.serviceType='delivery' → 'available'; places.serviceType='unknown' → 'unknown'
        ├── coverage: dominos lat/lng=0/0 → 'unknown'; places deliveryRadius=null → 'unknown'
        └── item: places matches generic 3-item menu → 'likely_available' (FALSE CONFIDENCE)
```

### Target

```
start_pizza_order(address, intent, surface)
  ├── findNearbyPizzaPlaces(address)         [unchanged — still emits generic menu]
  ├── findDominosStores(address)              [unchanged — provider adapter]
  ├── for each restaurant: assessCompatibility(...) → initial verdict
  └── if initial verdict is caution due to item-unknown OR coverage-unknown:
        └── enrichEvidence(restaurant, intent)        [NEW: menu-discovery.ts]
              ├── checkCache(restaurantId) → fresh? use it
              ├── fetch restaurant.website (cap 3s)
              ├── extract menu + delivery cues via Claude (cap 4s total)
              ├── write cache with discoveredAt timestamp
              └── return enriched restaurant (real menu, real delivery cues)
        └── re-run assessCompatibility(enrichedRestaurant, ...) → final verdict
```

The compatibility gate (`compatibility.ts`) only changes in one place: the item-availability check needs to know whether menu evidence is "real" (from discovery) vs "generic template" — so generic-template never produces `likely_available`. Everything else stays intact.

---

## Phases — this is the implementation order

| # | Phase | Status | Files |
|---|---|---|---|
| 1 | Beta framing approval | done | (Beta DECIDE table above) |
| 2 | Crash-recovery doc | done | yc-menu-delivery-compatibility.md |
| 3 | Spawn persistent Beta + Gamma teammates | done | aiweb-yc-sprint team |
| 4 | warp:flag stale-team behavior | done | warpos-to-update.md |
| 5 | PRD + STORIES (REQ-* IDs + ### GS-MENU-DEL-NN) | done | _requirements/04-features/menu-delivery-discovery/ |
| 6 | Dispatch Gamma → builder gauntlet | in_progress | (Gamma owns from here through phase 11) |
| 7 | Builder: 14 granular stories per STORIES.md | pending | src/lib/menu-discovery.ts + 5 wire-in files + 2 test files |
| 8 | Reviewer + compliance + QA gauntlet | pending | (Gamma orchestrates via Bash subprocess) |
| 9 | Fix loop | pending | (Gamma → Fixer) |
| 10 | Smoke test (manual) | pending | npm run build + npm test + npm run dev |
| 11 | Merge to main + commit | pending | git |
| 12 | Export + yc-application.md update | pending | yc-export-menu-delivery.md, yc-application.md |
| 13 | /learn:deep + /learn:integrate | pending | learnings store |

---

## Recovery instructions (if session crashes)

1. Reopen Claude Code in this directory.
2. Read this file (`yc-menu-delivery-compatibility.md`) — live state at top.
3. Read `issues.md` for any new bugs since this doc was last updated.
4. `git status && git log --oneline -10` — see what's committed.
5. Mode is adhoc; if drifted, run `node scripts/mode-set.js adhoc --by alpha`.
6. Resume from the first `pending` row in the Phases table.

---

## Beta decisions (2026-05-07, all DECIDE, no escalations)

| Q | Verdict | Conf | Rationale |
|---|---|---|---|
| 1 Strategy | Hybrid live+cache+freshness | 0.87 | Cache-only kills first-time restaurants |
| 2 Generic-template label flip | `likely_available` → `unknown` | 0.88 | Template is not evidence; caution-path break is the point |
| 3 Module count | One `menu-discovery.ts` for both menu + delivery cues | 0.91 | Same fetch, splitting doubles cost |
| 4 Time budget | Enrich top-1 only, config flag `ENRICH_COUNT` | 0.83 | 20s parallel is demo-killer; 4s top-1 is OK |
| 5 Failure mode | Fail-open — original caution stands | 0.93 | Enrichment is additive, not a gate |
| 6 Connector interface | Defer to N+1 | 0.86 | Premature abstraction before two impls |
| 7 Tests | Extend compat + add menu-discovery, mock fetch+Claude | 0.92 | Standard boundary |
| 8 Demo framing | Show fetch→parse→`available` with `source: 'restaurant_website'` | 0.85 | Inference→evidence IS the YC story |

No `OPEN_ADR` flags. All reversible. Gamma proceeds with this scope.

---

## Issues raised in this sprint

_(empty — open issues live in `issues.md` at project root)_
