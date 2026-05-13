# PRD: Delivery Special Instructions

## 1. Title + Classification

**Delivery Special Instructions** — small feature / UX surfacing of existing field

## 2. Surface

- `src/server.ts` — `start_pizza_order` tool description (prompt guidance), `prepare_order` tool schema + body (accept + token-bind), `place_order` description (no schema change — already accepts the field)
- `src/connectors/bland.ts` — voice-prompt readback rule in the "BEFORE HANGING UP" block
- `src/a2a/executor.ts` — `OrderInput` already has `delivery_instructions`; echo it in `proposed_cart` artifact + pass it to `issueToken`
- `src/lib/confirmation-token.ts` — extend `TokenArgs` with optional `delivery_instructions`; hash into payload; verify on input
- `tests/confirmation-token.test.ts` (new or augmented) — token-binding cases for instructions
- `tests/special-instructions.test.ts` (new) — Bland prompt rendering + readback rule

## 3. Context

`delivery_instructions` is a field that already flows end-to-end:

- `src/server.ts:945` — `place_order` schema accepts `delivery_instructions` ("Gate code, apt number, 'leave at door', etc.")
- `src/server.ts:1148` — passed to `bland.ts` as `deliveryInstructions`
- `src/a2a/executor.ts:56` — A2A `OrderInput` accepts it
- `src/a2a/executor.ts:461` — passed to bland as `deliveryInstructions`
- `src/connectors/bland.ts:188` — rendered into the call prompt as: `- Special instructions: <wrapped>`
- `src/connectors/bland.ts:69-77` — sanitized via `wrapCustomerData()` (XML-escaped, control chars stripped) — prompt-injection safe.

But the field is invisible to the agent and the user:

1. **Agent doesn't ASK.** `start_pizza_order` tool description (9 entry points, ~80 lines) never tells Claude to ask about delivery instructions. So in practice, the field is never populated unless the user proactively volunteers it.
2. **Token doesn't bind it.** `prepare_order` (`src/server.ts:296`) does not accept `delivery_instructions`. The `confirmation_token` issued by `prepare_order` therefore does not bind it. A user could see a cart shown WITHOUT instructions, then have `place_order` called WITH instructions — the cart-show contract drifts. Same gap on the A2A path: `executor.ts:261` calls `issueToken` without `delivery_instructions`.
3. **A2A `proposed_cart` artifact omits it.** The artifact at `executor.ts:273-288` shows the cart, address, name, phone, total, payment — but not the instructions the user submitted. They have no way to verify the agent received them before confirming.
4. **Bland readback doesn't confirm them.** The "BEFORE HANGING UP" block in `bland.ts:203-208` instructs the AI to read back: order, address, total, ETA, "Thank you!" — instructions are mentioned ONCE during the order recital but never explicitly confirmed back.
5. (Out of scope) Profile-store has no structured `default_delivery_instructions` field (only freeform `notes`). Skip — see §8.

The user's YC-demo scenario is exactly the case that surfaces these gaps: testing from a parking lot with no street number, the demo only works if the agent prompts for, surfaces, and voices a special instruction like "deliver to the black F150 in the parking lot."

## 4. Goal

The agent reliably collects, surfaces, voices, and confirms a free-text delivery instruction across MCP and A2A surfaces, with the same cart-binding integrity as items/address.

## 5. Acceptance Criteria

