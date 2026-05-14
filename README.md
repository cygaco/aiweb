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

## Run the golden path

`npm run test:golden` runs three scripted scenarios (pizza-only, pizza-plus-side,
pizza-plus-drink) against both the MCP stdio surface and the A2A JSON-RPC surface.
The Bland.ai call is mocked via three independent guard layers — no real call dispatches.

**Command:**
```bash
npm run test:golden
# or target a single surface / scenario:
node scripts/harness/golden-path.js --surface mcp-stdio --scenario pizza-only
```

**Environment set automatically by the harness (before spawning any child):**
- `BLAND_API_KEY=""` — Layer 1: empty key so the connector's apiKey check fails
- `BLAND_HARNESS_MODE=1` — Layer 2: source short-circuit in `src/connectors/bland.ts`
- `SIM_FAST_FORWARD_MS=0` — fast sim_* status transitions (~3s per scenario)
- `INCLUDE_TEST_RESTAURANTS=true` — exposes the `test_vlad` fixture restaurant

**Exit codes:** 0 = all scenarios passed, 1 = one or more failed.

**Trace output:** `runtime/golden-runs/<ISO>.jsonl` (gitignored, one line per tool call).

**Add a new scenario:** drop a JSON file in `tests/golden-path-harness/scripts/` following
the shape in `pizza-only.json`, then pass `--scenario <your-id>` or add it to the
`VALID_SCENARIOS` list in `scripts/harness/golden-path.js`.

## Post-MVP

- [ ] Real restaurant discovery (Google Places API)
- [ ] Menu scraping (Playwright reads online menus)
- [ ] User identity / preferences (remember for next time)
- [ ] Live Bland webhooks (back-and-forth during call)
- [ ] Multiple connector types (API, Playwright, voice)
- [ ] Stripe MPP for card payments
- [ ] Deploy to Railway as hosted MCP server
