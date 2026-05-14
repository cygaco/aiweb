# MVP Launch-Readiness Inventory

**Sprint:** `SP-20260514-003` — Inventory + P0 fast-execute
**Plan Contract:** `.claude/project/sprint/plan-contracts/PC-20260514-0008.yaml`
**Last updated:** 2026-05-14
**Contact:** contact@agentsforall.co

This document is the single source of truth for launch-readiness gaps before
shipping the AI Web pizza concierge to any real audience (friends-and-family,
YC demo, or public). Items are ranked P0 (launch-blocking), P1
(launch-desirable, address before or shortly after first cohort), and P2
(post-launch backlog). See [ROADMAP.md](../../ROADMAP.md) for the area-grouped
Active backlog.

---

## P0 — Launch-Blocking

Every P0 must be resolved — or explicitly accepted by the operator — before
shipping to any audience beyond the founding team.

| # | Item | Size | LOC estimate | Owning surface | Depends on | Impact on demo trust (1-5) | Proposed sprint hook | Status |
|---|------|------|-------------|----------------|------------|---------------------------|----------------------|--------|
| 1 | **Real per-user auth replacing `WARP_MCP_KEY`** — every caller today shares one bearer; profiles collapse to a single row; cross-session data leak is possible. | L | ~400 LOC (auth middleware + session model + profile re-key) | `src/http.ts`, `src/a2a/server.ts`, profile store | P0-6 (legal surface) should land first or in parallel | 5 | `/sprint:plan Real per-user auth — magic-link or OAuth + profile re-keying. Owned by SP-20260514-001.` | Owned by `SP-20260514-001` |
| 2 | **ISS-005 / RT-201 adversarial bypass fix** — `place_order` and A2A `confirmed=true` recompute compatibility from the unbound `intent_style` string, not the actual cart; an attacker can craft a cart that passes the no_go guard. Fix is option-b: derive compatibility check from cart contents (≈30 LOC in `src/server.ts` L1262, `src/a2a/executor.ts` L473, helper in `src/lib/compatibility.ts`). | S | ~30 LOC | `src/server.ts`, `src/a2a/executor.ts`, `src/lib/compatibility.ts` | None | 4 | `/sprint:plan ISS-005 fix — derive place_order compatibility recompute from cart contents, not intent_style string.` | Unowned — next `/sprint:plan` candidate |
| 3 | **Golden-path test harness** — no autonomous CI gate for the end-to-end demo flow. A change to `start_pizza_order`, the compatibility layer, or Bland prompt could regress the live demo silently. | M | ~200 LOC harness + fixtures | `tests/`, CI config, `src/connectors/bland.ts` sim path | None | 4 | `/sprint:plan Autonomous golden-path test harness — sim-mode end-to-end, no real Bland calls, runs in CI. Owned by SP-20260514-002.` | Owned by `SP-20260514-002` |
| 4 | **`EMERGENCY_DISABLE_BLAND` panic-stop env var** — ability to halt all new Bland dispatches without a deploy. | XS | ~30 LOC | `src/connectors/bland.ts`, `src/server.ts`, `src/a2a/executor.ts` | None | 3 | N/A — **shipped in this sprint (T-20260514-051).** | **Done — `daa25de`** |
| 5 | **Production observability beyond `runtime/events.jsonl`** — logs live on a single Fly volume; no error tracking, no alerting, no log shipping. A Bland-call-failure spike or auth abuse is invisible until someone SSHes into the machine. | M | ~50 LOC integration + vendor setup | `src/lib/event-log.ts`, Fly config, vendor account | None (but compose with P0-1 for per-user context) | 3 | `/sprint:plan Production observability — pick Sentry/Axiom/Logtail, wire event-log.ts shipping, add failure-rate alert.` | Unowned — next `/sprint:plan` candidate |
| 6 | **Legal surface (ToS + Privacy + contact + experimental disclosure)** — no published terms, privacy policy, or contact method on any public surface today. Placeholder pages land this sprint; real lawyer-reviewed terms are a harder P0 for public launch. | XS (placeholder) / L (lawyer-reviewed) | ~50 LOC placeholder; lawyer review is non-code | `webapp/app/tos/`, `webapp/app/privacy/`, `src/http.ts` | None | 4 | Placeholder: **shipped in this sprint (T-20260514-052).** Lawyer review: `/sprint:plan Real ToS + Privacy — Termly/iubenda template or counsel review.` | Placeholder done — `99b0691` |
| 7 | **Domino's store geocoding for coverage check** — `src/connectors/dominos.ts` sets `lat=0, lng=0`; `checkDeliveryCoverage` correctly returns `unknown` rather than `out_of_range`, but this means every Domino's-only flow shows "I can't verify delivery coverage" and the Bland prompt fires the ITEM-CONFIRM step for every call — surprising for a restaurant that definitely delivers. Fix: geocode the Domino's store address via the existing Google Places key. | S | ~20 LOC + env validation | `src/connectors/dominos.ts`, `src/lib/geo.ts` | Google Maps API key already present (`GOOGLE_PLACES_API_KEY`) | 3 | `/sprint:plan Domino's store geocoding — resolve lat/lng at startup, enable coverage check to return in_range or out_of_range.` | Unowned — next `/sprint:plan` candidate |
| 8 | **Documented rollback path** — no written procedure for "something went wrong in prod; how do we revert?" Fly rollback is `fly deploy --image <prev>` but the procedure isn't in any doc. Minimum: a one-page runbook in `_docs/operations/`. | XS | ~30 lines of markdown | `_docs/operations/` | None | 2 | `/sprint:plan Ops runbook — rollback procedure, incident response, Fly volume backup strategy.` | Unowned — next `/sprint:plan` candidate |

### Column key

| Column | Definition |
|--------|-----------|
| **Size** | XS < 1 day · S 1-2 days · M 3-5 days · L 1-2 weeks · XL > 2 weeks |
| **LOC estimate** | Rough lines-of-code change (not counting tests) |
| **Owning surface** | Primary files that change |
| **Depends on** | Other P0 items that ideally land first |
| **Impact on demo trust** | 5 = immediately visible to any first-time user; 1 = background hygiene |
| **Proposed sprint hook** | One-line prompt for the next `/sprint:plan` call to pick this up |

---

## P1 — Launch-Desirable

Address before or shortly after the first real cohort (friends-and-family or
YC demo). Not individually launch-blocking, but collectively they make the
difference between "scrappy alpha" and "first impression".

| # | Item | Size | LOC estimate | Owning surface | Depends on | Impact (1-5) | Proposed sprint hook |
|---|------|------|-------------|----------------|------------|-------------|----------------------|
| 1 | **Webapp polish** — today the webapp is barely-styled (monospace font, raw JSON responses). One polish pass (typography, spacing, message bubbles, loading state) lifts first impressions without touching the MCP/A2A surface. | M | ~150 LOC CSS/TSX | `webapp/app/` | None | 4 | `/sprint:plan Webapp polish — typography, message bubbles, loading state, mobile-friendly layout.` |
| 2 | **Managed log-shipping vendor pick** — Sentry free tier or Axiom free tier covers the launch scale. Pick one, wire `event-log.ts` to ship structured events, add a Slack/email alert on Bland-call-failure-rate > 20%. | M | ~50 LOC + vendor setup | `src/lib/event-log.ts`, Fly config | P0-5 selected vendor | 3 | `/sprint:plan Log shipping — Sentry or Axiom, wire event-log.ts, failure-rate alert.` |
| 3 | **Real ToS template via Termly/iubenda or lawyer review** — the placeholder pages land at P0-6; this P1 replaces them with an actual legal template that names data processors, retention periods, and CCPA/GDPR disclosures correctly. | S–M | ~2 hours vendor setup + review | `webapp/app/tos/`, `webapp/app/privacy/` | P0-6 placeholder | 3 | `/sprint:plan Real ToS/Privacy — Termly.io template or counsel review + publish.` |
| 4 | **Auth mechanism choice: magic-link vs OAuth vs invite-token** — even if Plan A's exit is "remove profile until real auth ships", the auth P0 follow-up sprint needs a mechanism decision before it can be sized. Options: (a) invite-token (simplest, friends-and-family only), (b) magic-link via Resend/Postmark (adds vendor dependency), (c) OAuth via Auth0/Clerk (heavier, production-grade). | XS | 0 LOC (decision only) | Design doc | P0-1 | 5 | `/sprint:plan Auth mechanism decision — evaluate invite-token vs magic-link vs OAuth, output decision record.` |
| 5 | **In-memory rate-limiter migration to Upstash/Redis** — the current `express-rate-limit` store resets on every cold start and isn't shared across Fly machine instances. Acceptable for single-machine scale; blocks multi-instance horizontal scaling. | S | ~30 LOC + Upstash account | `webapp/middleware.ts`, `src/http.ts` | None | 2 | `/sprint:plan Rate-limiter persistence — Upstash/Redis adapter for express-rate-limit.` |
| 6 | **Domino's coordinates geocoding fix** — same as P0-7 but demoted to P1 if the operator accepts the "unknown coverage" user experience for the initial cohort. | S | ~20 LOC | `src/connectors/dominos.ts`, `src/lib/geo.ts` | Google Maps key | 3 | `/sprint:plan Domino's geocoding — resolve lat/lng at startup so coverage check can return real verdict.` |

---

## P2 — Post-Launch Backlog

Items that make the product better but don't block a first real cohort.
Enumerated in full in [ROADMAP.md](../../ROADMAP.md) under **Active backlog**
(area-grouped). Key clusters:

- **Compatibility-layer follow-ups** — pre-call menu confirmation, multi-restaurant simultaneous search, Bland webhook real-time transcript.
- **Cart depth** — coupon/promo code surface, price-matrix breadth (Papa John's / Pizza Hut), topping half-and-half UX.
- **Profile depth** — per-user saved addresses, favorite orders, order history (depends on P0-1 real auth landing first).
- **Deal intel** — automated deal-scraping, deal applicability scoring, user-facing savings display.
- **Voice quality** — SSML tuning, Bland voice selection A/B, transcript accuracy improvements.
- **Additional pizza chain connectors** — Papa John's, Pizza Hut, local independents via Places enrichment.
- **A2A ecosystem** — additional A2A client examples, agent-card version bump, task cancellation (in-flight call cancel).

See ROADMAP.md `Active backlog` for sizing and dependency notes on each.
