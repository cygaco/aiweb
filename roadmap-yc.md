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

### Phase 1: Requirements (DONE)

- [x] PRD at `_requirements/04-features/compatibility-layer/PRD.md` (12 AC + REQ-* registry block)
- [x] HL stories at `_requirements/04-features/compatibility-layer/HL-STORIES.md`
- [x] Granular stories at `_requirements/04-features/compatibility-layer/STORIES.md` (renamed S-* → GS-COMPAT-01..15)
- [x] Compatibility state model spec at COMPATIBILITY-MODEL.md
- [x] QA checklist (5 flows) at QA-CHECKLIST.md
- [x] Red-team checklist (relevant ordering risks) at REDTEAM-CHECKLIST.md
- [x] Demo script at DEMO-SCRIPT.md
- [x] PRD-V2-DELTA.md (caught + fixed 4 critical + 8 major + minor spec defects pre-build)

### Phase 2-4: Implementation (DONE)

- [x] `src/lib/compatibility.ts` — three checks + assess + types (commits 05ab8c0, ab77b28)
- [x] `tests/compatibility.test.ts` — 18 unit tests (commit ab77b28 + 4c7dcb9 regression)
- [x] `src/data/restaurants.ts` — Restaurant gains `serviceType?`, `deliveryRadius:number|null`, +`test_pickup_only` fixture (05ab8c0)
- [x] `src/connectors/places.ts` — `serviceType:'unknown'` + null radius (05ab8c0)
- [x] `src/connectors/dominos.ts` — `serviceType:'delivery'` + lat/lng=0 code comment (05ab8c0)
- [x] `src/server.ts` start_pizza_order — embed compatibility, sort, recommended flag, BEFORE PROCEEDING tool description (4787381)
- [x] `src/server.ts` place_order — block on no_go, override flag, second-pass assess, cache-miss fail-closed (4787381 + a59e34c)
- [x] `src/connectors/bland.ts` — ITEM-CONFIRM block when itemAvailabilityUnknown (4787381 + a59e34c likely_available trigger)
- [x] `src/a2a/executor.ts` — proposed_cart artifact carries compatibility (4787381)
- [x] New: `src/lib/event-log.ts`, `src/lib/geo.ts`

### Phase 5: First export (BEFORE risky QA)

