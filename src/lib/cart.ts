/**
 * Shared cart / menu domain model.
 *
 * Source of truth for what a pizza order looks like. The Bland connector
 * (src/connectors/bland.ts) renders from these types; it does not own them.
 * The MCP server, the A2A executor, and the webapp chat all converge on
 * this module.
 *
 * Schema is grounded in chain research:
 *   _docs/research/chain-menus/SAMPLES.md
 *
 * Common ontology across Domino's, Pizza Hut, Papa John's:
 * - Pizza configurator: { size, crust, sauce, cheese, toppings[] }
 * - Toppings: { name, placement: whole|left|right, amount: normal|extra|double }
 * - Dipping sauces: separate SKUs ($0.75–$0.99), never bundled by default
 * - Drinks: { brand, sizes[20oz|2L], count }
 * - Deals: 3-bucket taxonomy — mix_match | bundle | discount
 * - Crust: per-crust upcharge; Papa John's needs priceMatrix[crust][size]
 *
 * All new fields are optional so existing TEST_RESTAURANTS keep working
 * without schema edits.
 */

import type { FoodMenuAttributes } from "./menu-taxonomy.js";

// -----------------------------------------------------------------------------
// Modifiers
// -----------------------------------------------------------------------------

/**
 * A single selectable option within a ModifierGroup (crust, topping, sauce…).
 */
export interface Modifier {
  id: string;
  name: string;
  /** Price added to the line when selected. 0 for free options. */
  priceDelta: number;
  /** True if this option is pre-selected when the user doesn't choose. */
  default?: boolean;
  /** Sizes for which this option is valid. Omit = all sizes. */
  validSizeIds?: string[];
  /** Tier flag — premium crusts vs. base crusts. */
  tier?: "base" | "premium";
}

/**
 * A group of modifiers presented together (e.g. "Crust", "Add toppings").
 */
export interface ModifierGroup {
  id: string;
  label: string;
  modifiers: Modifier[];
  /** "one" = radio (single-select); "many" = checkbox (multi-select). */
  selection: "one" | "many";
  /** Cap on the number of selections when selection = "many". */
  max?: number;
  /** True if the user MUST select something. */
  required?: boolean;
}

/**
 * Topping placement on a pizza. Half-pizza orders use left/right.
 * Default is "whole".
 */
export type ToppingPlacement = "whole" | "left" | "right";

/**
 * Topping amount intensity. Domino's supports "double"; some chains stop at
 * "extra". Modeled as an open string union so we can accept chain-specific
 * vocabularies in adapter output.
 */
export type ToppingAmount = "normal" | "extra" | "double" | "light";

/**
 * One concrete modifier selection on a cart line.
 * Pizza toppings carry placement + amount; other modifiers omit them.
 */
export interface SelectedModifier {
  groupId: string;
  optionId: string;
  /** Display name at time of order (preserves history if menu changes). */
  name: string;
  /** Price delta applied to the cart line. */
  priceDelta: number;
  /** Pizza-only: where on the pie. Default "whole". */
  placement?: ToppingPlacement;
  /** Pizza-only: intensity. Default "normal". */
  amount?: ToppingAmount;
  /** For dipping sauces and other repeatable add-ons. */
  quantity?: number;
}

// -----------------------------------------------------------------------------
// Menu shapes
// -----------------------------------------------------------------------------

/**
 * Pricing for a pizza by (crust × size) — Papa John's needs this; flat-rate
 * chains can express the same shape with a single crustId default and a
 * single price entry per size.
 */
export interface PriceMatrix {
  /** crustId → sizeId → price */
  [crustId: string]: { [sizeId: string]: number };
}

/**
 * A pizza menu item. Extends the existing MenuItem (sizes[]) with the
 * optional configurator groups and the per-(crust × size) price matrix.
 *
 * Existing TEST_RESTAURANTS use only the inherited `sizes[]` and pay no
 * cost for the extension — every new field is optional.
 */
export interface PizzaMenuItem {
  name: string;
  /** Default sizes (used when priceMatrix is absent). */
  sizes: { id?: string; name: string; price: number }[];
  description?: string;

  crusts?: ModifierGroup;
  toppings?: ModifierGroup;
  /** Single-select base sauce. */
  sauce_options?: ModifierGroup;
  /** Cheese variant or amount group. */
  cheese_options?: ModifierGroup;
  /** Dipping sauces sold alongside the pizza (still separate SKUs). */
  dipping_sauces?: ModifierGroup;

  /** Per-(crust × size) pricing. Overrides sizes[].price when present. */
  priceMatrix?: PriceMatrix;
}

/**
 * Drink type. Extends FoodMenuAttributes (R-8 / SP-20260517-005) with
 * optional allergen / dietaryRestriction / spiciness / preparation /
 * ingredients fields aligned with Google FoodMenu.
 */
export interface Drink extends FoodMenuAttributes {
  id: string;
  name: string;
  brand?: string;
  /**
   * Size price entries. `priceKnown` (R-2 / S-5) — see MenuItem.sizes
   * for semantics. Absent ≡ true (back-compat).
   */
  sizes: { id: string; name: string; price: number; priceKnown?: boolean }[];
}

/**
 * Display-only drink default. NO id, NO price — cart math cannot accept this
 * shape (see legacyItemsToCart / cartTotal signatures). Surfaced at
 * customization time with menu_confidence = "medium" | "low".
 */
