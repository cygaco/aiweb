# The AI Web — Wave 00

## What This Is

MCP server for pizza ordering — the "time to pizza" proof for The AI Web platform. An agent says "order me a pizza," a Bland.ai voice agent calls the restaurant, a real pizza gets ordered. Cash on delivery.

Part of **Warp Studio** — an AI-native venture studio. This product proves the four primitives: discovery, trust, compatibility, commerce.

## Architecture

```
src/
├── server.ts              # MCP server, 3 tool definitions (the product's brain)
├── connectors/
│   └── bland.ts           # Bland.ai voice call: prompt builder + dispatch + transcript parser
├── data/
│   └── restaurants.ts     # Hardcoded restaurant data (placeholder phones — replace before testing)
└── lib/
    └── presets.ts          # Research-backed order presets + smart defaults (3/8 rule, 70/30 kids, etc.)
```

**Tools → Connectors → Intelligence.** Adding a restaurant = editing `restaurants.ts`. Adding a connector = new file in `connectors/`. Tool definitions rarely change.

## The Three MCP Tools

| Tool | Purpose | When called |
|---|---|---|
| `start_pizza_order` | Find restaurants, show presets, build suggested order | First — on any pizza intent |
| `place_order` | Generate Bland prompt, fire voice call to restaurant | After explicit user confirmation |
| `check_order_status` | Poll Bland call status, parse transcript | After place_order, to get result |

## Stack

- TypeScript (ES2022, NodeNext modules)
- `@modelcontextprotocol/sdk` — MCP server
- `zod` — parameter validation
- `bland.ai` — voice API for restaurant calls
- No framework, no database yet (Wave 00 MVP)

## Protected Decisions

These are locked. Do not change without explicit discussion:

1. **Mandatory confirmation on every order.** No path bypasses showing full cart (items, price, restaurant, ETA, address, name, phone) and getting explicit "yes" before `place_order`.
2. **Parse intent before asking.** If the user said "meat lovers," don't ask what they want. Extract intent_signals from the prompt.
3. **Cash on delivery only (Wave 00).** No credit card handling, no checkout sessions, no bot detection.
4. **Pre-built > self-build.** Runtime generation costs minutes + 50K tokens. Pre-built: milliseconds + 160x cheaper.
5. **Supply-side focus.** We build for providers. We don't know which consumer agent wins.
6. **Protocol-agnostic.** Output whatever agents consume. Protocols change; primitives don't.

## Conversation Flow

8-step UX rhythm: Parse Intent → Recognize User → Show Presets → User Picks Path → Search → Results → Confirm → Place Order. See `ai-web-flow-reference.md` for the full matrix.

Key UX principles:
- Agent leads, user reacts (show what you know, suggest what's best)
- Selection > conversation > form (tappable presets kill 9 min of indecision)
- Never a bare spinner ("Checking 4 restaurants near you" not "Loading...")
- Tradeoffs are narrated (don't list — explain price vs speed vs match)
- Checkout info woven in naturally (not a form dump at the end)

## Commands

```bash
npm install          # install deps
npm run build        # tsc → dist/
npm run dev          # tsx watch mode
npm start            # run built server
```

## Environment

Copy `.env.example` to `.env` and set:
- `BLAND_API_KEY` — from bland.ai
- `BLAND_FROM_NUMBER` — optional Bland phone number

## WarpOS Integration

This project is prepared to pull settings, skills, hooks, and agent infrastructure from the WarpOS repo (GitHub). **Do not pull yet — WarpOS is being updated.**

When ready, WarpOS will provide:
- `WarpOS.md` — technical backbone (stack, products table, decisions log, validated patterns)
- Claude Code hooks and slash commands
- TypeScript schemas (Deus Mechanicus, Warp Profiles)
- Implementation patterns (encrypted storage, rate limiting, Bright Data, UI component kit)
- Product-specific CLAUDE.md overlays

Integration point: `.warp/` directory will house pulled artifacts. The `sync-warp.sh` script (placeholder) will handle pulls.

## Warp Studio Context

- **Warp Drive** = Notion workspace (knowledge, decisions, process)
- **WarpOS** = GitHub repo (code-adjacent artifacts Claude Code touches)
- Rule: Notion holds knowledge. GitHub holds code. Neither duplicates the other.
- All products integrate **Deus Mechanicus** for dev/test tooling (post-MVP).

## Notion Pages (Warp Drive)

Key pages for this product:
- The AI Web (product brief): `3394b2201a1781318292f4776f0db394`
- MCP Server Spec — Wave 00: `33a4b2201a1781669136d55745238c31`
- Conversation Flow Reference: `33a4b2201a17813cbe84f2bfa0c20d0a`
- Session Handoff 2026-04-05: `33a4b2201a17814d8dd2ca737a6dc2b4`
- Ideas — v5 Brief Candidates: `33a4b2201a178184ab71c81ae45140b2`
- Warp (studio overview): `3174b2201a17812fb9eecfdfa952b1dd`
- Shared Rules: `3184b2201a178107accef1458292042b`

## Shared Rules (from Warp)

- Diffs only for code edits unless initial build
- No inline comments unless logic is non-obvious
- No new dependencies without flagging: name + reason + ask
- Every spinner/loader must have contextual text
- Prefer `str_replace` over full-file rewrites
- Flag session cost when getting heavy
