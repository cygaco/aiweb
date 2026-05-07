/**
 * Restaurant data for Wave 00 MVP.
 * Primary: Domino's live API (real phone, address, delivery estimate).
 * Fallback: Hardcoded entries below (replace phones before using).
 */

import { findNearbyDominosStores } from "../connectors/dominos.js";
import { findNearbyPizzaPlaces } from "../connectors/places.js";
import type { Drink, Deal, ModifierGroup, PriceMatrix } from "../lib/cart.js";

export interface MenuItem {
  name: string;
  sizes: { name: string; price: number }[];
  description?: string;
}

/**
 * Pizza menu item — extends MenuItem with optional configurator groups
 * (crust, toppings, sauce, cheese, dipping sauces) and optional per-
 * (crust × size) price matrix for chains like Papa John's.
 *
 * All extension fields are optional — TEST_RESTAURANTS need no edits to
 * keep working. Real menu adapters (dominos.ts, places.ts) populate these
 * progressively as we extend their parsers.
 */
export interface PizzaMenuItem extends MenuItem {
  crusts?: ModifierGroup;
  toppings?: ModifierGroup;
  sauce_options?: ModifierGroup;
  cheese_options?: ModifierGroup;
  dipping_sauces?: ModifierGroup;
  priceMatrix?: PriceMatrix;
}

export interface Restaurant {
  id: string;
  name: string;
  phone: string;
  address: string;
  lat: number;
  lng: number;
  /**
   * Delivery radius in miles. `null` when the source connector cannot
   * truthfully report it (e.g. Google Places — we don't fabricate the value).
   * The compatibility layer treats `null` as `coverage: unknown`.
   */
  deliveryRadius: number | null;
  estimatedDeliveryMinutes: number;
  acceptsCash: boolean;
  /**
   * Honest fulfillment signal. Absent ≡ 'unknown' inside checkDeliveryAvailability.
   *  - 'delivery'          — confirmed delivery (Domino's API filter, test fixtures)
   *  - 'pickup_only'       — confirmed pickup-only
   *  - 'third_party_only'  — only via DoorDash/UberEats/etc.
   *  - 'unknown'           — source doesn't report
   */
  serviceType?: "delivery" | "pickup_only" | "third_party_only" | "unknown";
  menu: {
    pizzas: PizzaMenuItem[];
    sides: MenuItem[];
    /** Beverage lineup — optional; populated by enriched menu adapters. */
    drinks?: Drink[];
    /** Active deals/promotions — optional; populated by enriched adapters. */
    deals?: Deal[];
  };
  hours: string;
  isTest?: boolean; // always included in results, labeled for the agent
}

// Shared configurator groups for Vlad's — every pizza on Vlad's menu uses
// the same crust/topping/sauce/cheese/dipping options. Defined once for
// readability.
const VLAD_CRUSTS: import("../lib/cart.js").ModifierGroup = {
  id: "crust",
  label: "Crust",
  selection: "one",
  required: true,
  modifiers: [
    {
      id: "hand_tossed",
      name: "Hand Tossed",
      priceDelta: 0,
      default: true,
      tier: "base",
    },
    { id: "thin", name: "Thin Crust", priceDelta: 0, tier: "base" },
    { id: "deep_dish", name: "Deep Dish", priceDelta: 1.5, tier: "base" },
    {
      id: "stuffed",
      name: "Stuffed Crust",
      priceDelta: 2.5,
      tier: "premium",
      validSizeIds: ['Large 14"'],
    },
  ],
};

const VLAD_TOPPINGS: import("../lib/cart.js").ModifierGroup = {
  id: "toppings",
  label: "Add toppings",
  selection: "many",
  max: 8,
  modifiers: [
    { id: "extra_cheese", name: "Extra Cheese", priceDelta: 1.5 },
    { id: "pepperoni", name: "Pepperoni", priceDelta: 1.5 },
    { id: "italian_sausage", name: "Italian Sausage", priceDelta: 1.5 },
    { id: "mushrooms", name: "Mushrooms", priceDelta: 1.0 },
    { id: "onions", name: "Onions", priceDelta: 1.0 },
    { id: "green_peppers", name: "Green Peppers", priceDelta: 1.0 },
    { id: "olives", name: "Black Olives", priceDelta: 1.0 },
    { id: "jalapenos", name: "Jalapeños", priceDelta: 1.0 },
    { id: "pineapple", name: "Pineapple", priceDelta: 1.0 },
    { id: "bacon", name: "Bacon", priceDelta: 2.0 },
  ],
};

const VLAD_SAUCE: import("../lib/cart.js").ModifierGroup = {
  id: "sauce",
  label: "Sauce",
  selection: "one",
  modifiers: [
    {
      id: "tomato",
      name: "Classic Tomato",
      priceDelta: 0,
      default: true,
    },
    { id: "marinara", name: "Marinara", priceDelta: 0 },
    { id: "garlic_white", name: "Garlic White", priceDelta: 0 },
    { id: "bbq", name: "BBQ", priceDelta: 0 },
    { id: "no_sauce", name: "No Sauce", priceDelta: 0 },
  ],
};

