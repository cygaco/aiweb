# The AI Web — Wave 00 — Project Context

> Product-specific context. For framework instructions, see [CLAUDE.md](CLAUDE.md). For the agent system, see [AGENTS.md](AGENTS.md).

## Product

**The AI Web (Wave 00)** — An agent says "order me a pizza," a real pizza gets ordered. We are not building yet another delivery app; we are building the surface where any MCP-aware agent (Claude Desktop, Claude API, etc.) can place a real order at a real restaurant by having an AI voice agent (Bland.ai) call them on the user's behalf. Cash on delivery, no credit cards, no bot-detection problems, no restaurant onboarding required.

**Pre-launch alpha. Pre-revenue.** See `README.md` "Known launch-readiness gaps" for the unflinching list.

### The pitch in three sentences

1. An LLM calls our MCP tools (`start_pizza_order`, `prepare_order`, `place_order`, `update_order`, `check_order_status`).
2. We discover restaurants via Domino's API + Google Places, voice the order through Bland.ai, and parse the call transcript for confirmation.
3. The user pays the driver in cash.

### Surfaces

| Surface | Entry | Auth | Use |
|---|---|---|---|
| **MCP stdio** | `src/stdio.ts` (`node dist/stdio.js`) | Single-user-per-process | Claude Desktop via direct config or `mcp-remote` bridge |
| **HTTP /mcp** | `src/http.ts` → `src/server.ts` | Bearer `WARP_MCP_KEY` | Remote MCP callers (mcp-remote, web clients) |
| **A2A JSON-RPC** | `src/a2a/server.ts` → `src/a2a/executor.ts` | Bearer | Agent-to-agent protocol surface |
| **Webapp** | `webapp/app/` (Next.js, port 3001) | Bearer cookie | Browser chat UI; calls `/api/chat` which proxies to MCP |

The MCP, A2A, and webapp surfaces share the same lib code (cart-flow, compatibility, menu-discovery, presets) and the same Bland connector. **Lockstep rule:** narration phrases in `start_pizza_order` tool descriptions are mirrored in `webapp/app/api/chat/route.ts` and `src/a2a/executor.ts` — see `tests/narration-parity.test.ts`.

## Architecture

### Stack

- **Runtime:** Node.js 20+, TypeScript 5.4 (strict), built with `tsc` → `dist/`
- **Servers:** `@modelcontextprotocol/sdk` (MCP), `@a2a-js/sdk` (A2A), Express 5 (HTTP transport)
- **Validation:** Zod 3
- **AI:** Anthropic SDK (`@anthropic-ai/sdk`) for menu extraction (Claude Haiku 4.5)
- **Voice:** Bland.ai REST API
- **Discovery:** Google Places API (New) v1
- **Live menu source:** Domino's locator + store-menu APIs
- **Storage:** `better-sqlite3` for stdio-mode single-user profile state; Fly volume mount in prod
- **Hosting:** Fly.io (`aiweb-mcp` app, `sjc` region, 512MB shared-cpu, 8080 internal)
- **Webapp:** Next.js 15 + React 19 (in `webapp/`, separate package)

### Tools (MCP surface)

| Tool | Purpose | When the agent calls it |
|---|---|---|
| `start_pizza_order` | Find restaurants near an address; assess delivery / coverage / item compatibility; rank candidates; optionally enrich top-1 caution menu | First — when the user expresses pizza intent |
| `update_order` | Apply cart diffs (add/remove/swap to deal); reflect modifiers and surcharges | Mid-cart adjustments before checkout |
| `prepare_order` | Issue a server-signed `confirmation_token` binding restaurant+cart+customer fields (10 min TTL) | Right before `place_order`; gates fabricated cart shapes |
| `place_order` | Build Bland prompt, dispatch the call | After user confirms; rejects calls without a valid token when `REQUIRE_CONFIRMATION_TOKEN` is set |
| `check_order_status` | Poll Bland call status, parse the transcript for confirmation/total/ETA | After `place_order`; loop until the call concludes |

Plus two read-only utilities surfaced via HTTP only:
- `GET /healthz` — Fly health check
- `GET /` — landing index linking `/tos` + `/privacy`

### Library layout