- [ ] User runs `/export` → save to `yc-export.md`. (Conversation captured by Claude Code's built-in /export — not a WarpOS skill.)

### Phase 6: Focused QA + red-team (DONE — covered by gauntlet)

- [x] QA: gpt-5.5-mini caught snake_case bug (fixed in 4c7dcb9 + regression test)
- [x] Reviewer: gpt-5.5/codex pass-after-fix (a59e34c)
- [x] Compliance: gpt-5.5/codex pass-after-fix (a59e34c)
- [x] Redteam: infra_blocked (ISS-003 gemini model id) — non-blocking, deferred

### Phase 7: Reviewer + fix (DONE — gauntlet handled it)

- [x] Reviewer agent on changed files (codex)
- [x] Fix agent on findings (Gamma applied fixes inline: 4c7dcb9, a59e34c)
- [x] All bugs logged in `issues.md` with full schema; 3-strike cap enforced

### Phase 8: Final export + YC notes

- [ ] User runs `/export` → save to `yc-export-2.md`
- [x] Update `yc-application.md` (built/why/errors/tradeoffs/risks/demo/next) — Session 2026-05-06 entry written; needs final-build-outcome update before /export-2

### Phase 9: Learning

- [ ] /learn:deep — partial (3 learnings logged for the agent-death failure class)
- [ ] /learn:integrate — pending

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

- **Phase:** 5 done (yc-export-01.md saved by user). Phases 6 + 7 done via gauntlet. **Sprint at wrap.** Phase 8 (final /export) + Phase 9 (/learn:deep + /learn:integrate) remaining.
- **Last action:** Redteam retry via openai/gpt-5.4-mini returned PASS-with-warn (1 HIGH, 0 CRITICAL). Gauntlet 4/4 closeable. Committed `1ae13c7`.
- **Next action:** User runs human verification check on the demo (designed in §"Human verification test" below), then final `/export` → `yc-export-2.md`.
- **Open issues:**
  - ISS-001 (keyless geocoding caution) — Deferred, non-blocking
  - ISS-002 (codex cold-start race) — Open, tooling
  - ISS-003 (gemini free-tier limit:0) — Deferred, account
  - ISS-004 (graph format) — Fixed `8bc7ae5`
  - **ISS-005 (RT-201 wrong-item bypass via unbound intent_style)** — **Deferred per Beta DECIDE 0.88 + user agreement**. First work post-application. Option-b fix path documented (~30 LOC across server.ts + executor.ts, derive compatibility from cart contents).
- **Tests passing:** 105/105 (88 pre-existing + 17 new + 1 regression added by Gamma in fix commit `4c7dcb9`).
- **Build green:** YES — `npm run build` clean on main as of `3077fb3` and follow-up commits.
- **Gauntlet 4/4:**
  - reviewer (gpt-5.5/codex): pass-after-fix (`a59e34c`)
  - compliance (gpt-5.5/codex): pass-after-fix (`a59e34c`)
  - qa (gpt-5.5-mini/codex): pass-after-fix (`4c7dcb9`)
  - redteam (gpt-5.4-mini/codex, re-routed from gemini): pass-with-warn (1 HIGH = ISS-005, deferred)
- **MCP + A2A coverage:** confirmed symmetric. Both surfaces import `assessCompatibility`, both gate `place_order` on `no_go` with `override_compatibility` opt-in, both surface compatibility in their respective output (MCP response per-restaurant; A2A `proposed_cart` artifact). ITEM-CONFIRM in Bland prompt fires identically for both surfaces. Tool description on MCP side instructs the LLM to reproduce `compatibility.nextStep` verbatim.
- **Branch state:** main = `1ae13c7`. feat/compatibility-layer merged (no longer the source of truth). Worktree at `.worktrees/wt-compatibility-layer` can be cleaned up post-sprint.

---

## Human verification test (Phase 6 manual smoke)

Goal: prove the compatibility layer works end-to-end on real surfaces, with one positive flow and three blocker flows.

### Pre-flight (60 sec)

1. `npm run build` — should exit 0 clean. (Already verified on main.)
2. `npm test` — should print "tests 105 / pass 105 / fail 0". (Already verified.)
3. Confirm `runtime/events.jsonl` exists OR the runtime dir is writable (it's created on first compatibility event).
4. Server: `npm run dev` (or whatever the local-MCP launcher is) — should bind on the configured port.

### Test plan — 5 flows × 2 surfaces (10 cases)

The two surfaces are **MCP** (Claude Desktop or `mcp-remote` bridge) and **A2A** (the test panel at https://aiweb-mcp.fly.dev). Run each flow on both surfaces. Each should produce the expected verdict in the response artifact AND match the expected behavior on `place_order`.

| # | Flow | Address + intent | Expected `compatibility.overall` | place_order behavior | Notes |
|---|---|---|---|---|---|
| 1 | E (success path) | `1 Market St, San Francisco, CA 94105` + `meat_lovers` | `go` on `test_vlad` | dispatches Bland call cleanly | Demo Beat 3 — the happy path |
| 2 | A (no-deliver) | same address + `pepperoni`, force `test_pickup_only` fixture | `no_go` (delivery=`pickup_only`) | refuses with `compatibility_blocked` error | Demo Beat 4 |
| 3 | C (wrong-item) | same address + `sushi`, target `test_vlad` | `no_go` (item=`not_available`) | refuses, surfaces `nextStep` text suggesting substitute | Demo Beat 5 |
| 4 | B (out-of-range) | distant address + any intent (forcing a Domino's far away) | `no_go` (coverage=`out_of_range`) on the far Domino's | refuses | Verifies Domino's coverage path; if Domino's `lat:0/lng:0` short-circuits to `unknown`, that's the v2-delta C-1 mitigation working as designed |
| 5 | D (caution) | same address + `meat_lovers`, force a `places_*` restaurant | `caution` (one or more `unknown`) | proceeds (caution does NOT block) AND Bland prompt includes ITEM-CONFIRM step | Verifies the caution path doesn't false-block |

### Per-surface checklist for each flow

**MCP (Claude Desktop):**
1. Open Claude Desktop → ensure `aiweb-pizza` MCP server is connected.
2. Send the natural-language prompt corresponding to the flow.
3. Check Claude's response for the compatibility narrative (it should reproduce `nextStep` verbatim on caution/no_go).
4. If place_order would fire: monitor for the actual Bland call. If blocked: confirm no Bland call dispatched.
5. Inspect `runtime/events.jsonl` — there should be a `cat: "compatibility"` event for each `assessCompatibility` call, plus a `cat: "compatibility-override"` event if the override flag was used.

**A2A (test panel):**
1. Open https://aiweb-mcp.fly.dev → bearer token + agent-card preloaded.
2. Send a structured A2A message with the same address + intent as the flow.
3. Inspect the `proposed_cart` artifact — confirm it carries a `compatibility` field with the four sub-fields (delivery / coverage / item / overall) plus `nextStep`.
4. Submit the same message with `confirmed: true` (and matching `confirmation_token`). For no_go flows, expect rejection with `compatibility_blocked`. For go flows, expect Bland dispatch.
5. Same events.jsonl inspection.

### What to look for that the gauntlet can't see

The gauntlet validates code correctness. The human check validates UX:

- Does the agent's natural-language reply on a `caution` flow actually surface the unknown clearly to YOU (not just embed the field in the response JSON)? If the agent says "Vlad's might have meat lovers — should I call to confirm?" verbatim from `nextStep`, that's the AC7 + D-2 directive working. If the agent paraphrases or omits, the tool description didn't bind tightly enough.
- Does the Bland call ITEM-CONFIRM step (when fired) sound natural to the restaurant on the other end, or does it confuse them? This is the only real-world signal that the prompt change in `bland.ts` works.
- On Beat 1 (success path): does the cart preview shown to you BEFORE confirmation match what Bland actually orders? Drift here = ISS-005 territory but in the honest path; if it drifts, RT-201 is more urgent than we think.

### Known gap during your test (do not flag as bug)

- **RT-201 / ISS-005:** if you specifically try to mutate `intent_style` between `start_pizza_order` and `place_order` to a compatible value while keeping a no_go cart, the gate WILL pass and Bland WILL fire — that's the deferred adversarial bypass. Honest-path testing won't trip it. Don't do this in the YC demo.
- **Gemini quota:** Gemini Pro models 404 on this account. Doesn't affect the demo (only redteam dispatch, which already ran via openai). Will resolve if you upgrade to Tier 1+ in Google Cloud billing.

### After the test

- If all 10 cases pass: run final `/export` → save as `yc-export-2.md`.
- If any flow surprises you: log the surprise in `issues.md` with full repro, decide fix-now-vs-defer same as we did for RT-201.

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
