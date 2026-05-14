# Golden Path Harness

End-to-end harness for the pizza ordering MCP/A2A surfaces.

## Running the harness

```sh
# Full run — both surfaces, all scenarios
node scripts/harness/golden-path.js --surface all

# Single surface
node scripts/harness/golden-path.js --surface mcp-stdio
node scripts/harness/golden-path.js --surface a2a-jsonrpc

# Single scenario
node scripts/harness/golden-path.js --surface all --scenario pizza-only

# npm shortcut (all surfaces, all scenarios)
npm run test:golden
```

## Scenarios

Scenario JSON files live in `tests/golden-path-harness/scripts/`. Each file
describes a sequence of MCP tool calls (used by the MCP stdio surface) plus
top-level customer fields (used by the A2A surface via the adapter).

| File | Description |
|------|-------------|
| `pizza-only.json` | Meat lovers pizza, no sides or drinks |
| `pizza-plus-side.json` | Meat lovers + wings (8pc) |
| `pizza-plus-drink.json` | Meat lovers + Coke 20oz |

## Surface runners

**MCP stdio** (`runMcpStdioScenario`) — spawns `dist/stdio.js`, connects via
the `@modelcontextprotocol/sdk` client, and drives tool calls step-by-step per
the scenario's `steps[]` array.

**A2A JSON-RPC** (`runA2AScenario`) — spawns `dist/http.js` on a random port,
waits for `/healthz`, adapts the scenario into a single `message/send` payload
via `scripts/harness/adapters/a2a-intent.js`, dispatches it, and asserts the
final task state.

## Three-layer Bland guard

No real Bland call fires under any harness path:

1. **Layer 1** — `BLAND_API_KEY=""` set in harness env before any child spawns.
2. **Layer 2** — `BLAND_HARNESS_MODE=1` source short-circuit in
   `src/connectors/bland.ts` returns a `sim_*` callId immediately.
3. **Layer 3** — harness asserts every `place_order` callId starts with `sim_`.
   A violation aborts the run and exits 1 before any status poll.

Guard durability is enforced by `tests/golden-path-harness/guards.test.ts`
(runs under `npm test`).

## A2A adapter contract

`scripts/harness/adapters/a2a-intent.js` is a pure function:

```js
adapt(scenario) → { message, expectedTaskState }
```

**Inputs:** a scenario object as loaded from `tests/golden-path-harness/scripts/<name>.json`. Required fields: `customer_address`, `customer_name`, `customer_phone`, and one of `items` or `cart`.

**Outputs:**
- `message`: an A2A `message/send` payload with `role: "user"`, a fresh `messageId` (UUID), and a single `text` part whose body is the derived user-intent string.
- `expectedTaskState`: `"completed"` for happy-path scenarios; `"input-required"` when a scenario intentionally omits required fields to test that branch.

**Translation rules:**
1. Read `customer_address`, `customer_name`, `customer_phone` from the scenario root.
2. If `items` is set, format as `"I want <items joined with commas>"`.
3. Else if `cart` is set, format as `"My cart is <cart joined with commas, line items as 'qty x name'>"`.
4. Append `", delivered to <address>, customer <name>, phone <phone>, confirmed: true"`.
5. If `a2a_intent` override is present on the scenario, use it verbatim instead.

**Worked example:** see `pizza-only.json` → `"I want one cheese pizza, delivered to 123 Main St, customer Test User, phone +15555550100, confirmed: true"`.