```
src/
├── server.ts            # MCP tool definitions (registers all 5 tools)
├── stdio.ts             # MCP stdio entrypoint (single-user-per-process)
├── http.ts              # HTTP entrypoint (Express + /mcp transport + bearer auth)
├── a2a/
│   ├── server.ts        # A2A JSON-RPC server
│   ├── executor.ts      # A2A intent executor (mirrors MCP tool semantics)
│   └── agent-card.ts    # A2A capability advertisement
├── connectors/
│   ├── bland.ts         # Bland.ai prompt builder + call dispatch + status parsing
│   ├── places.ts        # Google Places (New) v1 discovery (progressive 5→15→30 mi)
│   └── dominos.ts       # Domino's locator + store-menu
├── data/
│   └── restaurants.ts   # Restaurant model + PIZZA_CUISINE_DEFAULTS + test fixtures
└── lib/
    ├── compatibility.ts # Per-restaurant verdict (go|caution|no_go) — three checks
    ├── menu-discovery.ts# Website crawl + Haiku extraction + Maps URI hop + cache
    ├── menu-taxonomy.ts # FoodMenu enums (cuisine, allergen, dietary)
    ├── cart.ts          # Cart + Drink + Deal + ModifierGroup types
    ├── cart-flow.ts     # Cart diffs, narration-total-unknown, on-menu predicates
    ├── presets.ts       # COLD_PRESETS, orderFromIntent, pizzasNeeded (3/8 rule)
    ├── confirmation-token.ts # Signed token issue + verify
    ├── profile-store.ts # stdio-mode SQLite profile store
    ├── address-speech.ts# Address phonetic normalization for Bland's TTS
    ├── brand-portfolios.ts # "Coke" → Coca-Cola brand resolution
    ├── geo.ts           # Geocoding (Places) + haversine
    └── event-log.ts     # Append-only product-event log (runtime/events.jsonl)
```

Plus a Next.js webapp in `webapp/` that proxies user chat to the MCP server.

### Two event streams (do not conflate)

- `runtime/events.jsonl` — product-app events (compatibility outcomes, enrichment ran/source/duration, branch decisions in `start_pizza_order`). Written by `src/lib/event-log.ts`. Mined for product behavior analysis.
- `.claude/project/events/events.jsonl` (`paths.eventsFile`) — framework/Alpha meta-events (tool calls, hook fires, agent dispatches). Mined for `/learn:deep`, `/issues:scan`, etc.

See `LRN-2026-05-18-paths-json-drift` — these are independent by design.

## Honesty walls — what we never fabricate

The product has a hard rule: **the agent never voices items, prices, sizes, or commitments it cannot back with evidence.** The compatibility layer + menu-honesty hotfixes enforce this server-side:

- `places_*` restaurants without successful enrichment expose `menu_known: false` + empty `menuSummary` and an explicit `menu_unavailable_note` (`server.ts:830`).
- `cartNarrationTotalUnknown` flags carts whose base price is 0 / unknown so the narration suppresses dollar amounts.
- The compatibility 4-conjunct guard (`compatibility.ts:921`) escalates "caution-all-unknown after enrichment attempt" to `no_go + verdict_tier=enrichment_failed`.
- `isPrimaryGeneric → fallback_discovery` (`server.ts:958`) refuses to build a `suggested_order` from generic-template menus for vague-intent openers.

The most recent reference document on what the underlying menu-data ecosystem actually permits: `.claude/project/reference/google-menu-apis-survey-2026-05.md` (no public Google API returns structured menus to third-party callers; website scraping is the only primary path).

## Specs, sprints, retros

### Where specs live

- `_requirements/_index/` — index files
- `_requirements/00-canonical/` — canonical specs + STEPS.json
- `_requirements/03-architecture/` — architecture-level specs
- `_requirements/04-features/{slug}/` — per-feature PRD, stories, COPY

### Sprint workflow

- `/sprint:plan` → Plan Contract under `.claude/runtime/sprints/<SP-ID>/` (durable, crash-recoverable)
- `/sprint:design` → PRD + stories + COPY + INPUTS + TRACE + acceptance criteria → tickets
- `/sprint:execute` → Ralph-style plan/act/test/review/record/checkpoint loops per ticket
- `/sprint:release` → final checks + deploy gate + release notes + rollback prep
- `/sprint:retrospective` → post-sprint synthesis (idempotent, fail-open)

Active and recent sprints (`_docs/sprints/` and tracker artifacts):

| ID | Scope | Status |
|---|---|---|
| SP-20260512-001 | Menu honesty — block agent from voicing fabricated menu items | shipped |
| SP-20260512-002 | Compatibility layer — per-restaurant verdict + sort + item_map | shipped |
| SP-20260514-001 | Profile-security — remove network-reachable profile surface | shipped |
| SP-20260514-002 | Golden-path harness — `npm run test:golden`, 3 scenarios, 2 surfaces | shipped |
| SP-20260514-003 | MVP must-haves — `EMERGENCY_DISABLE_BLAND`, `/tos` + `/privacy`, MCP GET index | shipped |
| SP-20260514-004 | A2A harness redesign | shipped |
| SP-20260517-005 | Menu discovery R-2 (multi-page) / R-5 (Maps URI hop) / R-8 (FoodMenu enums) | shipped + post-deploy hotfix |

### Open follow-ups

- **`ai-web-debug-01`** (2026-05-18) — menu discovery returns 20 restaurants but verifies 0 menus on real-world SF queries. Capability ceiling + framing-error analysis logged at `RT-006` in `.claude/project/memory/traces.jsonl`.
- **`I-20260514-001`** — A2A surface harness depth (executor is stateful, not per-tool dispatcher).
- **`MVP-P0-INVENTORY.md`** — full P0/P1/P2 inventory at `_docs/launch/MVP-P0-INVENTORY.md`.
- **Secret-leak incident (2026-05-18)** — `WARP_MCP_KEY` was committed in `scripts/one-off/aiweb-pizza-mcp.cmd` from May 2 → May 18 on a public GitHub repo. Mitigation: Fly secret rotated, .cmd untracked, history rewritten (`git filter-repo --replace-text`), force-pushed. Hook hardened with 8 new patterns. RT-008 logged.

