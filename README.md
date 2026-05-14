# The AI Web — Wave 00

**An agent says "order me a pizza." A real pizza gets ordered.**

MCP server that connects to Claude (or any MCP client), takes pizza orders through conversation, and places them by having an AI voice agent (Bland.ai) call the restaurant. Payment is cash on delivery — no credit cards, no checkout sessions, no bot detection.

## How It Works

```
User: "Order me a pizza"
  ↓
Claude calls start_pizza_order
  ↓
Shows presets: [Pepperoni] [Game day] [Kids party] [Office] [Other] [Quiz]
  ↓
User picks or specifies
  ↓
Claude confirms: "2 large pepperoni from Domino's, $26, ~30 min. Cash. Confirm?"
  ↓
User: "Yes"
  ↓
Claude calls place_order → Bland.ai calls the restaurant
  ↓
"Hi, delivery to 742 Evergreen Terrace. Two large pepperoni. Cash."
  ↓
Claude calls check_order_status → parses transcript
  ↓
"Order confirmed! 30 minutes, $25.98. Pay the driver."
```

## Setup

### 1. Install

```bash
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:
- `BLAND_API_KEY` — Sign up at [bland.ai](https://www.bland.ai), get your API key
- `BLAND_FROM_NUMBER` — Your Bland phone number (optional, Bland provides one)

### 3. Add Real Restaurants

Edit `src/data/restaurants.ts`:
- Replace placeholder phone numbers with real local pizza places
- Update addresses and menus to match
- Start with 1-2 restaurants you can actually test with

### 4. Build & Run

```bash
npm run build
npm start
```

Or for development:

```bash
npm run dev
```

### 5. Connect to Claude Desktop

Add to your Claude Desktop MCP config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ai-web-pizza": {
      "command": "node",
      "args": ["/path/to/ai-web-wave00/dist/server.js"],
      "env": {
        "BLAND_API_KEY": "your_key_here"
      }
    }
  }
}
```

Restart Claude Desktop. You should see the pizza tools available.

### 6. Test

Say to Claude:
- "Order me a pizza to 123 Main St"
- "Get me a meat lovers"
- "Pizza for 10 people, game day"
- "Kids party, about 8 kids"

## Architecture

```
src/
├── server.ts              # MCP server + 3 tool definitions
├── data/
│   └── restaurants.ts     # Hardcoded restaurant data (replace with real)
├── connectors/
│   └── bland.ts           # Bland.ai API: prompt builder + call dispatch
└── lib/
    └── presets.ts          # Research-backed order presets + smart defaults
```

**Tools → Connectors → Intelligence.** Same separation as the full spec.
Adding a restaurant = editing `restaurants.ts`.
Adding a connector (e.g. Playwright) = new file in `connectors/`.
Tool definitions never change.

## The Three Tools

| Tool | What it does | When Claude calls it |
|---|---|---|
| `start_pizza_order` | Finds restaurants, returns menus + presets | First — when user says anything about pizza |
| `place_order` | Generates Bland prompt, fires the call | After user confirms the full order |
| `check_order_status` | Polls Bland, parses transcript | After place_order, to get confirmation |

## Smart Defaults (Research-Backed)

- **Default pizza:** Large pepperoni (64-67% of people choose this)
- **Group sizing:** 3/8 rule — 3 slices per adult, 8 slices per large
- **Kids party:** 70/30 cheese/pepperoni split
- **Game day:** Meat-heavy + wings (59% view as ultimate pairing)
- **Office lunch:** Variety + salads, thinner slices
- **Substitutions:** Thin crust → hand tossed, pepperoni → sausage

## Costs

- **Bland.ai:** ~$0.09/min. A pizza order call is 2-3 min = ~$0.27
- **No other costs.** No API fees, no delivery platform cuts.
- **User pays:** Cash to the delivery driver.

## What This Proves

✓ An agent can go from "order me a pizza" to a real pizza being ordered
✓ No restaurant involvement needed (we just call them like any customer)
✓ No credit card handling (cash on delivery)
✓ No browser automation / bot detection issues
✓ Smart defaults reduce 9 minutes of menu indecision to one confirmation
✓ Works with any restaurant that answers the phone

## Post-MVP

- [ ] Real restaurant discovery (Google Places API)
- [ ] Menu scraping (Playwright reads online menus)
- [ ] User identity / preferences (remember for next time)
- [ ] Live Bland webhooks (back-and-forth during call)
- [ ] Multiple connector types (API, Playwright, voice)
- [ ] Stripe MPP for card payments
- [ ] Deploy to Railway as hosted MCP server

### Notes — auth + user profile

The HTTP/MCP surface uses a single operator-issued bearer (`WARP_MCP_KEY`) for authentication. Because every caller shares this bearer, there is no per-user identity at the `/mcp` or `/a2a` boundary today. As a result, the previous `get_user_profile` / `update_user_profile` MCP tools and the saved-profile fallbacks for delivery address / name / phone have been removed (SP-20260514-001). HTTP/MCP callers must supply `delivery_address`, `customer_name`, and `customer_phone` in every `place_order` call. Stdio mode retains the profile library as a single-user-per-process convenience (see `src/stdio.ts`). Re-introduction of a network-reachable profile is tracked in `ROADMAP.md` under "Per-user auth + profile re-introduction."
