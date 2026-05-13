/**
 * Order presets and smart defaults.
 * The "intelligence layer" for MVP — hardcoded research-backed data.
 *
 * Source: Pizza ordering research (AI_Pizza_Ordering_Agent_Research.pdf)
 * - 64-67% prefer pepperoni
 * - 3/8 rule for group sizing
 * - 70/30 rule for kids parties
 * - 59% view wings as ultimate pizza pairing on game day
 *
 * Sizes and prices are NEVER hardcoded — they are read from the chosen
 * restaurant's menu via pickSizeForPizza(). When a preset can't be fulfilled
 * by a given restaurant (pizza missing, size missing), the helpers return
 * null and the caller decides recovery (skip, surface as unavailable, etc.).
 */

import type { OrderItem } from "../connectors/bland.js";
import type { Restaurant } from "../data/restaurants.js";

export type SizePreference = "small" | "medium" | "large";

export interface Preset {
  id: string;
  label: string;
  description: string;
  occasion: string;
  needsHeadcount: boolean;
  items: (restaurant: Restaurant, headcount?: number) => OrderItem[];
  suggestedSides?: (restaurant: Restaurant, headcount?: number) => OrderItem[];
  /**
   * Estimate the total of this preset against a chosen restaurant.
   *
   * Returns `null` on restaurants whose `menuSource` is generic — i.e.
   * neither a `test_*` / `dominos_*` fixture nor an enriched Places entry
   * tagged `menuSource: 'restaurant_website'`. Generic-template prices
   * are not evidence; surfacing a synthesized total from them is the
   * exact dishonesty SP-20260512-002 closes.
   * SP-20260512-002 S-14 / R-7.
   */
  estimateTotal: (restaurant: Restaurant, headcount?: number) => number | null;
}

/**
 * A preset's `estimateTotal` is only meaningful for restaurants whose
 * `menu.*.sizes[].price` is real-menu evidence:
 *  - `test_*` / `dominos_*` ids — hand-curated or API-sourced.
 *  - `places_*` ids tagged `menuSource === 'restaurant_website'` — enriched.
 * Everything else gets a `null` total; the agent narrates "I'll get you the
 * exact total on the call" (C-2).
 */
function restaurantHasRealPrices(restaurant: Restaurant): boolean {
  if (restaurant.id.startsWith("test_")) return true;
  if (restaurant.id.startsWith("dominos_")) return true;
  if (restaurant.menuSource === "restaurant_website") return true;
  return false;
}

/**
 * Pick a size for a named pizza on a given restaurant.
 *
 * - Exact name match (case-insensitive) preferred.
 * - Fuzzy fallback: requested name appears in menu name, or vice versa.
 *   First match wins (deterministic by menu order).
 * - Size matched by label substring against the preference token.
 * - Returns null when pizza or size is missing — NO silent fallback.
 *   Caller decides recovery.
 */
export function pickSizeForPizza(
  restaurant: Restaurant,
  pizzaName: string,
  preference: SizePreference,
): { sizeLabel: string; price: number } | null {
  const normalize = (s: string) => s.toLowerCase().trim();
  const target = normalize(pizzaName);

  let pizza = restaurant.menu.pizzas.find((p) => normalize(p.name) === target);

  if (!pizza) {
    pizza = restaurant.menu.pizzas.find((p) => {
      const n = normalize(p.name);
      return n.includes(target) || target.includes(n);
    });
  }

  if (!pizza) return null;

  const prefLower = preference.toLowerCase();
  const size = pizza.sizes.find((s) =>
    s.name.toLowerCase().includes(prefLower),
  );
  if (!size) return null;

  return { sizeLabel: size.name, price: size.price };
}

/**
 * Pick a side by name. Returns the first available size by default
 * (sides typically have one size — "Regular").
 */
function pickSide(
  restaurant: Restaurant,
  sideName: string,
): { sizeLabel: string; price: number } | null {
  const normalize = (s: string) => s.toLowerCase().trim();
  const target = normalize(sideName);

  const side =
    restaurant.menu.sides.find((s) => normalize(s.name) === target) ??
    restaurant.menu.sides.find((s) => {
      const n = normalize(s.name);
      return n.includes(target) || target.includes(n);
    });

  if (!side || side.sizes.length === 0) return null;
  return { sizeLabel: side.sizes[0].name, price: side.sizes[0].price };
}

