# YC Sprint Roadmap — Pizza Concierge Compatibility Layer

> **CRASH-RECOVERY DOC.** Read this first if you reopen in a new Claude session. Everything you need to resume is here. Updated continuously this sprint.

**Sprint owner:** Vlad Zhirnov (founder)
**Started:** 2026-05-06
**Branch:** `main`
**Mode:** adhoc (Alex α + β + γ)
**Approval policy:** blanket approval for normal local actions; pause only for money/external/destructive
**Constraint flags:** low-RAM laptop has crashed 2x; 3-strike fix cap; 70%-context pause

---

## Current Objective

Build a **compatibility layer** in front of the existing pizza ordering flow so the agent never blindly attempts a delivery order it cannot fulfill.

The agent must answer three questions before it places a call:

1. **Does this restaurant deliver?**
2. **Does it deliver to the user's address?**
3. **Does it have what the user asked for?**

When any answer is NO or UNKNOWN, the agent must explain the blocker, propose a safe next step, and refuse to call the restaurant — instead of hallucinating a delivery and failing on-call.

This is the YC wedge. A compatibility-and-trust layer for agentic commerce, demoed in pizza, generalizes to plumbers / CPAs / paralegals / boutique consultants — the long-tail SMB layer no foundation-model app store currently covers.

---

## Scope (this sprint)

### IN scope

- New `src/lib/compatibility.ts` module with three checks:
  - `checkDeliveryAvailability(restaurant)` → state + confidence + source + reason
  - `checkDeliveryCoverage(restaurant, userAddress)` → state + confidence + source + reason
  - `checkItemAvailability(restaurant, intent_style)` → state + confidence + source + reason
- A combined `assessCompatibility(restaurant, userAddress, intent_style)` returning the three checks plus an overall verdict + next-step recommendation.
- Wire compatibility output into `start_pizza_order` so:
  - Each restaurant in the response carries `compatibility: { delivery, coverage, item, overall, next_step }`
  - Restaurants known-incompatible (delivery=no, coverage=out_of_range, OR item=not_available with no acceptable substitution) are de-emphasized or filtered with explanation
- Wire a hard-block in `place_order` so an order with `overall=no_go` is refused unless caller passes explicit `override_compatibility: true`.
- Update tool descriptions so the LLM is told what to do with each compatibility state.
- Update `bland.ts` voice prompt to ask the restaurant to confirm any item-level UNKNOWN ("Do you carry meat lovers?") only when it can resolve uncertainty.
- Logging: emit a `compatibility` event for every check so traces survive the call.

### Demo success criteria

The agent successfully runs all five Critical UX scenarios (Flows A-E in the sprint plan) end to end:

- A. Restaurant doesn't deliver — agent doesn't call, explains, offers pickup or alt.
- B. Delivers but not to user — agent doesn't call, explains, offers alt.
- C. No matching pizza — agent asks substitution, doesn't call wrong order.
- D. Unknown — agent surfaces unknown, picks cheapest safe resolution path.
- E. Successful path — agent confirms compatibility, places order or returns ready-to-order summary.

### NON-goals (this sprint)

- Restaurant onboarding marketplace
- General agentic-economy infrastructure
- Full payment flow
- Trust/reputation system
- Real-time price negotiation
- Voice-side menu extraction (extract menus from call transcripts)
- Multi-restaurant comparison shopping
- Address geocoding accuracy improvements (use existing places.ts)
- Domino's MaxDistance vs in-range calc precision (existing logic adequate)
- Profile-stored compatibility preferences (e.g., "always allow pickup")

---

## Phases & Checklist

### Phase 0: Setup (DONE)

- [x] /mode:adhoc — team initialized
- [x] /beta:mine + /beta:integrate — 7 patterns, 4 anti-patterns added; demo-ergonomics confidence raised to 0.92
- [x] YC calibration websearch — earnestness > polish, "discovery from technology" matters
- [x] Phase 1 flow mapping — current architecture understood
- [x] roadmap-yc.md written (this file)
- [x] issues.md scaffold

### Phase 1: Requirements (IN PROGRESS)

- [ ] PRD at `_requirements/04-features/compatibility-layer/PRD.md`
- [ ] HL stories at `_requirements/04-features/compatibility-layer/HL-STORIES.md`
- [ ] Granular stories at `_requirements/04-features/compatibility-layer/STORIES.md`
- [ ] Compatibility state model spec
- [ ] QA checklist (5 flows)
- [ ] Red-team checklist (relevant ordering risks)
- [ ] Demo script

### Phase 2-4: Implementation

- [ ] `src/lib/compatibility.ts` — three checks + assess + types
- [ ] `src/lib/compatibility.test.ts` — unit tests
- [ ] Update `src/data/restaurants.ts` Restaurant interface (add optional explicit `deliversTo?`, `serviceType?`)
- [ ] Update `src/connectors/places.ts` to emit `serviceType: 'unknown'` instead of fabricating delivery
- [ ] Update `src/connectors/dominos.ts` to emit `serviceType: 'delivery'` from real data
- [ ] Update `src/server.ts` `start_pizza_order` handler — embed compatibility in response, filter or annotate
- [ ] Update `src/server.ts` `place_order` handler — block on `overall=no_go` unless override
- [ ] Update tool descriptions — entry-point reasoning includes compatibility states
- [ ] Update `bland.ts` to surface item UNKNOWN as confirmation question on call

### Phase 5: First export (BEFORE risky QA)

- [ ] /export → `yc-export.md`

### Phase 6: Focused QA + red-team