1. **A1 — start_pizza_order description guides the agent to ask.** Tool description includes a one-line rule in the cart-flow section: after building cart, before `prepare_order`, ask the user once: *"Any special delivery instructions? (gate code, leave-at-door, vehicle to look for, etc.) — say no if none."* User can answer "no" / decline.
2. **A2 — prepare_order accepts `delivery_instructions`.** New optional schema field on `prepare_order` in `src/server.ts:301` (Zod string max 200 chars). When present, value is included in the issued token's binding (see A4).
3. **A3 — place_order accepts `delivery_instructions` and rejects token mismatch.** `place_order` already accepts the field (no schema change). When `confirmation_token` is present, `verifyToken` verifies the `delivery_instructions` value matches what was bound at `prepare_order` time. Drift returns `error_code: "confirmation_token_invalid"` with `reason: "delivery_instructions mismatch"`.
4. **A4 — confirmation-token payload binds instructions.** `TokenArgs` in `src/lib/confirmation-token.ts:7` gains optional `delivery_instructions?: string`. `TokenPayload` includes a `delivery_instructions_hash?: string` (SHA-256 hex of the raw value, omitted when value is empty/undefined). `issueToken` hashes when present; `verifyToken` recomputes and `safeEqual`-compares. Empty/undefined on issuance MUST equal empty/undefined on verification — null on both sides is OK; null on one side and value on the other is mismatch.
5. **A5 — A2A `proposed_cart` artifact echoes instructions.** When `executor.ts:273-288` emits the artifact, it includes a top-level `delivery_instructions` field (string or null) so the caller sees what the agent received. When the user resubmits with `confirmed:true`, instructions are bound by the issued token.
6. **A6 — A2A `issueToken` call passes instructions.** `executor.ts:261-272` and the second `verifyToken` block at `executor.ts:418-451` both include `delivery_instructions` in the args.
7. **A7 — Bland prompt voices instructions in readback.** In `bland.ts:203-208`, the "BEFORE HANGING UP" block gains a step (between current step 3 and 4): *"If special instructions were given, confirm them: e.g., 'And to confirm — that's [instructions], correct?'"* Only emitted when `order.deliveryInstructions` is non-empty (avoid voicing an empty-readback line).
8. **A8 — Length cap 200 chars.** Schema-enforced via Zod at MCP `prepare_order` AND `place_order` (place_order already has the field — add `.max(200)`). A2A executor truncates to 200 chars on read in `extractInput()` for defense in depth. Long-input rejection at MCP returns a Zod validation error; A2A truncates silently (consistent with how A2A handles other oversized fields).
9. **A9 — Sanitization preserved.** No new path bypasses `wrapCustomerData()`. The `delivery_instructions` value continues to flow through the existing XML-escape + control-strip in `bland.ts:58-67` before any prompt rendering.
10. **A10 — Idempotent re-confirmation.** A user who issues a `prepare_order` WITHOUT instructions, then issues a second `prepare_order` WITH instructions for the same cart, gets a fresh token. The first token is rejected by `place_order` (drift). The second token validates only when `delivery_instructions` matches at place-time.

## 6. Approach

### 6.1 — `src/server.ts` — tool description guidance

In the existing `start_pizza_order` description (~line 397), inside the "ADAPTIVE CART FLOW" block (~line 444-449), add ONE bullet:

> - **Before `prepare_order`**, ask once: "Any special delivery instructions? (gate code, leave-at-door, vehicle to look for, etc.) — say 'no' if none." Capture verbatim. Pass to `prepare_order` and `place_order` as `delivery_instructions`. Skip if user already volunteered them upstream.

In `start_pizza_order` description, "AFTER THE TOOL RETURNS" / "ORDER FLOW EXTENSION" lines (~line 456-458), update the flow to include the instruction step:

> ORDER FLOW EXTENSION: start_pizza_order → upsell turn → update_order(diff) → ask for special instructions → show full cart → user confirms → prepare_order → place_order.

`place_order` description (~line 892-907) — no change needed. Field is already documented there.

### 6.2 — `src/server.ts` — prepare_order schema + body

Add to `prepare_order` schema (~line 301-319):

```ts
delivery_instructions: z.string().max(200).optional()
  .describe("Free-text instructions for the driver (gate code, vehicle to look for, etc.). Bound into the token."),
```

In the body (~line 321-388), accept and pass through to `issueToken`:

```ts
const token = issueToken({
  // ... existing fields ...
  delivery_instructions,
});
```

Update the `next_step` message text to mention that instructions are now bound:

> Pass confirmation_token to place_order along with the same restaurant_id + cart/items + customer fields **+ delivery_instructions**. Modifying any of those will invalidate the token.

### 6.3 — `src/server.ts` — place_order length cap + verification

Add `.max(200)` to existing `delivery_instructions` schema field at server.ts:945-948.

In the `verifyToken` call at server.ts:1092-1101, include `delivery_instructions`:

```ts
const verdict = verifyToken(confirmation_token, {
  // ... existing fields ...
  delivery_instructions,
});
```

### 6.4 — `src/connectors/bland.ts` — readback rule

In the `BEFORE HANGING UP` block at `bland.ts:203-208`, between steps 3 and 4, add (only when instructions are present):

```ts
${order.deliveryInstructions ? `4. Confirm the special instructions back: "And just to confirm — ${wrapCustomerData("deliveryInstructionsReadback", order.deliveryInstructions)}, correct?"` : ""}
```

Renumber subsequent steps. (Step 4 → 5, step 5 → 6.) The wrap reuses the existing sanitizer.

### 6.5 — `src/a2a/executor.ts` — proposed_cart echo + token binding

