import type { MenuItem, Restaurant } from "../data/restaurants.js";
import { PIZZA_CUISINE_DEFAULTS } from "../data/restaurants.js";
import {
  cartTotal,
  type Cart,
  type CartItem,
  type Deal,
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

export interface CustomizationSurface {
  customization_options?: Record<string, PizzaCustomizationOptions>;
  drink_options?: (SurfaceDrink | DrinkOption)[];
  side_options?: (SurfaceSide | SideOption)[];
  applicable_deals?: Deal[];
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
  // Spec S-16: case-insensitive NAME match only — no brand-aware deduplication.
  // Real entries are stamped with menu_confidence: "high" at the surface boundary.
  const realDrinks: SurfaceDrink[] = (restaurant.menu.drinks ?? []).map(
    (d) => ({ ...d, menu_confidence: "high" as const }),
  );
  const realDrinkNames = new Set(realDrinks.map((d) => d.name.toLowerCase()));
  const defaultDrinks: DrinkOption[] = PIZZA_CUISINE_DEFAULTS.drinks.filter(
    (d) => !realDrinkNames.has(d.name.toLowerCase()),
  );
  const drinkOptions: (SurfaceDrink | DrinkOption)[] = [
    ...realDrinks,
    ...defaultDrinks,
  ];

  // Sides: same merge pattern as drinks — append defaults whose name doesn't
  // case-insensitively match any real side (spec S-16, exact name match).
  // Real entries are stamped with menu_confidence: "high" at the surface boundary.
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
  if (restaurant.menu.deals?.length) {
    surfaceObj.applicable_deals = restaurant.menu.deals;
  }

  const drinkHigh = drinkOptions.filter(
    (d): d is SurfaceDrink => d.menu_confidence === "high",
  ).length;
  const drinkMed = drinkOptions.length - drinkHigh;
  const sideHigh = sideOptions.filter(
    (s): s is SurfaceSide => s.menu_confidence === "high",
  ).length;
  const sideMed = sideOptions.length - sideHigh;
  logCustomizationSurfaceEvent({
    restaurant_id: restaurant.id,
    surface,
    drink_options_count_high: drinkHigh,
    drink_options_count_medium: drinkMed,
    side_options_count_high: sideHigh,
    side_options_count_medium: sideMed,
    applicable_deals_count: surfaceObj.applicable_deals?.length ?? 0,
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