- [ ] QA: five compatibility flows only
- [ ] Red-team: ordering risks only (wrong item, hallucinated coverage, infinite loop, unsafe assumptions, unnecessary user data on call)

### Phase 7: Reviewer + fix

- [ ] Reviewer agent on changed files
- [ ] Fix agent on findings
- [ ] /fix:deep on stubborn bugs
- [ ] All bugs logged in `issues.md` with full schema; 3-strike cap enforced

### Phase 8: Final export + YC notes

- [ ] /export → `yc-export-2.md`
- [ ] Update `yc-application.md` (built/why/errors/tradeoffs/risks/demo/next)

### Phase 9: Learning

- [ ] /learn:deep
- [ ] /learn:integrate

---

## Recovery Instructions

**If this session crashes:**

1. Reopen Claude Code in this directory.
2. The SessionStart hook will load the previous handoff automatically.
3. Read this file (`roadmap-yc.md`) end to end.
4. Read `issues.md` to see open bugs and any abandoned/deferred items.
5. Run `git status && git log --oneline -10` to see what's committed.
6. Run `node scripts/mode-set.js adhoc --by alpha` to re-enter adhoc mode (skip if already there).
7. Re-spawn Beta and Gamma teammates if they aren't running.
8. Resume from the first unchecked item in **Phases & Checklist** above.
9. Do NOT re-run `/beta:mine` or `/beta:integrate` — those completed earlier.
10. Do NOT re-derive the compatibility model — it's specified above and in the PRD (when written).

**If the user reopens fresh and asks to resume:**

- Point them at this file.
- Confirm which phase you're on by checking the checklist.
- If implementation files exist (`src/lib/compatibility.ts`), tests, and PRD are written, you are in Phase 4 or later.

---

## Current State (live — keep this updated)

- **Phase:** 1 — requirements
- **Last action:** wrote roadmap-yc.md
- **Next action:** dispatch Gamma to write PRD + HL stories + granular stories for the compatibility-layer feature
- **Open issues:** see issues.md
- **Tests passing:** unverified (no compatibility tests exist yet)
- **Build green:** unverified (no recent build)

---

## Known Risks

1. **Places API restaurants ship with fabricated `deliveryRadius`.** Existing `places.ts:136` does `Math.max(5, Math.ceil(distMi * 1.5))` which is not real data. If we keep using it as ground truth, coverage checks lie. Mitigation: emit `coverage: unknown, source: heuristic_distance` for places-derived restaurants and surface the uncertainty in the response.
2. **Generic Places menu has only 3 hardcoded items.** Item availability for any other intent_style is genuinely UNKNOWN; we cannot answer YES from Places data. Mitigation: model UNKNOWN honestly; let Bland confirm on the call.
3. **Domino's API filters by delivery already** in `dominos.ts:92-97` — but only returns delivery-capable stores. So items in our restaurant list from Domino's never have delivery=NO as a real failure mode. The realistic NO comes from Places. Mitigation: ensure compatibility logic still runs on Domino's results to keep signals consistent.
4. **Token-binding could break if compatibility data is added to confirmation_token payload.** `confirmation-token.ts:13` binds delivery_address, instructions, customer fields. Adding compatibility fields to the binding would cause token-mismatch on resubmission. Mitigation: do NOT bind compatibility into the token. It's a pre-call gate, not part of the order contract.
5. **Demo-environment fragility.** Vlad is testing from a parking lot with bandwidth/laptop-RAM constraints. If real Places API returns slow/empty for the parking-lot address, demo could fail on discovery before compatibility even runs. Mitigation: ensure test_vlad fixture stays in results regardless of address (already true per `restaurants.ts:54`).
6. **3-strike fix-cap might be hit on infinite-call-loop bug.** The decision logic could oscillate between "call to confirm UNKNOWN" and "UNKNOWN remains after call." Mitigation: cap retries explicitly inside compatibility decision logic, log Abandoned to issues.md if breached.

---

## Commands Run This Sprint

- `node scripts/mode-set.js adhoc --by alpha` — entered adhoc mode
- (more appended as session progresses)

## Files Touched This Sprint

- `.claude/agents/00-alex/.system/beta/judgement-model.md` — 6 new patterns, 4 anti-patterns, 5 new confidence rows, 1 row upgraded
- `.claude/agents/00-alex/.system/beta/judgement-model-recommendations.md` — staged + cleared
- `.claude/agents/00-alex/.system/beta/judgement-model-recommendations-archive.md` — appended 2026-05-06 cycle
- `roadmap-yc.md` — created (this file)
- `issues.md` — created
- (more appended as session progresses)

## Tests To Run

When implementation lands:

1. `npm run build` — TypeScript compilation passes.
2. `npm test` (if defined) — unit suite for `src/lib/compatibility.test.ts`.
3. Manual: send all 5 demo flows through MCP locally; verify each prints expected compatibility state and either calls or refuses appropriately.
4. A2A test panel: send same 5 flows via A2A, verify state transitions match.

## Export Instructions

- After Phase 5: `/export` → save to `yc-export.md` at project root.
- After Phase 8: `/export` → save to `yc-export-2.md` at project root.
- Both files committed.

## Next-Step Instructions for a New Session

If you are reading this in a new session:

1. Confirm you're Alpha in adhoc mode. If not, run `/mode:adhoc`.
2. Read this file and `issues.md`.
3. Find the first unchecked item under **Phases & Checklist**.
4. Dispatch Gamma if it's a build task; do it directly if it's a write/research task.
5. Update **Current State** before each major action — that's the crash anchor.
6. Update **Files Touched** as you go.
7. Update **Phases & Checklist** by checking boxes when done.