/**
 * Build an OrderItem for a named pizza, or an "unavailable" placeholder
 * line that the caller can filter or surface to the user.
 */
function pizzaItem(
  restaurant: Restaurant,
  name: string,
  preference: SizePreference,
  qty: number,
  substitution?: string,
): OrderItem | null {
  const picked = pickSizeForPizza(restaurant, name, preference);
  if (!picked) return null;
  return {
    name,
    size: picked.sizeLabel,
    quantity: qty,
    price: picked.price,
    substitution,
  };
}

function sideItem(
  restaurant: Restaurant,
  name: string,
  qty: number,
): OrderItem | null {
  const picked = pickSide(restaurant, name);
  if (!picked) return null;
  return {
    name,
    size: picked.sizeLabel,
    quantity: qty,
    price: picked.price,
  };
}

/**
 * Calculate pizzas needed using the 3/8 rule.
 * p = ceil((adults × 3 + teens × 3.5 + kids × 1.5) / 8)
 */
export function pizzasNeeded(
  adults: number,
  teens: number = 0,
  kids: number = 0,
): number {
  const slices = adults * 3 + teens * 3.5 + kids * 1.5;
  return Math.ceil(slices / 8);
}

/**
 * Compute the total price of an OrderItem array.
 */
function totalOf(items: OrderItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

/**
 * Default substitution name lookup — used by orderFromIntent.
 */
const STYLE_TO_NAME: Record<string, string> = {
  meat_lovers: "Meat Lovers",
  "meat lovers": "Meat Lovers",
  meaty: "Meat Lovers",
  heavy_meat: "Meat Lovers",
  veggie: "Veggie",
  vegetable: "Veggie",
  healthy: "Veggie",
  cheese: "Cheese",
  plain: "Cheese",
  supreme: "Supreme",
  everything: "Supreme",
  pepperoni: "Pepperoni",
};

const STYLE_TO_SUBSTITUTION: Record<string, string | undefined> = {
  "Meat Lovers": "pepperoni",
  Veggie: "cheese",
  Cheese: undefined,
  Supreme: "pepperoni",
  Pepperoni: "sausage",
};

/**
 * Cold user presets — shown when we don't know the user.
 * Each preset's items()/suggestedSides()/estimateTotal() takes a Restaurant
 * and reads sizes/prices from that restaurant's menu.
 */
export const COLD_PRESETS: Preset[] = [
  {
    id: "quick_pepperoni",
    label: "Large pepperoni",
    description: "#1 pick — 64% of people choose this",
    occasion: "default",
    needsHeadcount: false,
    items: (restaurant) => {
      const item = pizzaItem(restaurant, "Pepperoni", "large", 1, "sausage");
      return item ? [item] : [];
    },
    estimateTotal: (restaurant) => {
      if (!restaurantHasRealPrices(restaurant)) return null;
      const items = COLD_PRESETS[0].items(restaurant);
      return totalOf(items);
    },
  },
  {
    id: "game_day",
    label: "Game day",
    description: "Meat-heavy pizzas + wings for the crew",
    occasion: "game_day",
    needsHeadcount: true,
    items: (restaurant, headcount = 6) => {
      const count = pizzasNeeded(headcount);
      const meatCount = Math.ceil(count / 2);
      const pepCount = count - meatCount;
      const out: OrderItem[] = [];
      if (meatCount > 0) {
        const item = pizzaItem(
          restaurant,
          "Meat Lovers",
          "large",
          meatCount,
          "pepperoni",
        );
        if (item) out.push(item);
      }
      if (pepCount > 0) {
        const item = pizzaItem(
          restaurant,
          "Pepperoni",
          "large",
          pepCount,
          "sausage",
        );
        if (item) out.push(item);
      }
      return out;
    },
    suggestedSides: (restaurant, headcount = 6) => {
      const wingOrders = Math.ceil((headcount ?? 6) / 4);
      const item = sideItem(restaurant, "Wings", wingOrders);
      return item ? [item] : [];
    },
    estimateTotal: (restaurant, headcount = 6) => {
      if (!restaurantHasRealPrices(restaurant)) return null;
      const items = COLD_PRESETS[1].items(restaurant, headcount);
      const sides = COLD_PRESETS[1].suggestedSides
        ? COLD_PRESETS[1].suggestedSides(restaurant, headcount)
        : [];
      return totalOf(items) + totalOf(sides);
    },
  },
  {
    id: "kids_party",
    label: "Kids party",
    description: "Cheese + pepperoni, simple and safe",
    occasion: "kids_party",
    needsHeadcount: true,
    // 70/30 rule: 70% cheese, 30% pepperoni
    items: (restaurant, headcount = 8) => {
      const count = pizzasNeeded(0, 0, headcount);
      const cheeseCount = Math.max(1, Math.ceil(count * 0.7));
      const pepCount = Math.max(1, count - cheeseCount);
      const out: OrderItem[] = [];
      const cheese = pizzaItem(
        restaurant,
        "Cheese",
        "large",
        cheeseCount,
        undefined,
      );
      if (cheese) out.push(cheese);
      const pep = pizzaItem(
        restaurant,
        "Pepperoni",
        "large",
        pepCount,
        "sausage",
      );
      if (pep) out.push(pep);
      return out;
    },
    estimateTotal: (restaurant, headcount = 8) => {
      if (!restaurantHasRealPrices(restaurant)) return null;
      const items = COLD_PRESETS[2].items(restaurant, headcount);
      return totalOf(items);
    },
  },
  {
    id: "office_lunch",
    label: "Office lunch",
    description: "Variety + salads, crowd-pleasing",
    occasion: "office_lunch",
    needsHeadcount: true,
    items: (restaurant, headcount = 10) => {
      // Office: 1-2 slices/person, variety
      const count = Math.ceil((headcount * 2) / 8);
      const pepCount = Math.ceil(count * 0.3);
      const cheeseCount = Math.ceil(count * 0.3);
      const veggieCount = Math.max(1, count - pepCount - cheeseCount);
      const out: OrderItem[] = [];
      const pep = pizzaItem(
        restaurant,
        "Pepperoni",
        "large",
        pepCount,
        "sausage",
      );
      if (pep) out.push(pep);
      const cheese = pizzaItem(
        restaurant,
        "Cheese",
        "large",
        cheeseCount,
        undefined,
      );
      if (cheese) out.push(cheese);
      const veggie = pizzaItem(
        restaurant,
        "Veggie",
        "large",
        veggieCount,
        "cheese",
      );
      if (veggie) out.push(veggie);
      return out;
    },
    suggestedSides: (restaurant, headcount = 10) => {
      const saladCount = Math.ceil((headcount ?? 10) / 5);
      const item = sideItem(restaurant, "Salad", saladCount);
      return item ? [item] : [];
    },
    estimateTotal: (restaurant, headcount = 10) => {
      if (!restaurantHasRealPrices(restaurant)) return null;
      const items = COLD_PRESETS[3].items(restaurant, headcount);
      const sides = COLD_PRESETS[3].suggestedSides
        ? COLD_PRESETS[3].suggestedSides(restaurant, headcount)
        : [];
      return totalOf(items) + totalOf(sides);
    },
  },
];

/**
 * Build a simple order from intent signals against a chosen restaurant.
 * Used when the user specifies what they want (e.g. "meat lovers").
 *
 * `intent.size` accepts the preference token "small" | "medium" | "large".
 * For backward-compat with callers that pass a literal label like
 * 'Large 14"', we extract the preference token from the label.
 */
export function orderFromIntent(
  restaurant: Restaurant,
  intent: {
    style?: string;
    size?: string;
    quantity?: number;
  },
): OrderItem[] {
  const preference = parsePreference(intent.size);
  const qty = intent.quantity ?? 1;

  const styleKey = (intent.style ?? "pepperoni").toLowerCase();
  const pizzaName = STYLE_TO_NAME[styleKey] ?? "Pepperoni";
  const substitution = STYLE_TO_SUBSTITUTION[pizzaName];

  const item = pizzaItem(restaurant, pizzaName, preference, qty, substitution);
  return item ? [item] : [];
}

/**
 * Extract a SizePreference from an arbitrary input string.
 * - "small" / "medium" / "large" → matched directly
 * - 'Large 14"' / 'Medium 12"' → matched by substring
 * - undefined / unrecognized → defaults to "large"
 */
function parsePreference(raw?: string): SizePreference {
  if (!raw) return "large";
  const lower = raw.toLowerCase();
  if (lower.includes("small")) return "small";
  if (lower.includes("medium")) return "medium";
  if (lower.includes("large")) return "large";
  return "large";
}
