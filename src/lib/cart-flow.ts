import type { Restaurant } from "../data/restaurants.js";
import {
  cartTotal,
  type Cart,
  type CartItem,
  type Deal,
  type ModifierGroup,
  type SelectedModifier,
} from "./cart.js";

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
  drink_options?: Restaurant["menu"]["drinks"];
  side_options?: Restaurant["menu"]["sides"];
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

  const surface: CustomizationSurface = {};
  if (Object.keys(customizationOptions).length > 0) {
    surface.customization_options = customizationOptions;
  }
  if (restaurant.menu.drinks?.length) {
    surface.drink_options = restaurant.menu.drinks;
  }
  if (restaurant.menu.sides.length) {
    surface.side_options = restaurant.menu.sides;
  }
  if (restaurant.menu.deals?.length) {
    surface.applicable_deals = restaurant.menu.deals;
  }
  return surface;
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
  const size = typeof constraints.size === "string" ? `${constraints.size} ` : "";
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