const VLAD_CHEESE: import("../lib/cart.js").ModifierGroup = {
  id: "cheese",
  label: "Cheese amount",
  selection: "one",
  modifiers: [
    { id: "light", name: "Light", priceDelta: 0 },
    { id: "normal", name: "Normal", priceDelta: 0, default: true },
    { id: "extra", name: "Extra", priceDelta: 1.5 },
  ],
};

const VLAD_DIPS: import("../lib/cart.js").ModifierGroup = {
  id: "dipping_sauces",
  label: "Dipping sauces",
  selection: "many",
  modifiers: [
    { id: "garlic_dip", name: "Garlic Dipping Sauce", priceDelta: 0.79 },
    { id: "ranch", name: "Ranch", priceDelta: 0.79 },
    { id: "marinara_dip", name: "Marinara", priceDelta: 0.79 },
    { id: "bbq_dip", name: "BBQ", priceDelta: 0.79 },
  ],
};

// Always included in results regardless of location. Real phones — answer as staff when called.
export const TEST_RESTAURANTS: Restaurant[] = [
  {
    id: "test_vlad",
    name: "Vlad's Pizza Restaurant",
    phone: "+14152335033",
    address: "San Francisco, CA",
    lat: 37.7749,
    lng: -122.4194,
    deliveryRadius: 10,
    estimatedDeliveryMinutes: 30,
    acceptsCash: true,
    serviceType: "delivery",
    menu: {
      pizzas: [
        {
          name: "Pepperoni",
          description: "Classic pepperoni with mozzarella",
          sizes: [
            { name: 'Small 10"', price: 8.99 },
            { name: 'Medium 12"', price: 10.99 },
            { name: 'Large 14"', price: 12.99 },
          ],
          crusts: VLAD_CRUSTS,
          toppings: VLAD_TOPPINGS,
          sauce_options: VLAD_SAUCE,
          cheese_options: VLAD_CHEESE,
          dipping_sauces: VLAD_DIPS,
        },
        {
          name: "Cheese",
          sizes: [
            { name: 'Small 10"', price: 7.99 },
            { name: 'Medium 12"', price: 9.99 },
            { name: 'Large 14"', price: 11.99 },
          ],
          crusts: VLAD_CRUSTS,
          toppings: VLAD_TOPPINGS,
          sauce_options: VLAD_SAUCE,
          cheese_options: VLAD_CHEESE,
          dipping_sauces: VLAD_DIPS,
        },
        {
          name: "Meat Lovers",
          description: "Pepperoni, sausage, ham, beef, bacon",
          sizes: [
            { name: 'Small 10"', price: 10.99 },
            { name: 'Medium 12"', price: 13.99 },
            { name: 'Large 14"', price: 15.99 },
          ],
          crusts: VLAD_CRUSTS,
          toppings: VLAD_TOPPINGS,
          sauce_options: VLAD_SAUCE,
          cheese_options: VLAD_CHEESE,
          dipping_sauces: VLAD_DIPS,
        },
        {
          name: "Veggie",
          description: "Mushrooms, onions, green peppers, tomatoes, olives",
          sizes: [
            { name: 'Small 10"', price: 9.99 },
            { name: 'Medium 12"', price: 12.99 },
            { name: 'Large 14"', price: 14.99 },
          ],
          crusts: VLAD_CRUSTS,
          toppings: VLAD_TOPPINGS,
          sauce_options: VLAD_SAUCE,
          cheese_options: VLAD_CHEESE,
          dipping_sauces: VLAD_DIPS,
        },
      ],
      sides: [
        { name: "Wings (8pc)", sizes: [{ name: "Regular", price: 8.99 }] },
        { name: "Cheesy Bread", sizes: [{ name: "Regular", price: 6.99 }] },
      ],
      drinks: [
        {
          id: "coke_20oz",
          name: "Coca-Cola",
          brand: "Coca-Cola",
          sizes: [
            { id: "20oz", name: "20oz Bottle", price: 2.49 },
            { id: "2l", name: "2L Bottle", price: 3.99 },
          ],
        },
        {
          id: "diet_coke",
          name: "Diet Coke",
          brand: "Coca-Cola",
          sizes: [
            { id: "20oz", name: "20oz Bottle", price: 2.49 },
            { id: "2l", name: "2L Bottle", price: 3.99 },
          ],
        },
        {
          id: "sprite",
          name: "Sprite",
          brand: "Coca-Cola",
          sizes: [
            { id: "20oz", name: "20oz Bottle", price: 2.49 },
            { id: "2l", name: "2L Bottle", price: 3.99 },
          ],
        },
        {
          id: "dasani",
          name: "Dasani Water",
          brand: "Coca-Cola",
          sizes: [{ id: "20oz", name: "20oz Bottle", price: 2.0 }],
        },
      ],
      deals: [
        {
          id: "vlad_mix_match",
          name: "Mix & Match",
          description:
            "Pick any 2+ items from medium 1-topping pizza, wings, cheesy bread, or 2L drink",
          type: "mix_match",
          components: [
            {
              kind: "pizza",
              constraints: { size: "medium", maxToppings: 1 },
            },
            { kind: "side", constraints: { category: "any" } },
            { kind: "drink", constraints: { size: "2L" } },
          ],
          priceRule: {
            kind: "per_item_fixed",
            perItemPrice: 6.99,
            minItems: 2,
          },
        },
        {
          id: "vlad_family_combo",
          name: "Family Combo",
          description:
            "2 Large pizzas + 8pc wings + 2L Coke — feeds 4-6, save vs ordering separately",
          type: "bundle",
          components: [
            {
              kind: "pizza",
              constraints: { size: "large", count: 2, maxToppings: 2 },
            },
            { kind: "side", constraints: { item: "wings_8pc" } },
            { kind: "drink", constraints: { item: "coke_2l" } },
          ],
          priceRule: { kind: "total_fixed", totalPrice: 32.99 },
        },
      ],
    },
    hours: "11:00 AM - 11:00 PM",
    isTest: true,
  },
  {
    id: "test_kevin",
    name: "Kevin's Pizza Restaurant",
    phone: "+13308198912",
    address: "Ohio, USA",
    lat: 41.1,
    lng: -81.5,
    deliveryRadius: 10,
    estimatedDeliveryMinutes: 35,
    acceptsCash: true,
    serviceType: "delivery",
    menu: {
      pizzas: [
        {
          name: "Pepperoni",
          sizes: [
            { name: 'Medium 12"', price: 10.99 },
            { name: 'Large 14"', price: 12.99 },
          ],
        },
        {
          name: "Cheese",
          sizes: [
            { name: 'Medium 12"', price: 9.99 },
            { name: 'Large 14"', price: 11.99 },
          ],
        },
        {
          name: "Supreme",
          description: "Pepperoni, sausage, mushrooms, onions, green peppers",
          sizes: [
            { name: 'Medium 12"', price: 14.99 },
            { name: 'Large 14"', price: 16.99 },
          ],
        },
      ],
      sides: [
        {
          name: "Garlic Knots (6pc)",
          sizes: [{ name: "Regular", price: 5.99 }],
        },
      ],
    },
    hours: "11:00 AM - 10:00 PM",
    isTest: true,
  },
  {
    // Pickup-only fixture — drives QA Flow A and Demo Beat 4.
    // The compatibility layer's checkDeliveryAvailability emits state
    // 'pickup_only' for this restaurant, which collapses overall to no_go.
    id: "test_pickup_only",
    name: "Slice Box (Pickup Only)",
    phone: "+14155550199",
    address: "Mission St, San Francisco, CA",
    lat: 37.7749,
    lng: -122.4194,
    deliveryRadius: 0, // legacy field; ignored due to serviceType
    estimatedDeliveryMinutes: 0,
    acceptsCash: true,
    serviceType: "pickup_only",
    menu: {
      pizzas: [
        {
          name: "Pepperoni",
          sizes: [
            { name: 'Medium 12"', price: 11.99 },
            { name: 'Large 14"', price: 14.99 },
          ],
        },
        {
          name: "Cheese",
          sizes: [
            { name: 'Medium 12"', price: 10.99 },
            { name: 'Large 14"', price: 13.99 },
          ],
        },
      ],
      sides: [
        { name: "Garlic Knots", sizes: [{ name: "Regular", price: 5.99 }] },
      ],
    },
    hours: "Daily 11am–10pm",
    isTest: true,
  },
];