At `executor.ts:261-272`, pass `input.delivery_instructions` into `issueToken`:

```ts
proposedToken = issueToken({
  // ... existing fields ...
  delivery_instructions: input.delivery_instructions,
});
```

At `executor.ts:273-288`, add `delivery_instructions` to the artifact data:

```ts
eventBus.publish(
  artifact(taskId, contextId, "proposed_cart", {
    // ... existing fields ...
    delivery_instructions: input.delivery_instructions ?? null,
  }),
);
```

At `executor.ts:419-427`, include in the second `verifyToken` call:

```ts
const verdict = verifyToken(input.confirmation_token, {
  // ... existing fields ...
  delivery_instructions: input.delivery_instructions,
});
```

In `extractInput()` (executor.ts:62-80), truncate to 200 chars for defense in depth:

```ts
if (typeof out.delivery_instructions === "string" && out.delivery_instructions.length > 200) {
  out.delivery_instructions = out.delivery_instructions.slice(0, 200);
}
```

### 6.6 — `src/lib/confirmation-token.ts` — payload binding

Extend `TokenArgs` (line 7-15):

```ts
export interface TokenArgs {
  // ... existing fields ...
  delivery_instructions?: string;
}
```

Extend `TokenPayload` (line 17-21):

```ts
interface TokenPayload extends Omit<TokenArgs, "items" | "cart"> {
  items_hash?: string;
  cart_hash?: string;
  delivery_instructions_hash?: string;  // omitted when args.delivery_instructions is empty/undefined
  ts: number;
}
```

Add a hash helper (next to `hashItems` and `hashCart`):

```ts
function hashInstructions(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return crypto.createHash("sha256").update(value).digest("hex");
}
```

In `issueToken()` (line 68-88), set `payload.delivery_instructions_hash = hashInstructions(args.delivery_instructions)`. Drop the field entirely from the payload object if undefined (to preserve existing token byte-shape when feature unused — preserves backward compat for tokens issued before this change).

In `verifyToken()` (line 92-131), after the existing `cart_hash`/`items_hash` block:

```ts
const expectedInstructionsHash = hashInstructions(args.delivery_instructions);
if ((payload.delivery_instructions_hash ?? null) !== (expectedInstructionsHash ?? null)) {
  return { ok: false, reason: "delivery_instructions mismatch" };
}
```

This treats "no instructions on issuance + no instructions on verification" as match. "Instructions on one side, none on the other" as mismatch. "Different instructions on each side" as mismatch.

## 7. Dependencies / Blockers

- None. Pure additions on top of existing fields. No DB migration. No new dependency.

## 8. Out of Scope

- **Profile-store persistence of `default_delivery_instructions`.** Vlad's YC demo is from a parking lot, not his usual address — a recurring instruction wouldn't help him. Defer to a future feature when there's evidence of repeat-customer instructions worth saving. (Existing `notes` freeform field can already hold them informally.)
- **Heuristic "should I ask?" detection** based on address shape (e.g., "if address contains 'parking lot', ask"). Brittle. The "always ask, optional" approach is simpler, more reliable for demo, and uniform.
- **Voice-side natural-language extraction** of instructions from a transcript. Bland prompt voices what we tell it; we don't currently parse instructions back from the transcript. Out of scope.
- **Restaurant-side instruction confirmation parsing.** We don't extract a "yes, the driver knows about the F150" signal from the transcript; we just instruct the AI to ask. Future work if false-confirmations become a real failure mode.
- **Multilingual instructions.** ASCII-ish freeform string only; we sanitize via existing `wrapCustomerData`.

## 9. Test Plan

### `tests/confirmation-token.test.ts` (new file or augment existing)

| # | Scenario | Expected |
|---|---|---|
| 1 | Issue + verify with no instructions on either side | `{ok: true}` |
| 2 | Issue with instructions, verify with same instructions | `{ok: true}` |
| 3 | Issue with instructions, verify with different instructions | `{ok: false, reason: "delivery_instructions mismatch"}` |
| 4 | Issue with instructions, verify with no instructions | `{ok: false, reason: "delivery_instructions mismatch"}` |
| 5 | Issue with no instructions, verify with instructions | `{ok: false, reason: "delivery_instructions mismatch"}` |
| 6 | Token expiry still triggers when instructions match | `{ok: false, reason: "token expired"}` |
| 7 | Backward compat: a token issued without `delivery_instructions_hash` (legacy) and verified with `delivery_instructions=undefined` | `{ok: true}` |

### `tests/special-instructions.test.ts` (new file)

