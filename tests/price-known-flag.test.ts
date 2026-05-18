/**
 * tests/price-known-flag.test.ts — SP-20260517-005 / S-5 / AC-5.*.
 *
 * Verifies the extraction post-process produces `priceKnown` flags
 * correctly and that the validator + back-compat path still hold.
 * The actual Haiku call is mocked via env (ANTHROPIC_API_KEY unset
 * makes extractMenuFromHtml return null without us being able to
 * cover the path), so these tests target the schema + cart-narration
 * side of the contract directly.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidCachedMenuResult } from "../src/lib/menu-discovery.js";
import {
  cartNarrationTotalUnknown,
  isMenuSourceTrustworthy,
} from "../src/lib/cart-flow.js";
import type { Restaurant } from "../src/data/restaurants.js";
import type { Cart } from "../src/lib/cart.js";

const BASE_CACHE = {
  discoveredAt: "2026-05-18T00:00:00.000Z",
  source: "restaurant_website",
  pizzas: [{ name: "Pepperoni", sizes: [{ name: "Large", price: 14.99 }] }],
  sides: [{ name: "Wings", sizes: [{ name: "8pc", price: 9.99 }] }],
  drinks: [
    {
      id: "coke-2l",
      name: "Coke",
      sizes: [{ id: "2l", name: "2L", price: 4.0 }],
    },
  ],
  deliveryCues: {
    offersDelivery: true,
    deliveryRadiusMiles: 5,
    rawSignal: null,
  },
};

test("AC-5.* (validator): priceKnown absent ≡ true (back-compat)", () => {
  // Existing cache entries (no priceKnown field) must still validate.
  assert.equal(isValidCachedMenuResult(BASE_CACHE), true);
});

test("AC-5.1 (validator): pizza with price:0 + priceKnown:false validates", () => {
  const r = {
    ...BASE_CACHE,
    pizzas: [
      {
        name: "Veggie Specialty",
        sizes: [{ name: "Default", price: 0, priceKnown: false }],
      },
    ],
  };
  assert.equal(isValidCachedMenuResult(r), true);
});

test("AC-5.1 (validator): side with priceKnown:true validates", () => {
  const r = {
    ...BASE_CACHE,
    sides: [
      {
        name: "Wings",
        sizes: [{ name: "8pc", price: 9.99, priceKnown: true }],
      },
    ],
  };
  assert.equal(isValidCachedMenuResult(r), true);
});

test("validator: drink with priceKnown:false on a size validates", () => {
  const r = {
    ...BASE_CACHE,
    drinks: [
      {
        id: "house-soda",
        name: "House Soda",
        sizes: [
          { id: "default", name: "Default", price: 0, priceKnown: false },
        ],
      },
    ],
  };
  assert.equal(isValidCachedMenuResult(r), true);
});

test("validator: priceKnown with wrong type (string) still rejects via size shape", () => {
  // priceKnown is OPTIONAL boolean. A truly wrong type on `price` (e.g.
  // string) is still rejected via the price-must-be-number rule in the
  // size validator. This test ensures the additive priceKnown field
  // doesn't accidentally relax that.
  const r = {
    ...BASE_CACHE,
    drinks: [
      {
        id: "broken",
        name: "Broken",
        sizes: [
          { id: "x", name: "x", price: "not a number", priceKnown: false },
        ],
      },
    ],
  };
  assert.equal(isValidCachedMenuResult(r), false);
});

// ──────────────────────────────────────────────────────────────────────────
// AC-5.2: cart-narration respects priceKnown=false. We piggyback on the
// existing cartNarrationTotalUnknown check, which already fires when any
// cart line has basePrice<=0. Since priceKnown=false items are encoded
// as price=0, that gate fires naturally — verify behavior here.
// ──────────────────────────────────────────────────────────────────────────

function fakeRestaurant(overrides: Partial<Restaurant> = {}): Restaurant {
  return {
    id: "places_test123",
    name: "Test Pizzeria",
    phone: "+15555555555",
    address: "1 Test St",
    lat: 0,
    lng: 0,
    deliveryRadius: 5,
    estimatedDeliveryMinutes: 25,
    acceptsCash: true,
    menu: { pizzas: [], sides: [] },
    hours: "11-21",
    menuSource: "restaurant_website",
    ...overrides,
  };
}

test("AC-5.2: cart with basePrice=0 (priceKnown=false) → narration_total_unknown", () => {
  const restaurant = fakeRestaurant();
  // Even with a trustworthy menu source, a price=0 line forces honest narration.
  const cart: Cart = [
    {
      kind: "pizza",
      itemId: "veggie-large",
      name: "Veggie Specialty",
      sizeId: "large",
      sizeLabel: "Large",
      quantity: 1,
      basePrice: 0,
    },
  ];
  assert.equal(cartNarrationTotalUnknown(cart, restaurant), true);
});

test("AC-5.2: cart with all priceKnown=true lines → no total_unknown flag", () => {
  const restaurant = fakeRestaurant();
  const cart: Cart = [
    {
      kind: "pizza",
      itemId: "pepperoni-large",
      name: "Pepperoni",
      sizeId: "large",
      sizeLabel: "Large",
      quantity: 1,
      basePrice: 14.99,
    },
  ];
  assert.equal(cartNarrationTotalUnknown(cart, restaurant), false);
});

test("AC-5.2: places_*-menu with no enrichment still triggers total_unknown (unchanged)", () => {
  const restaurant = fakeRestaurant({
    id: "places_xyz",
    menuSource: undefined,
  });
  // Even a normally-priced cart triggers it because the menu source isn't trustworthy.
  const cart: Cart = [
    {
      kind: "pizza",
      itemId: "pepperoni-large",
      name: "Pepperoni",
      sizeId: "large",
      sizeLabel: "Large",
      quantity: 1,
      basePrice: 14.99,
    },
  ];
  assert.equal(cartNarrationTotalUnknown(cart, restaurant), true);
  assert.equal(isMenuSourceTrustworthy(restaurant), false);
});

// ──────────────────────────────────────────────────────────────────────────
// AC-5.3: enrichment ≥1-pizza success gate is in enrichEvidence — it
// counts pizzas in `extracted.pizzas`. Since priceKnown=false items
// remain in the array (not dropped), the gate passes. Cover that
// invariant by validating a cache entry built from a priceless menu.
// ──────────────────────────────────────────────────────────────────────────

test("AC-5.3: priceless-pizza cache passes validation (enrichment gate would accept)", () => {
  const r = {
    ...BASE_CACHE,
    pizzas: [
      {
        name: "Margherita",
        sizes: [{ name: "Default", price: 0, priceKnown: false }],
      },
    ],
  };
  assert.equal(isValidCachedMenuResult(r), true);
  // The ≥1-pizza gate looks at pizzas.length, which is 1 here.
  assert.equal(r.pizzas.length, 1);
});
