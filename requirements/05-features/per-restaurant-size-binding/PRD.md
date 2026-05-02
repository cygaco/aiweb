# PRD: Per-Restaurant Size Binding

## 1. Title + Classification

**Per-Restaurant Size Binding** — bug fix / small feature

## 2. Surface

- `src/lib/presets.ts` (preset functions + new helper)
- `src/server.ts` (start_pizza_order handler call site)
- `src/a2a/executor.ts` (A2A executor call sites)
- `tests/preset-restaurant-binding.test.ts` (new)

## 3. Context

`src/lib/presets.ts:121–202` literally writes `"Large 14\""` into every preset call:

```ts
items: () => [pepperoni("Large 14\"", 12.99)],
```

The data model already supports per-restaurant sizes — `Restaurant.menu.pizzas[i].sizes[]` holds `{ name, price }` pairs (see `src/data/restaurants.ts:10–14, 47–55`). But no code path consults it. So when a local restaurant's "Large" is 16", the Bland call still says "Large 14"" — the wrong inches go to the voice agent.

This bug affects all three surfaces (MCP server, A2A executor, webapp chat) because all three converge on the shared preset functions and `OrderItem` shape in `src/connectors/bland.ts`.

## 4. Goal

Sizes and prices in every cart line reflect the actual chosen restaurant's menu, not a hardcoded literal.

## 5. Acceptance Criteria

1. **A1.** `pickSizeForPizza(restaurant, "Pepperoni", "large")` returns `{ name, price }` from that restaurant's actual `Pepperoni.sizes[]`.
2. **A2.** When the chosen restaurant's Pepperoni Large is 16" / $14.99, the resulting `OrderItem.size` is `"Large 16\""` and `OrderItem.price` is `14.99`.
3. **A3.** When the requested pizza name doesn't exist on the restaurant's menu, `pickSizeForPizza` returns `null` (no silent fallback). Caller emits an `unavailable` cart line.
4. **A4.** When the pizza exists but the requested preference ("small"/"medium"/"large") doesn't match any size label, `pickSizeForPizza` returns `null`. Caller decides.
5. **A5.** Fuzzy name match: "Pepperoni" matches "Classic Pepperoni" (case-insensitive substring or normalized match). Document the match algorithm; first match wins on ties.
6. **A6.** All four COLD_PRESETS (`quick_pepperoni`, `game_day`, `kids_party`, `office_lunch`) take a `Restaurant` argument and emit cart lines whose sizes/prices come from that restaurant's menu.
7. **A7.** `orderFromIntent()` takes a `Restaurant` argument and resolves sizes against that restaurant's menu.
8. **A8.** Cross-surface: MCP `start_pizza_order` handler (`src/server.ts`) and A2A executor (`src/a2a/executor.ts:213–225, 330–342`) both pipe their already-resolved `restaurant` into preset calls.
9. **A9.** Snapshot test: `buildCallPrompt()` for Vlad's (14") vs. a synthetic restaurant with 16" produces visibly different size strings in the prompt.

## 6. Approach

### New helper

```ts
// src/lib/presets.ts
import type { Restaurant, MenuItem } from "../data/restaurants.js";

export function pickSizeForPizza(
  restaurant: Restaurant,
  pizzaName: string,
  preference: "small" | "medium" | "large",
): { sizeLabel: string; price: number } | null {
  const normalize = (s: string) => s.toLowerCase().trim();
  const target = normalize(pizzaName);

  // Exact match first
  let pizza = restaurant.menu.pizzas.find(
    (p) => normalize(p.name) === target,
  );

  // Fuzzy: target is a substring of menu name, or vice versa
  if (!pizza) {
    pizza = restaurant.menu.pizzas.find(
      (p) =>
        normalize(p.name).includes(target) ||
        target.includes(normalize(p.name)),
    );
  }

  if (!pizza) return null;

  // Match size by label containing the preference token
  const prefLower = preference.toLowerCase();
  const size = pizza.sizes.find((s) => s.name.toLowerCase().includes(prefLower));
  if (!size) return null;

  return { sizeLabel: size.name, price: size.price };
}
```

### Preset refactor

Each helper (`pepperoni`, `cheese`, `meatLovers`, `veggie`, etc.) now takes `(restaurant, preference, qty)`:

```ts
function pepperoni(
  restaurant: Restaurant,
  preference: "small" | "medium" | "large" = "large",
  qty: number = 1,
): OrderItem | null {
  const picked = pickSizeForPizza(restaurant, "Pepperoni", preference);
  if (!picked) return null;
  return {
    name: "Pepperoni",
    size: picked.sizeLabel,
    quantity: qty,
    price: picked.price,
    substitution: "sausage",
  };
}
```

Each `Preset.items()` becomes `(restaurant: Restaurant, headcount?: number) => OrderItem[]`. Same for `suggestedSides`, `estimateTotal`. Drop the hardcoded prices entirely (read from menu). When a helper returns `null` (pizza unavailable on this restaurant), the preset emits a placeholder `OrderItem` with `name: "<unavailable: pepperoni>"`, `size: "n/a"`, `price: 0`, `quantity: 0` — caller filters or surfaces.

### `orderFromIntent` refactor

```ts
export function orderFromIntent(
  restaurant: Restaurant,
  intent: { style?: string; size?: string; quantity?: number },
): OrderItem[];
```

The `size` parameter accepts `"small"|"medium"|"large"` (preference, not literal).

### Call site updates

In `src/server.ts` start_pizza_order handler — both call sites that today invoke `orderFromIntent({...})` and `COLD_PRESETS[i].items(headcount)` get passed the resolved restaurant:

```ts
const restaurant = restaurants[0]; // or whichever is chosen
const items = orderFromIntent(restaurant, { style, size, quantity });
// or
const items = COLD_PRESETS.find(...)?.items(restaurant, headcount) ?? [];
```

In `src/a2a/executor.ts:213–225` and `:330–342`, same pattern — both already have `restaurant` resolved.

## 7. Dependencies / Blockers

- None. No schema change required.

## 8. Out of Scope

- Schema changes to `MenuItem` or `Restaurant` (those land in W4).
- Modifier/drink/deal support (W4–W6).
- Bland prompt rendering changes (just consumes the new sizes via the unchanged `OrderItem.size` field).
- Webapp surface changes — the webapp calls MCP tools; no parallel preset code there.

## 9. Test Plan

`tests/preset-restaurant-binding.test.ts`:

1. `pickSizeForPizza` exact name + exact size → returns correct `{sizeLabel, price}`
2. `pickSizeForPizza` fuzzy name ("Pepperoni" ↔ "Classic Pepperoni") → returns correct value
3. `pickSizeForPizza` missing pizza → returns `null` (no fallback)
4. `pickSizeForPizza` missing size → returns `null` (no fallback)
5. `pickSizeForPizza` ambiguous: multiple pizzas match fuzzy → returns first-match deterministically
6. `quick_pepperoni` preset against Vlad's (Large 14"/$12.99) emits one OrderItem with that size+price
7. `quick_pepperoni` preset against synthetic restaurant (Large 16"/$14.99) emits OrderItem with that size+price (different from #6)
8. `game_day` preset against Vlad's emits expected mix (meat lovers + pepperoni at Vlad's prices)
9. `orderFromIntent(restaurant, { style: "veggie", size: "large" })` returns OrderItem with restaurant's Veggie Large size+price
10. `orderFromIntent` with unknown style defaults to pepperoni (existing behavior preserved)
11. Snapshot: `buildCallPrompt()` output for `quick_pepperoni` × Vlad's vs × synthetic — diff exists, includes the inches difference

## 10. Files Modified

| File | Change |
|---|---|
| `src/lib/presets.ts` | Add `pickSizeForPizza`; refactor all preset/intent functions to take `Restaurant` |
| `src/server.ts` | Pipe resolved `restaurant` into preset/intent calls in `start_pizza_order` handler |
| `src/a2a/executor.ts` | Pipe resolved `restaurant` into preset/intent calls (lines ~213–225 and ~330–342) |
| `tests/preset-restaurant-binding.test.ts` | New, ~11 cases per the test plan |

## 11. Critical Constraints

- **Do NOT change `OrderItem` shape.** That's W4's territory.
- **Do NOT modify `Restaurant` or `MenuItem` interfaces.** Schema change is W4.
- **Do NOT touch `src/connectors/bland.ts`** — `buildCallPrompt` consumes the unchanged `OrderItem.size` string. Sizes flow through unchanged.
- **No silent fallback to "largest"** — always fail-explicit when match fails. Caller decides recovery.
- **Existing test fixtures must keep passing** — Vlad's hardcoded menu should still work.