## Environment & Dev

### Commands

```bash
npm install                 # install
npm run build               # tsc → dist/
npm run dev                 # tsx src/stdio.ts (stdio mode)
npm run dev:http            # tsx src/http.ts (HTTP mode on :8080)
npm test                    # all tests
npm run test:golden         # golden-path harness, all surfaces, all scenarios
npm run audit               # npm audit --audit-level=high
```

Webapp (separate package under `webapp/`):

```bash
cd webapp && npm run dev    # Next.js on :3001
```

### Environment variables

**Required for production:**
- `ANTHROPIC_API_KEY` — Haiku 4.5 for menu extraction
- `BLAND_API_KEY` — voice agent
- `GOOGLE_PLACES_API_KEY` — restaurant discovery + geocoding
- `WARP_MCP_KEY` — single operator-issued bearer for HTTP/MCP/A2A surfaces
- `PROFILE_ENCRYPTION_SECRET` — token signing

**Optional / behavior gates:**
- `BLAND_FROM_NUMBER` — outbound caller ID (Bland provides one if unset)
- `ENRICH_COUNT` — number of caution restaurants to attempt menu enrichment on (default 1)
- `INCLUDE_TEST_RESTAURANTS` — expose `test_*` fixtures (default true locally; `false` in prod via fly.toml)
- `REQUIRE_CONFIRMATION_TOKEN` — gate `place_order` on a valid `prepare_order` token
- `EMERGENCY_DISABLE_BLAND` — panic-stop new dispatches
- `BLAND_HARNESS_MODE` — golden-path source short-circuit
- `SIM_FAST_FORWARD_MS` — sim_* status transition speed for tests
- `MENU_CACHE_DIR` — override `runtime/menu-cache/` (tests use this)
- `DATABASE_PATH` — stdio profile SQLite path
- `PORT`, `HOST`, `ALLOWED_HOSTS` — HTTP transport binding

### Claude Desktop setup

The repo includes `scripts/one-off/aiweb-pizza-mcp.cmd.template`. Copy it to `aiweb-pizza-mcp.cmd` in the same directory, replace `REPLACE_WITH_YOUR_KEY` with the live `WARP_MCP_KEY`, and point Claude Desktop's `claude_desktop_config.json` at the populated file. The populated `.cmd` is gitignored — never commit it.

### Deployment

`fly.toml` deploys to `aiweb-mcp.fly.dev`, region `sjc`, `aiweb_data` volume at `/data` (profiles DB). Auto-stop/auto-start machines; `min_machines_running = 0` for cost. Concurrency soft 20 / hard 25 requests.

Operators pre-warm the menu cache for a metro with:

```bash
npx tsx scripts/cache-warm.ts seeds/menu-cache.json
```

Seed file at `seeds/menu-cache.json` covers Medford OR + a starter SF list.

### Testing

- **Unit / integration:** `tests/*.test.ts` and `tests/**/*.test.ts`, run via `node --test` (tsx loader).
- **Golden-path harness:** `npm run test:golden` runs 3 scripted scenarios (pizza-only, pizza-plus-side, pizza-plus-drink) across both MCP stdio and A2A surfaces. Bland is mocked at 3 independent guard layers — no real calls dispatch.
- **Regression suites:** `tests/regression/<SP-ID>/` captures bug-class fixtures so a future change can't re-introduce a closed vulnerability.

## Git & WarpOS

### Git rules

- **Main branch:** `main` (the WarpOS manifest still reads `master` — known drift, harmless).
- **Never destroy the backup branch.** Treat unknown `backup-*` branches as protected.
- **Push to remote** requires explicit user approval per the autonomy table in CLAUDE.md.
- **Public repo.** `https://github.com/cygaco/aiweb.git`. Treat every file you commit as world-readable, indefinitely (GitHub keeps unreachable commits accessible by SHA for ~90 days even after force-push).

### WarpOS in this repo

This repo is **a product instance** of WarpOS, not the canonical clone. Rules:

- Installer-owned files (`.claude/framework-manifest.json`, `.claude/framework-installed.json`) are never hand-edited in product repos — `install.ps1` owns them.
- Framework changes (skills, hooks, agent specs, paths) flow upstream via `/warp:promote` from a sibling canonical WarpOS clone, then ride `/warp:release` from there.
- Do not push framework changes from this repo to the canonical WarpOS remote — that's a `/warp:release` operation from the canonical clone only.

### Demo strategy

Demo runs target `test_vlad` ("Vlad's Pizza Kitchen") — a labeled test fixture with rich pizzas/sides/drinks/deals and a real phone that answers as restaurant staff. **`orderConfirmed:true` is the milestone, not a delivered pizza.** Real-restaurant demos are gated behind `INCLUDE_TEST_RESTAURANTS=true` in non-prod environments.