// Kept for reference — no longer used as primary fallback.
export const RESTAURANTS: Restaurant[] = [];

// In-memory cache: normalized address → { results, cachedAt }
const restaurantCache = new Map<
  string,
  { results: Restaurant[]; cachedAt: number }
>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function getRestaurantPhone(id: string): string | null {
  const test = TEST_RESTAURANTS.find((r) => r.id === id);
  if (test) return test.phone;
  for (const entry of restaurantCache.values()) {
    const found = entry.results.find((r) => r.id === id);
    if (found) return found.phone;
  }
  return null;
}

export function getRestaurantById(id: string): Restaurant | null {
  const test = TEST_RESTAURANTS.find((r) => r.id === id);
  if (test) return test;
  for (const entry of restaurantCache.values()) {
    const found = entry.results.find((r) => r.id === id);
    if (found) return found;
  }
  return null;
}

/**
 * Find restaurants near an address.
 * - Checks in-memory cache first (5-min TTL)
 * - Runs live Domino's discovery, writes result to cache
 * - Always appends TEST_RESTAURANTS at the end
 */
export async function findNearbyRestaurants(
  address: string,
): Promise<Restaurant[]> {
  const key = address.toLowerCase().trim();
  const cached = restaurantCache.get(key);

  let live: Restaurant[] = [];
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    live = cached.results;
  } else {
    // Google Places is primary — broad coverage, real phones
    live = await findNearbyPizzaPlaces(address);
    // Domino's as fallback if Places key not set or returned nothing
    if (live.length === 0) {
      live = await findNearbyDominosStores(address);
    }
    restaurantCache.set(key, { results: live, cachedAt: Date.now() });
  }

  return [...live, ...TEST_RESTAURANTS];
}
