# YC Sprint — Menu Discovery + Delivery Generalization

> Crash-recovery doc. Resumable from any step. Live state at top.
>
> **Sprint goal:** make the pizza concierge's compatibility layer use **real evidence** for menus and delivery — not hardcoded generic templates and not Domino's-only branches. The compatibility *gate* (`src/lib/compatibility.ts`) already exists and works. This sprint enriches the *evidence* feeding into it.

---

## Live state — keep this updated

- **Mode:** adhoc (α + β + γ)
- **Branch:** `feat/menu-discovery` @ `2001634` — 2 commits ahead of `main` (`e0cae07`)
- **Phase:** Phase 8 — gauntlet in flight against HEAD `2001634`
- **Tests:** 119/119 pass | **Build:** clean | **npm install:** done (Anthropic SDK installed)
- **Last action:** Gamma dispatched fresh 3-gate gauntlet (reviewer + compliance + qa via openai/codex) against HEAD `2001634`. Outputs at `.claude/runtime/dispatch/menu-delivery-discovery-{reviewer,compliance,qa}-output.json` (currently 0-byte, in flight). Beta was overstepping role — issued a stop directive; Beta is now idle.
- **Next action:** Wait for Gamma's GAMMA_RESULT envelope. If gauntlet passes: I run final smoke test (manual `npm run dev`), regenerate `yc-export-menu-delivery.md` (using Beta's `yc-export-sprint.md` as draft), update `yc-application.md`, run /learn:deep + /learn:integrate, then ASK USER for permission to merge feat/menu-discovery → main + push. If gauntlet fails: Gamma dispatches fixer with unified fix-brief on `feat/menu-discovery` (NOT on `feat/menu-discovery-foundation @ c41d973` which is a checkpoint tag).
- **Branch reconciliation:** Two parallel branches share `c41d973` as parent: (a) `feat/menu-discovery-foundation @ c41d973` (Gamma's foundation tag, keep as checkpoint, don't merge); (b) `feat/menu-discovery @ 2001634` (Alpha's superset — adds `menuSource` field + explicit `dominos_*` skip + PRD/STORIES + recovery doc). Merge candidate is the latter.
- **Salvage:** Beta's `yc-export-sprint.md` (144 lines) has decent YC-narrative content; will use as draft for `yc-export-menu-delivery.md` post-merge. Was written without authorization — Beta's role is judgment-only — but the content is reusable.

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
| 6 | Dispatch Gamma → builder gauntlet | done | gauntlet in flight |
| 7 | Builder: foundation work (from crashed session, recovered + verified) | done | committed at c41d973 + my menuSource/Domino's fix at 2001634 |
| 8 | Reviewer + compliance + QA gauntlet | in_progress | reviewer + compliance + qa via openai (skipping redteam ISS-003 + req-reviewer); ~5-12 min |
| 9 | Fix loop (if gauntlet flags HIGH/CRITICAL) | pending | Gamma → Fixer on feat/menu-discovery (NOT feat/menu-discovery-foundation) |
| 10 | Smoke test (manual) | pending | npm run dev → invoke start_pizza_order with SF address + pepperoni intent → confirm enrichment block + cache file appears |
| 11 | Merge to main + commit | pending | requires user approval to push |
| 12 | Regenerate yc-export-menu-delivery.md (Beta's draft is salvageable) + update yc-application.md | pending | uses Beta's `yc-export-sprint.md` as starting draft |
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