export interface DrinkOption {
  name: string;
  brand?: string;
  sizes?: { name: string }[];
  menu_confidence: "medium" | "low";
}

/**
 * Display-only side default — analogous to DrinkOption. No id, no price.
 */
export interface SideOption {
  name: string;
  sizes?: { name: string }[];
  menu_confidence: "medium" | "low";
}

/**
 * A component of a deal. Constrains what the user can select for that slot
 * (e.g. "1 medium 1-topping pizza", "any side from breadsticks/wings").
 */
export interface DealComponent {
  kind: "pizza" | "drink" | "side";
  /** Free-form constraints — schema is intentionally loose here because
   *  chain-specific deal shapes vary widely. Adapters fill this in. */
  constraints: Record<string, unknown>;
}

/**
 * A deal pricing rule. Three-bucket taxonomy synthesized from the research:
 * - mix_match: pick N items at $X each (Mix & Match, Papa Pairings)
 * - bundle: fixed components at a fixed total (Perfect Combo, Big Dinner Box)
 * - discount: % or $ off applied at item or order level (BOGO, Wings Wed)
 */
export type DealPriceRule =
  | { kind: "per_item_fixed"; perItemPrice: number; minItems?: number }
  | { kind: "total_fixed"; totalPrice: number }
  | {
      kind: "percent_off";
      percent: number;
      appliesTo: "item" | "order";
    }
  | {
      kind: "dollar_off";
      amount: number;
      appliesTo: "item" | "order";
    };

export interface Deal {
  id: string;
  name: string;
  description: string;
  /** Optional coupon code if the deal requires one. */
  code?: string;
  type: "mix_match" | "bundle" | "discount";
  components: DealComponent[];
  priceRule: DealPriceRule;
  /** When omitted, applies to all restaurants offering this deal. */
  applies_to_restaurant_ids?: string[];
  expires_at?: string;
}

// -----------------------------------------------------------------------------
// Cart
// -----------------------------------------------------------------------------

/**
 * One line of the cart. The `kind` discriminator drives which fields apply.
 *
 * Pizza:    sizeId/sizeLabel set, modifiers array carries crust/toppings/etc.
 * Drink:    sizeId/sizeLabel set, modifiers usually empty.
 * Side:     sizeId/sizeLabel set, modifiers carry flavor/style choices.
 * Deal:     basePrice = total deal price; components[] enumerates what's in
 *           the deal (each component is itself a cart-line spec — pizza/drink/side).
 */
export interface CartItem {
  kind: "pizza" | "drink" | "side" | "deal";
  /** Stable id from the restaurant's menu (or deal id for kind=deal). */
  itemId: string;
  /** Display name at time of order. */
  name: string;
  /** Size selection id. Omitted for `kind="deal"` (size is on each component). */
  sizeId?: string;
  /** Display label like 'Large 14"'. */
  sizeLabel?: string;
  quantity: number;
  /** Base price of this line BEFORE modifier deltas. For deals, the total. */
  basePrice: number;
  /** Selected modifiers (crust, toppings, sauce, cheese, dipping sauce…). */
  modifiers?: SelectedModifier[];
  /** What to do if unavailable. */
  substitution?: string;
  /** Free-text notes for the call agent (e.g. "well done"). */
  notes?: string;
  /** For kind="deal": the components fulfilling each deal slot. */
  components?: Array<{
    kind: "pizza" | "drink" | "side";
    itemId: string;
    name: string;
    sizeId?: string;
    sizeLabel?: string;
    modifiers?: SelectedModifier[];
  }>;
}

export type Cart = CartItem[];

// -----------------------------------------------------------------------------
// Pricing
// -----------------------------------------------------------------------------

/**
 * Compute the total price of a single cart line including modifiers.
 * For deals, basePrice is taken as the total (deals have their own price rule).
 */
export function lineTotal(item: CartItem): number {
  if (item.kind === "deal") {
    return item.basePrice * item.quantity;
  }
  const modifierTotal = (item.modifiers ?? []).reduce(
    (sum, m) => sum + m.priceDelta * (m.quantity ?? 1),
    0,
  );
  return (item.basePrice + modifierTotal) * item.quantity;
}

/**
 * Compute the subtotal of a cart.
 */
export function cartTotal(cart: Cart): number {
  return cart.reduce((sum, item) => sum + lineTotal(item), 0);
}

/**
 * Stable hash-friendly serialization of a cart. Matches the existing
 * confirmation-token binding behavior — order of fields and array order
 * matters; modifiers are sorted by groupId then optionId for determinism.
 */
export function canonicalizeCart(cart: Cart): unknown {
  return cart.map((item) => ({
    kind: item.kind,
    itemId: item.itemId,
    name: item.name,
    sizeId: item.sizeId,
    sizeLabel: item.sizeLabel,
    quantity: item.quantity,
    basePrice: item.basePrice,
    modifiers: (item.modifiers ?? [])
      .slice()
      .sort((a, b) =>
        a.groupId === b.groupId
          ? a.optionId.localeCompare(b.optionId)
          : a.groupId.localeCompare(b.groupId),
      ),
    substitution: item.substitution,
    notes: item.notes,
    components: item.components,
  }));
}
