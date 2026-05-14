# AIWeb Roadmap

The AI Web — Wave 00 pizza concierge. This file is the single roadmap for the product (active backlog + recently-shipped + open risks + crash-recovery + human verification test). Framework / WarpOS roadmap items live in their own canonical clone, not here.

---

## Current state (live — keep this updated)

- **Branch:** `main` at `ffc89c4` (post-YC-sprint head; subsequent commits land here)
- **Build:** `npm run build` clean. `npm test` 105/105 passing.
- **Last sprint:** YC application sprint, 2026-05-06 → 07 — compatibility-layer feature shipped + four-gate gauntlet closeable. Full story in `yc-application.md`.
- **Open issues:** 5 in `issues.md` (1 fixed, 3 deferred non-blocking, 1 deferred-with-fix-path = ISS-005 / RT-201).
- **Open WarpOS-propagation flags:** 13 in `warpos-to-update.md`. Drained on `/warp:promote` or `/warp:release`.
- **Launch readiness:** see `_docs/launch/MVP-P0-INVENTORY.md`.

---

## Recently shipped

### YC sprint — compatibility layer (2026-05-06 → 07)

Three real demo failures (no-pizza, no-deliver, no-deliver-here) became one structural fix.

- New module `src/lib/compatibility.ts` (399 LOC) with three checks (delivery / coverage / item) + `assessCompatibility` combiner returning `go | caution | no_go` with confidence + source + nextStep.
- Wired symmetrically into both surfaces: MCP `start_pizza_order` (embed per-restaurant + sort by verdict + reproduce-nextStep tool description) and A2A `proposed_cart` artifact (carries compatibility for client display).
- Hard block at `place_order` and at A2A `confirmed=true` — refuses to fire Bland when `overall === 'no_go'` unless `override_compatibility: true`.
- Bland prompt gains conditional ITEM-CONFIRM step when item availability is `unknown` — call starts with "Quick question — do you carry [intent_style]?" before placing the order.
- New helpers: `src/lib/geo.ts` (extracted geocodeAddress for cross-module reuse), `src/lib/event-log.ts` (append-only `runtime/events.jsonl` writer with fail-open).
- 18 unit tests in `tests/compatibility.test.ts` (15 from PRD §9 + #16 logger spy + #17 dominos lat=0 unknown + #18 snake_case regression).
- Connector honesty: `src/connectors/places.ts` stops fabricating `deliveryRadius` (was inventing values from haversine + 50% padding); now emits `deliveryRadius: null` + `serviceType: 'unknown'`. `src/connectors/dominos.ts` sets `serviceType: 'delivery'` truthfully.
- New fixture `test_pickup_only` for QA Flow A + Demo Beat 4.
- Gauntlet 4/4 closeable — reviewer + compliance + qa pass-after-fix; redteam pass-with-warn (1 HIGH = ISS-005, deferred per Beta DECIDE 0.88).
- Cross-provider review caught what same-provider missed: gpt-5.5-mini (QA) caught snake_case intent normalization that Claude builder + Claude reviewer both missed.

Commits: `05ab8c0`, `ab77b28`, `4787381`, `4c7dcb9`, `a59e34c`, `8bc7ae5`, `3077fb3` (merge), `1ae13c7`, `aa78cff`, `ffc89c4`.

### Pizza intake upgrade (2026-05-02 → 04)

- W1: per-restaurant size + price binding (`015b7c4`)
- W2: address abbreviation expansion before Bland TTS (`b6e5cc5`)
- W4: shared cart domain model + extended menu schema (`08bf095`, `129840b`, `9d4cf43`)
- W5: cart-flow surface + `update_order` MCP tool + token cart-binding (`a6008dc`)
- W6: delivery special-instructions surfacing + token-bind + gauntlet-review fixes (`1a95bce`, `0225e97`)
- Bland intro line "This is an AI pizza concierge agent calling." (`bb7f041`)
- A2A spec-valid input-required state for upsell turn (`b18f275`)
- Agent-card provider rebrand to Agents for All / agentsforall.co (`0d21da5`)

---

## Active backlog

Items grouped by area. Each is a meaningful project on its own — listed here so they don't get lost.

### Compatibility-layer follow-ups (next iteration)

#### N-1 — Pre-call menu confirmation (extends compatibility-layer)

**Problem:** when item availability is `unknown` (typically a Places-discovered restaurant — generic 3-item menu, no real menu data), the bot still calls. The Bland prompt's ITEM-CONFIRM step asks the restaurant on the call — but the call has already been initiated, the user is committed, and a "no, we don't carry that" answer means the bot has to recover mid-call.

**Approach:** add a cheap pre-call menu probe step BEFORE `place_order` fires Bland. Three candidate sources, ranked by cost:
1. **Cached menu from prior calls** — parse past Bland transcripts for menu items, cache per-restaurant. Free if we've called before.
2. **Restaurant website scrape** — fetch the website (already in Place data), extract menu via Claude on the HTML. ~1-2 sec, ~5K tokens.
3. **Pre-call voice probe** — a 30-second Bland call that ONLY asks "do you carry [item]?" — no order placement. Cheap because the call ends at confirmation.

After any of these resolves, re-run `assessCompatibility` with the now-known menu data. If still unknown, fall back to current behavior (place call with ITEM-CONFIRM step).

**Pairs with ISS-005 (RT-201)** — same area of code (`src/server.ts:place_order`, `src/a2a/executor.ts`); doing both at once is efficient.

#### N-2 — Resolve open compatibility-layer issues

See `issues.md` for full schema. Priority order:

- **ISS-005 / RT-201** (HIGH adversarial): place_order recomputes compatibility against unbound `intent_style`; attacker can desync gate from cart. Fix path documented (option b — derive compatibility from cart contents). ~30 LOC across server.ts + executor.ts.
- **ISS-001** (deferred): keyless geocoding fallback returns caution-state for known SF fixtures. Fix path: city-name string match fallback when geocode fails.
- **ISS-002** (open, tooling): codex CLI cold-start race on Windows. Fix path: extend `providerAvailable()` to do a `which codex` ping.
- **ISS-003** (deferred, account-gated): Gemini 3.1-pro 404 on user's free-tier API key project. Fix: upgrade to Tier 1+ Google Cloud billing OR get added to 3.1 preview allowlist.
- **ISS-004** (FIXED `8bc7ae5`): graph format mismatch — STORIES.md uses `### GS-XX-NN` headings now.

### Menu connector enrichment

- [ ] **Real Domino's API menu adapter** that emits the new `Cart` schema's modifiers, drinks, and deals (today: emits only `pizzas[]` and `sides[]`). Likely 2x the size of the intake-upgrade plan. Touches `src/connectors/dominos.ts`.
- [ ] **Google Places menu enrichment** — Places returns minimal menu data; need either a vision-based menu OCR layer or a per-restaurant "best-effort modifier estimation" stub. Touches `src/connectors/places.ts`. (Pairs with N-1 above.)
- [ ] **New chain connectors** — Pizza Hut, Papa John's, Little Caesars. Each is a separate connector with its own auth/rate-limit story.
- [ ] **Domino's store coordinates** — Domino's API doesn't return store lat/lng (currently hardcoded as 0/0 → coverage check returns `unknown`). Either geocode `restaurant.address` in `mapToRestaurant` or pull from another Domino's endpoint.

### Deal intelligence

- [ ] **Deal optimization** — actually compute whether a published deal beats the user's current cart. Phase 1 of the intake upgrade only *surfaces* deals; it does not claim savings. The math is non-trivial: requires per-component pricing comparison, not just total-vs-total. Risk: a wrong "you'd save $X" claim is worse than no claim.
- [ ] **Multi-restaurant deal awareness** — cross-chain bundles (e.g. "Domino's has the better price for pepperoni, Pizza Hut has the better wing deal — order from both?"). Out of scope for v1.

### Cart depth

- [ ] **Half / whole topping placement in the intake UI** — schema (`SelectedModifier.half`) supports it; intake flow doesn't surface it yet. Add only when there's user demand; most chain UIs hide this behind an advanced toggle.
- [ ] **Per-size modifier pricing** — extra cheese typically costs $1 on a small but $3 on a large. Today our `Modifier.priceDelta` is a flat number. Schema upgrade: `priceDelta: number | { sizeId: string; price: number }[]`.
- [ ] **Tax / fees / tip handling** — Wave 00 quotes "approximate total" via Bland; doesn't capture tax line items, delivery fees, or tip. Real-world commerce needs all three.

### Auth + identity

- [ ] **Per-user auth + profile re-introduction** — multi-week project. Add a signup or magic-link flow that issues per-user JWTs; an identity store keyed by verified user id; per-user tokenHash deriving from JWT claims (not from the shared WARP_MCP_KEY); JWT validation at the /mcp and /a2a boundaries; multi-user integration tests that prove caller A cannot read caller B's profile. Re-enables ROADMAP "Profile depth" items (preferred_drinks, preferred_modifiers, structured address fields) cleanly on top of real identity instead of retrofitting onto a broken auth model.

### Profile depth

> **Status (2026-05-14):** HTTP/MCP profile surface removed in SP-20260514-001 due to a structural cross-user data-leak in the single-bearer auth model. Re-introduction blocked behind "Per-user auth + profile re-introduction" (see Auth + identity above).

- [ ] **`UserProfile.preferred_drinks` and `preferred_modifiers`** — flagged in the intake-upgrade plan as an optional future. Once we have N>10 active users, mine their order history to infer defaults; cuts the upsell turn for repeat users.
- [ ] **Address parsing into structured fields** (street/unit/city/state/zip) — today address is a single opaque string. Structured fields enable better Bland prompts, smarter delivery-radius checks, and address verification at intake time.

### Voice quality

- [ ] **Per-restaurant pronunciation profile** — some chain names are mispronounced by Bland TTS. Add a `Restaurant.speakable_name` field that overrides `name` in the call prompt. Same pattern as `speakableAddress`, applied to restaurant name.
- [ ] **Phonetic respelling for unusual menu items** — items like "Calzone", "Stromboli", "Bruschetta" sometimes get mangled. Optional `MenuItem.speakable_name` for the prompt.
- [ ] **SSML upgrade** — Bland may add SSML support; switch from English-spelled-out abbreviations to actual `<phoneme>` / `<say-as>` tags when available.
- [ ] **Claude places the order call itself** — make the AI able to order by calling the restaurant directly, instead of handing off to Bland.ai. Claude becomes the voice agent on the line (via Claude voice or a similar real-time speech surface), reads the cart, handles ITEM-CONFIRM, captures the confirmation. Removes Bland as a runtime dependency, brings narration honesty into the call itself, and lets the same compatibility-layer rules govern the call. Significant integration work — needs a real-time TTS + STT loop, latency budget, telephony provider, and a deterministic recovery flow when the call goes sideways.

### Compliance + commerce

- [ ] **Credit card flow** — currently cash-only by protected decision. Real commerce requires either (a) a chain-specific payment integration or (b) a tokenized card delegated to the user's chain account. Significant security + compliance scope.
- [ ] **Allergen surfacing** — `dietary` is a string filter today. Real allergen data needs structured fields (gluten, dairy, nuts, soy, etc.) on every `MenuItem`.

---

## Human verification test (Phase 6 manual smoke)

Goal: prove the compatibility layer works end-to-end on real surfaces, with one positive flow and three blocker flows.

### Pre-flight (60 sec)

1. `npm run build` — should exit 0 clean. (Already verified on main.)
2. `npm test` — should print "tests 105 / pass 105 / fail 0". (Already verified.)
3. Confirm `runtime/events.jsonl` exists OR the runtime dir is writable (it's created on first compatibility event).
4. Server: `npm run dev` (or whatever the local-MCP launcher is) — should bind on the configured port.

### Test plan — 5 flows × 2 surfaces (10 cases)

The two surfaces are **MCP** (Claude Desktop or `mcp-remote` bridge) and **A2A** (the test panel at https://aiweb-mcp.fly.dev). Run each flow on both surfaces.

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

### Known gaps during your test (do not flag as bugs)

- **RT-201 / ISS-005:** if you specifically try to mutate `intent_style` between `start_pizza_order` and `place_order` to a compatible value while keeping a no_go cart, the gate WILL pass and Bland WILL fire — that's the deferred adversarial bypass. Honest-path testing won't trip it. Don't do this in the YC demo.
- **Gemini quota:** Gemini Pro models 404 on this account (free-tier `limit: 0`). Doesn't affect the demo (only redteam dispatch, which already ran via openai). Will resolve if you upgrade to Tier 1+ in Google Cloud billing.

### After the test

- If all 10 cases pass: run final `/export` → save as `yc-export-2.md`.
- If any flow surprises you: log the surprise in `issues.md` with full repro, decide fix-now-vs-defer same as we did for RT-201.

---

## Crash-recovery / Resume instructions

**If the session crashes mid-work:**

1. Reopen Claude Code in this directory. SessionStart hook auto-loads the previous handoff.
2. Read this file (`ROADMAP.md`) — current state at the top.
3. Read `issues.md` for any open bugs.
4. Run `git status && git log --oneline -10` to see what's committed.
5. If you were in adhoc mode: `node scripts/mode-set.js adhoc --by alpha`.
6. Resume from the first unchecked item under **Active backlog**.

**If a fresh-eyes session asks "where do I start?":**

1. Read `yc-application.md` — sprint history + tradeoffs + risks.
2. Read this file's **Current state** + **Active backlog**.
3. Read `issues.md` for open bugs.
4. Pick from N-1 / N-2 / connector enrichment / cart depth based on priorities.

---

## Known risks

1. **Places API restaurants ship with `deliveryRadius: null`.** Honest, but means coverage is always `unknown` for non-Domino's discoveries. ITEM-CONFIRM in Bland is the partial mitigation; pre-call menu probe (N-1) is the structural fix.
2. **Generic Places menu has only 3 hardcoded items.** Any non-pepperoni/cheese/specialty intent on a Places restaurant gets `unknown`. Same N-1 dependency.
3. **Domino's lat/lng=0 in API response.** Coverage check short-circuits to `unknown` for Domino's specifically (PRD-V2-DELTA C-1 mitigation). Real fix: geocode store address.
4. **Token-binding mutation surface.** RT-201 demonstrated that any second-pass validation must re-derive its inputs from already-bound data. Generalizes beyond compatibility — applies to any future check that runs at place_order time.
5. **Demo-environment fragility.** test_vlad fixture is hardcoded with SF coordinates; the demo relies on a SF-area address. Demo-script address is `1 Market St, San Francisco`; do NOT use distant addresses (e.g. user's actual home in Riddle, OR — ~600 mi away).
6. **3-strike fix-cap.** If a recurring bug class hits cap 3+ in a single sprint, log to issues.md and defer. P-025 in Beta's judgment model is HARD-RULE.

---

## Notes

- **YC application materials:** `yc-application.md` (running session journal across YC-sprint sessions), `yc-application-brief.md` (paste-ready 610-word YC pitch with 6 cited 2026 sources), `yc-export-01.md` (mid-session conversation export), `yc-export-02.txt` (final session export).
- **Sprint discipline:** main branch must stay shippable at all times. Exploratory work happens on feature branches in `.worktrees/`. Every PR must pass `npm run build` clean before merge.
- **Cross-repo parity:** WarpOS framework changes flagged in `warpos-to-update.md` get drained on `/warp:promote` or `/warp:release`. Don't propagate manually.