| # | Scenario | Expected |
|---|---|---|
| 1 | `buildCallPrompt` with `deliveryInstructions: "leave at side door"` includes `"Special instructions: <customer_data...>leave at side door</customer_data>"` | substring present |
| 2 | `buildCallPrompt` with `deliveryInstructions: undefined` does NOT include the line | substring absent |
| 3 | `buildCallPrompt` with instructions includes a readback line in the BEFORE HANGING UP block referencing the instructions | substring present |
| 4 | `buildCallPrompt` without instructions does NOT include the readback line (avoid empty `correct?`) | substring absent |
| 5 | XML-escape: `deliveryInstructions: "</customer_data>"` becomes `&lt;/customer_data&gt;` in the rendered prompt | escaped |
| 6 | Length boundary: 201-char input rejected by Zod at MCP `prepare_order` | Zod throws / response error |
| 7 | A2A `extractInput` truncates 201-char input to 200 chars | length === 200 |

### Integration smoke

- `npm run build` succeeds (TypeScript types).
- `npm test` passes (Vitest).
- One manual A2A round-trip via `scripts/a2a-test/*` (or whatever the test client is) showing `proposed_cart` artifact contains `delivery_instructions`, then re-submitting with `confirmed:true` succeeds, AND re-submitting with mutated `delivery_instructions` is rejected with `confirmation_token rejected: delivery_instructions mismatch`.

## 10. Files Modified

| File | Change |
|---|---|
| `src/server.ts` | (a) `start_pizza_order` description: 1 bullet + 1 flow-line update. (b) `prepare_order` schema: add `delivery_instructions` (Zod max 200 optional) + body pass-through to `issueToken`. (c) `place_order` schema: add `.max(200)` to existing `delivery_instructions`. (d) `place_order` body: add `delivery_instructions` to `verifyToken` args. |
| `src/connectors/bland.ts` | Add a conditional readback line in the `BEFORE HANGING UP` block when `order.deliveryInstructions` is non-empty. |
| `src/a2a/executor.ts` | (a) `extractInput`: truncate `delivery_instructions` to 200 chars. (b) `issueToken` call: pass `delivery_instructions`. (c) `proposed_cart` artifact: include `delivery_instructions` field. (d) Second `verifyToken` call: pass `delivery_instructions`. |
| `src/lib/confirmation-token.ts` | (a) `TokenArgs` + `TokenPayload`: add optional `delivery_instructions` / `delivery_instructions_hash`. (b) `hashInstructions()` helper. (c) `issueToken`: set hash field when present. (d) `verifyToken`: compare hashes (treating undefined-on-both as match). |
| `tests/confirmation-token.test.ts` | New / augmented — 7 binding cases. |
| `tests/special-instructions.test.ts` | New — 7 prompt-rendering + length-cap cases. |

## 11. Critical Constraints

- **No new sanitization paths.** All `delivery_instructions` rendering MUST go through the existing `wrapCustomerData()` helper. Don't bypass; don't reimplement.
- **Backward-compat tokens.** A token issued by code older than this change (no `delivery_instructions_hash` field in payload) MUST verify successfully when `args.delivery_instructions` is empty/undefined. Achieved by treating missing-on-both-sides as a match. Do NOT add a "v2" token format flag — the addition is silently backward-compatible.
- **No mutation of the field.** `delivery_instructions` is stored verbatim in `place_order`/`prepare_order` args, hashed verbatim in tokens, and rendered verbatim in the Bland prompt (after `wrapCustomerData` sanitization). No casing changes, no trim, no normalization.
- **Length cap is hard.** Zod `.max(200)` at MCP boundary is the contract. A2A truncates silently to match. Bland prompt should never receive >200-char input.
- **Readback ergonomics.** Voice readback line MUST NOT fire on empty/undefined instructions — emitting `"And just to confirm — , correct?"` would be a demo-killing UX bug.
- **Skip profile persistence.** Out of scope. Don't add fields to `UserProfile`. Don't migrate the DB.

## 12. Why now / YC demo context

User is applying to YC. Demoing the pizza concierge from a parking lot in town because he lives in the middle of nowhere. The "deliver to the black F150 in the parking lot" scenario is the showcase moment — it proves the agent handles real-world weirdness. The plumbing already supports it; what's missing is the AGENT being told to ask, the USER seeing the instruction in their cart confirmation, and the RESTAURANT confirming it back on the call. Those three are the demo-critical pieces. Token-binding is bundled because the binding pattern is already established and adding one field is ~10 lines.
