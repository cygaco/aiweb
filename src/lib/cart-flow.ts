import type { MenuItem, Restaurant } from "../data/restaurants.js";
import { PIZZA_CUISINE_DEFAULTS } from "../data/restaurants.js";
import { brandToPortfolio, type PortfolioId } from "./brand-portfolios.js";
import {
  cartTotal,
  type Cart,
  type CartItem,
  type Deal,
  type DealComponent,
  type Drink,
  type DrinkOption,
  type ModifierGroup,
  type SelectedModifier,
  type SideOption,
} from "./cart.js";
import { logCustomizationSurfaceEvent } from "./event-log.js";

/**
 * Surface-emitted shape: a real Drink stamped with high-confidence at the
 * boundary. NOT a new domain type — exists so the narration contract
 * ("each item carries menu_confidence") holds for high-confidence entries.
 */
export type SurfaceDrink = Drink & { menu_confidence: "high" };

/**
 * Surface-emitted shape: a real side MenuItem stamped with high-confidence.
 */
export type SurfaceSide = MenuItem & { menu_confidence: "high" };

export interface LegacyOrderItem {
  name: string;
  size: string;
  quantity: number;
  price: number;
  substitution?: string;
}

export interface PizzaCustomizationOptions {
  crusts?: ModifierGroup;
  toppings?: ModifierGroup;
  sauce_options?: ModifierGroup;
  cheese_options?: ModifierGroup;
  dipping_sauces?: ModifierGroup;
}

/**
 * Surface-emitted deal discriminator (SP-20260512-002 R-10).
 *
 * `match === 'components_align'` iff `dealComponentsMatchCart(deal, cart)` is
 * true AND `dealSavings.verified` is true. Otherwise `match === 'page_only'`
 * — agents must speak "they have a deals page — I'll ask about specifics on
 * the call" instead of quoting a savings number.
 */
export interface AppliedDealSurface {
  deal: Deal;
  match: "components_align" | "page_only";
  savings: number | null;
  savings_reason?: string;
}

export interface CustomizationSurface {
  customization_options?: Record<string, PizzaCustomizationOptions>;
  drink_options?: (SurfaceDrink | DrinkOption)[];
  side_options?: (SurfaceSide | SideOption)[];
  applicable_deals?: AppliedDealSurface[];
}

