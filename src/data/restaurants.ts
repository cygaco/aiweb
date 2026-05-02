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
  deliveryRadius: number; // miles
  estimatedDeliveryMinutes: number;
  acceptsCash: boolean;
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
        },
        {
          name: "Cheese",
          sizes: [
            { name: 'Small 10"', price: 7.99 },
            { name: 'Medium 12"', price: 9.99 },
            { name: 'Large 14"', price: 11.99 },
          ],
        },
        {
          name: "Meat Lovers",
          description: "Pepperoni, sausage, ham, beef, bacon",
          sizes: [
            { name: 'Small 10"', price: 10.99 },
            { name: 'Medium 12"', price: 13.99 },
            { name: 'Large 14"', price: 15.99 },
          ],
        },
        {
          name: "Veggie",
          description: "Mushrooms, onions, green peppers, tomatoes, olives",
          sizes: [
            { name: 'Small 10"', price: 9.99 },
            { name: 'Medium 12"', price: 12.99 },
            { name: 'Large 14"', price: 14.99 },
          ],
        },
      ],
      sides: [
        { name: "Wings (8pc)", sizes: [{ name: "Regular", price: 8.99 }] },
        { name: "Cheesy Bread", sizes: [{ name: "Regular", price: 6.99 }] },
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