export interface CartDiff {
  op: "add" | "remove" | "add_modifier" | "swap_to_deal";
  cart: Cart;
  line_index?: number;
  item?: CartItem;
  modifier?: SelectedModifier;
  deal_id?: string;
  deal?: Deal;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function sameName(a: string, b: string): boolean {
  const aa = a.toLowerCase();
  const bb = b.toLowerCase();
  return aa === bb || aa.includes(bb) || bb.includes(aa);
}

/**
 * Strip non-alphanumeric chars for lenient name/itemId matching.
 * "Wings (8pc)" → "wings8pc"; "wings_8pc" → "wings8pc".
 */
function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function findPizza(restaurant: Restaurant, name: string) {
  return restaurant.menu.pizzas.find((p) => sameName(p.name, name));
}

function findSide(restaurant: Restaurant, name: string) {
  return restaurant.menu.sides.find((s) => sameName(s.name, name));
}

export function legacyItemsToCart(
  items: LegacyOrderItem[],
  restaurant?: Restaurant,
): Cart {
  return items.map((item) => {
    const pizza = restaurant ? findPizza(restaurant, item.name) : undefined;
    const side = restaurant ? findSide(restaurant, item.name) : undefined;
    const kind: CartItem["kind"] = pizza ? "pizza" : side ? "side" : "pizza";
    const itemId = slug(`${restaurant?.id ?? "legacy"}_${item.name}`);
    return {
      kind,
      itemId,
      name: item.name,
      sizeId: slug(item.size),
      sizeLabel: item.size,
      quantity: item.quantity,
      basePrice: item.price,
      substitution: item.substitution,
    };
  });
}

function pizzaOptions(pizza: Restaurant["menu"]["pizzas"][number]) {
  const options: PizzaCustomizationOptions = {};
  if (pizza.crusts) options.crusts = pizza.crusts;
  if (pizza.toppings) options.toppings = pizza.toppings;
  if (pizza.sauce_options) options.sauce_options = pizza.sauce_options;
  if (pizza.cheese_options) options.cheese_options = pizza.cheese_options;
  if (pizza.dipping_sauces) options.dipping_sauces = pizza.dipping_sauces;
  return Object.keys(options).length > 0 ? options : undefined;
}

export function buildCustomizationSurface(
  restaurant: Restaurant,
  cart: Cart,
  surface: "mcp" | "a2a" | "webapp",
): CustomizationSurface {
  const customizationOptions: Record<string, PizzaCustomizationOptions> = {};

  cart.forEach((item, index) => {
    if (item.kind !== "pizza") return;
    const pizza = findPizza(restaurant, item.name);
    if (!pizza) return;
    const options = pizzaOptions(pizza);
    if (!options) return;
    const baseKey = item.name || `line_${index}`;
    const key =
      customizationOptions[baseKey] === undefined
        ? baseKey
        : `${baseKey}#${index}`;
    customizationOptions[key] = options;
  });

  const surfaceObj: CustomizationSurface = {};
  if (Object.keys(customizationOptions).length > 0) {
    surfaceObj.customization_options = customizationOptions;
  }

  // Drinks: real (high confidence) merged with defaults (medium) for names absent from real.
  // Real entries are stamped with menu_confidence: "high" at the surface boundary.
  // Defaults pass through TWO filters:
  //   1. Name-suppression (existing): drop defaults whose name case-insensitively
  //      matches a real drink's name.
  //   2. Brand-suppression (SP-20260512-002 DD-3): if real drinks include any
  //      entry whose brand resolves to a known portfolio P, drop defaults whose
  //      brand resolves to a different known portfolio Q. Defaults with
  //      `brand === undefined` (e.g. plain Water) are never brand-suppressed.
  const realDrinks: SurfaceDrink[] = (restaurant.menu.drinks ?? []).map(
    (d) => ({ ...d, menu_confidence: "high" as const }),
  );
  const realDrinkNames = new Set(realDrinks.map((d) => d.name.toLowerCase()));
  const realPortfolios = new Set<PortfolioId>();
  for (const d of realDrinks) {
    const p = brandToPortfolio(d.brand);
    if (p !== "unknown") realPortfolios.add(p);
  }
  const nameFilteredDefaults: DrinkOption[] =
    PIZZA_CUISINE_DEFAULTS.drinks.filter(
      (d) => !realDrinkNames.has(d.name.toLowerCase()),
    );
  const defaultDrinks: DrinkOption[] = [];
  let suppressedDefaultCount = 0;
  for (const def of nameFilteredDefaults) {
    if (def.brand === undefined) {
      // Brand-undefined defaults (e.g. plain Water) never suppressed.
      defaultDrinks.push(def);
      continue;
    }
    const defPortfolio = brandToPortfolio(def.brand);
    if (defPortfolio === "unknown") {
      // Unknown-portfolio defaults pass through — no portfolio to conflict.
      defaultDrinks.push(def);
      continue;
    }
    // Suppress when the default's portfolio is not present among the real
    // portfolios (and at least one real portfolio exists).
    const conflicts =
      realPortfolios.size > 0 && !realPortfolios.has(defPortfolio);
    if (conflicts) {
      suppressedDefaultCount++;
      continue;
    }
    defaultDrinks.push(def);
  }
  const drinkOptions: (SurfaceDrink | DrinkOption)[] = [
    ...realDrinks,
    ...defaultDrinks,
  ];

  // Sides: name-match merge pattern preserved (SP-20260512-001 baseline).
  const realSides: SurfaceSide[] = restaurant.menu.sides.map((s) => ({
    ...s,
    menu_confidence: "high" as const,
  }));
  const realSideNames = new Set(realSides.map((s) => s.name.toLowerCase()));
  const defaultSides: SideOption[] = PIZZA_CUISINE_DEFAULTS.sides.filter(
    (s) => !realSideNames.has(s.name.toLowerCase()),
  );
  const sideOptions: (SurfaceSide | SideOption)[] = [
    ...realSides,
    ...defaultSides,
  ];

  if (drinkOptions.length > 0) {
    surfaceObj.drink_options = drinkOptions;
  }
  if (sideOptions.length > 0) {
    surfaceObj.side_options = sideOptions;
  }

  // Deals: emit {deal, match, savings, savings_reason} discriminator (R-10).
  // Empty cart → match: 'page_only' for every deal (cart-shape match needs a cart).
  if (restaurant.menu.deals?.length) {
    surfaceObj.applicable_deals = restaurant.menu.deals.map((deal) => {
      const aligns = dealComponentsMatchCart(deal, cart);
      const sav = aligns
        ? dealSavings(deal, cart, restaurant)
        : {
            verified: false,
            savings: null,
            reason: dealMatchReason(deal, cart),
          };
      const matched = aligns && sav.verified;
      const entry: AppliedDealSurface = {
        deal,
        match: matched ? "components_align" : "page_only",
        savings: matched ? sav.savings : null,
      };
      if (sav.reason) entry.savings_reason = sav.reason;
      return entry;
    });
  }

  const drinkHigh = drinkOptions.filter(
    (d): d is SurfaceDrink => d.menu_confidence === "high",
  ).length;
  const drinkMed = drinkOptions.length - drinkHigh;
  const sideHigh = sideOptions.filter(
    (s): s is SurfaceSide => s.menu_confidence === "high",
  ).length;
  const sideMed = sideOptions.length - sideHigh;
  const componentsAlignCount =
    surfaceObj.applicable_deals?.filter((d) => d.match === "components_align")
      .length ?? 0;
  const pageOnlyCount =
    surfaceObj.applicable_deals?.filter((d) => d.match === "page_only")
      .length ?? 0;
  const verifiedSavingsCount =
    surfaceObj.applicable_deals?.filter((d) => d.savings != null).length ?? 0;
  logCustomizationSurfaceEvent({
    restaurant_id: restaurant.id,
    surface,
    drink_options_count_high: drinkHigh,
    drink_options_count_medium: drinkMed,
    side_options_count_high: sideHigh,
    side_options_count_medium: sideMed,
    applicable_deals_count: surfaceObj.applicable_deals?.length ?? 0,
    suppressed_default_count: suppressedDefaultCount,
    real_drink_portfolios: Array.from(realPortfolios),
    deals_summary: {
      components_align_count: componentsAlignCount,
      page_only_count: pageOnlyCount,
      verified_savings_count: verifiedSavingsCount,
    },
  });

  return surfaceObj;
}

export function hasCustomizationOpportunities(
  surface: CustomizationSurface,
): boolean {
  return (
    Object.keys(surface.customization_options ?? {}).length > 0 ||
    (surface.drink_options?.length ?? 0) > 0 ||
    (surface.side_options?.length ?? 0) > 0 ||
    (surface.applicable_deals?.length ?? 0) > 0
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Total-honesty helpers (SP-20260512-002 R-7 / R-8 / AC-13)
// ────────────────────────────────────────────────────────────────────────────

/**
 * True iff a restaurant's `menu.*.sizes[].price` is real-menu evidence —
 * i.e. the prices come from a trusted source the agent can quote:
 *   - `test_*` / `dominos_*` ids — hand-curated or API-sourced.
 *   - any restaurant tagged `menuSource: 'restaurant_website'` (post-enrichment).
 *
 * Anything else is the generic `places_*` template and must be treated as
 * "I'll get you the exact total on the call" — C-2 narration.
 */
export function isMenuSourceTrustworthy(restaurant: Restaurant): boolean {
  if (restaurant.id.startsWith("test_")) return true;
  if (restaurant.id.startsWith("dominos_")) return true;
  if (restaurant.menuSource === "restaurant_website") return true;
  return false;
}

/**
 * True iff the agent must NOT voice a synthesized total for this cart on
 * this restaurant (AC-13.1 / AC-13.2):
 *
 *   - Any cart line has `basePrice <= 0` (medium-confidence — type wall
 *     normally blocks this, but defense in depth).
 *   - OR `isMenuSourceTrustworthy(restaurant)` is false — generic
 *     `places_*` template prices are not evidence.
 *
 * When true, the surface emits `narration_total_unknown: true` on
 * `suggested_order` and the agent must speak C-2 ("I'll get you the exact
 * total on the call.") instead of quoting an `estimatedTotal`.
 */
export function cartNarrationTotalUnknown(
  cart: Cart,
  restaurant: Restaurant,
): boolean {
  if (!isMenuSourceTrustworthy(restaurant)) return true;
  for (const line of cart) {
    if (line.basePrice <= 0) return true;
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// Deal-component matching (SP-20260512-002 DD-4)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Test whether a single cart line satisfies a deal component's constraints.
 *
 * Strict rules per DD-4:
 *   - kind: strict equality
 *   - constraints.size: cart_line.sizeLabel || sizeId contains size (CI)
 *   - constraints.maxToppings: count of modifiers in "toppings" group ≤ max
 *   - constraints.item: cart_line.itemId or name matches item ref (lenient,
 *     strips non-alphanumeric for both sides)
 *
 * Unknown constraints (e.g. {category: "any"}) are ignored, allowing the
 * line to pass on them. Strict kind+size+maxToppings+item is the gate.
 */
function lineMatchesComponent(
  line: CartItem,
  component: DealComponent,
): boolean {
  if (line.kind !== component.kind) return false;
  const c = component.constraints;
  if (typeof c.size === "string" && c.size.trim()) {
    const target = c.size.toLowerCase().trim();
    const haystack =
      `${line.sizeLabel ?? ""} ${line.sizeId ?? ""}`.toLowerCase();
    if (!haystack.includes(target)) return false;
  }
  if (typeof c.maxToppings === "number") {
    const toppingCount = (line.modifiers ?? []).filter(
      (m) => m.groupId === "toppings",
    ).length;
    if (toppingCount > c.maxToppings) return false;
  }
  if (typeof c.item === "string" && c.item.trim()) {
    const itemRef = c.item;
    const refNorm = normalizeForMatch(itemRef);
    const idNorm = normalizeForMatch(line.itemId);
    const nameNorm = normalizeForMatch(line.name);
    const idMatch = idNorm === refNorm || idNorm.includes(refNorm);
    const nameMatch =
      nameNorm === refNorm ||
      nameNorm.includes(refNorm) ||
      refNorm.includes(nameNorm);
    if (!idMatch && !nameMatch) return false;
  }
  return true;
}

/**
 * Check whether a deal's components align with the current cart shape.
 *
 * For `mix_match` deals: ≥ `minItems` cart-line quantities (sum across lines
 * matching any component) suffices — the components define eligibility, not
 * requirement.
 *
 * For `bundle` and `discount` deals: every component must have ≥ `count`
 * matching cart-line quantities (default `count` = 1).
 */
export function dealComponentsMatchCart(deal: Deal, cart: Cart): boolean {
  if (cart.length === 0) return false;

  if (deal.type === "mix_match") {
    const minItems =
      deal.priceRule.kind === "per_item_fixed" &&
      typeof deal.priceRule.minItems === "number"
        ? deal.priceRule.minItems
        : deal.components.length;
    let qty = 0;
    for (const line of cart) {
      if (deal.components.some((c) => lineMatchesComponent(line, c))) {
        qty += line.quantity;
      }
    }
    return qty >= minItems;
  }

  // bundle / discount: every component must have ≥ count matching cart qty.
  for (const component of deal.components) {
    const need =
      typeof component.constraints.count === "number"
        ? component.constraints.count
        : 1;
    let qty = 0;
    for (const line of cart) {
      if (lineMatchesComponent(line, component)) qty += line.quantity;
    }
    if (qty < need) return false;
  }
  return true;
}

/**
 * Diagnose the first cart-shape mismatch for a deal — used by the
 * `savings_reason` surface field when `dealComponentsMatchCart` is false.
 */
function dealMatchReason(deal: Deal, cart: Cart): string {
  if (cart.length === 0) return "cart is empty";
  if (deal.type === "mix_match") {
    const minItems =
      deal.priceRule.kind === "per_item_fixed" &&
      typeof deal.priceRule.minItems === "number"
        ? deal.priceRule.minItems
        : deal.components.length;
    let qty = 0;
    for (const line of cart) {
      if (deal.components.some((c) => lineMatchesComponent(line, c))) {
        qty += line.quantity;
      }
    }
    return `mix & match: ${qty} eligible items in cart; need ${minItems}`;
  }
  for (const component of deal.components) {
    const need =
      typeof component.constraints.count === "number"
        ? component.constraints.count
        : 1;
    let qty = 0;
    for (const line of cart) {
      if (lineMatchesComponent(line, component)) qty += line.quantity;
    }
    if (qty < need) {
      const sizeStr =
        typeof component.constraints.size === "string"
          ? `${component.constraints.size} `
          : "";
      const itemStr =
        typeof component.constraints.item === "string"
          ? component.constraints.item.replace(/_/g, " ")
          : component.kind;
      return `component count mismatch: need ${need} ${sizeStr}${itemStr}${
        need > 1 ? "s" : ""
      } (cart has ${qty})`;
    }
  }
  return "components align";
}

export interface DealSavingsResult {
  verified: boolean;
  savings: number | null;
  reason: string;
}

/**
 * Compute verified savings for a deal applied to the current cart.
 *
 * Verified iff:
 *   1. `dealComponentsMatchCart(deal, cart)` is true, AND
 *   2. every cart line that matches a deal component has `basePrice > 0`
 *      (high-confidence pricing — the type wall already keeps DrinkOption /
 *      SideOption defaults out of cart, so this is a defensive check).
 *
 * `restaurant` is currently unused but reserved for future per-restaurant
 * deal-price lookups (e.g. mix_match perItemPrice override per location).
 */
export function dealSavings(
  deal: Deal,
  cart: Cart,
  restaurant: Restaurant,
): DealSavingsResult {
  // restaurant retained in signature for future per-location pricing; unused
  // for now to preserve a stable public API across cycles.
  void restaurant;
  if (!dealComponentsMatchCart(deal, cart)) {
    return {
      verified: false,
      savings: null,
      reason: dealMatchReason(deal, cart),
    };
  }

  // Identify the lines that contribute to deal pricing — for mix_match those
  // are the lines matching any component; for bundle/discount, lines matching
  // any component (every component must match at least one line, so this is
  // the union of matched lines).
  const matchedLines = cart.filter((line) =>
    deal.components.some((c) => lineMatchesComponent(line, c)),
  );

  for (const line of matchedLines) {
    if (line.basePrice <= 0) {
      return {
        verified: false,
        savings: null,
        reason: `cart line "${line.name}" has zero/unknown price — cannot verify savings`,
      };
    }
  }

  const baseline = cartTotal(cart);
  const dealPrice = priceForDeal(deal, cart);
  const raw = Math.max(0, baseline - dealPrice);
  const savings = Math.round(raw * 100) / 100;
  return {
    verified: true,
    savings,
    reason: "all components matched at high confidence",
  };
}

function priceForDeal(deal: Deal, cart: Cart): number {
  const rule = deal.priceRule;
  if (rule.kind === "total_fixed") return rule.totalPrice;
  if (rule.kind === "per_item_fixed") {
    return rule.perItemPrice * ((rule.minItems ?? deal.components.length) || 1);
  }
  const current = cartTotal(cart);
  if (rule.kind === "dollar_off") return Math.max(0, current - rule.amount);
  return Math.max(0, current * (1 - rule.percent / 100));
}

function componentName(component: Deal["components"][number]): string {
  const constraints = component.constraints;
  const count =
    typeof constraints.count === "number" ? `${constraints.count}x ` : "";
  const size =
    typeof constraints.size === "string" ? `${constraints.size} ` : "";
  const item =
    typeof constraints.item === "string"
      ? constraints.item.replace(/_/g, " ")
      : component.kind;
  return `${count}${size}${item}`.trim();
}

export function dealToCartItem(deal: Deal, cart: Cart): CartItem {
  return {
    kind: "deal",
    itemId: deal.id,
    name: deal.name,
    quantity: 1,
    basePrice: priceForDeal(deal, cart),
    notes: deal.description,
    components: deal.components.map((component, index) => ({
      kind: component.kind,
      itemId:
        typeof component.constraints.item === "string"
          ? component.constraints.item
          : `${deal.id}_${index}`,
      name: componentName(component),
      sizeId:
        typeof component.constraints.size === "string"
          ? slug(component.constraints.size)
          : undefined,
      sizeLabel:
        typeof component.constraints.size === "string"
          ? component.constraints.size
          : undefined,
    })),
  };
}

function requireLineIndex(diff: CartDiff): number {
  if (diff.line_index === undefined) {
    throw new Error(`${diff.op} requires line_index`);
  }
  if (
    !Number.isInteger(diff.line_index) ||
    diff.line_index < 0 ||
    diff.line_index >= diff.cart.length
  ) {
    throw new Error(`line_index ${diff.line_index} is out of range`);
  }
  return diff.line_index;
}

/**
 * A-8 belt-and-suspenders: verify a drink itemId exists in the restaurant's
 * real menu. DrinkOption defaults (medium confidence) must NOT enter the cart.
 */
export function isDrinkOnMenu(restaurant: Restaurant, itemId: string): boolean {
  return (restaurant.menu.drinks ?? []).some((d) => d.id === itemId);
}

/**
 * A-8 belt-and-suspenders: verify a side itemId was derived from the
 * restaurant's real menu. Side itemIds are formed by slug(restaurantId + "_" + sideName)
 * matching the same logic used in legacyItemsToCart.
 */
export function isSideOnMenu(restaurant: Restaurant, itemId: string): boolean {
  return restaurant.menu.sides.some(
    (s) => slug(`${restaurant.id}_${s.name}`) === itemId,
  );
}

export function applyCartDiff(
  diff: CartDiff,
  lookupDeal?: (dealId: string) => Deal | undefined,
): Cart {
  const cart = diff.cart.map((item) => clone(item));

  switch (diff.op) {
    case "add":
      if (!diff.item) throw new Error("add requires item");
      return [...cart, clone(diff.item)];
    case "remove": {
      const index = requireLineIndex(diff);
      return cart.filter((_, i) => i !== index);
    }
    case "add_modifier": {
      const index = requireLineIndex(diff);
      if (!diff.modifier) throw new Error("add_modifier requires modifier");
      const target = cart[index];
      cart[index] = {
        ...target,
        modifiers: [...(target.modifiers ?? []), clone(diff.modifier)],
      };
      return cart;
    }
    case "swap_to_deal": {
      if (!diff.deal_id && !diff.deal) {
        throw new Error("swap_to_deal requires deal_id or deal");
      }
      const deal = diff.deal ?? lookupDeal?.(diff.deal_id!);
      if (!deal) throw new Error(`Unknown deal: ${diff.deal_id}`);
      return [dealToCartItem(deal, cart)];
    }
  }
}
