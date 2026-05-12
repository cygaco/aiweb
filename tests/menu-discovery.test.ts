import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Route cache to a temp dir per run
const TMP_DIR = mkdtempSync(join(tmpdir(), "menu-discovery-test-"));
process.env.MENU_CACHE_DIR = TMP_DIR;

// Ensure no real API calls — key absent by default in test env
delete process.env.ANTHROPIC_API_KEY;

import { enrichEvidence } from "../src/lib/menu-discovery.js";
import type { Restaurant } from "../src/data/restaurants.js";

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────

const PLACES_NO_WEBSITE: Restaurant = {
  id: "places_no_website",
  name: "No Website Pizza",
  phone: "+14155551111",
  address: "San Francisco, CA",
  lat: 37.78,
  lng: -122.42,
  deliveryRadius: null,
  estimatedDeliveryMinutes: 30,
  acceptsCash: true,
  serviceType: "unknown",
  menu: {
    pizzas: [{ name: "Pepperoni", sizes: [{ name: "Large", price: 16.99 }] }],
    sides: [],
  },
  hours: "Daily",
};

const PLACES_WITH_WEBSITE: Restaurant = {
  ...PLACES_NO_WEBSITE,
  id: "places_with_website",
  name: "Has Website Pizza",
  website: "https://example-pizza-that-does-not-exist.invalid/menu",
};

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

// 1 — no website field → unchanged, fail-open
test("enrichEvidence — no website on restaurant → returns unchanged", async () => {
  const result = await enrichEvidence(PLACES_NO_WEBSITE, "pepperoni");
  assert.strictEqual(result.source, "unchanged");
  assert.strictEqual(result.enriched, PLACES_NO_WEBSITE);
  assert.strictEqual(result.deliveryCues, null);
});

// 2 — no ANTHROPIC_API_KEY → fetch may run but extraction skips → unchanged
test("enrichEvidence — no ANTHROPIC_API_KEY → fails open, returns unchanged", async () => {
  // ANTHROPIC_API_KEY is deleted at top of file; fetch to invalid URL will
  // time-out or reject, and no LLM call is possible. Both paths → unchanged.
  const result = await enrichEvidence(PLACES_WITH_WEBSITE, "pepperoni");
  assert.strictEqual(result.source, "unchanged");
  assert.strictEqual(result.enriched, PLACES_WITH_WEBSITE);
});

// 3 — cache hit: write a valid cache entry, verify enrichEvidence returns it
test("enrichEvidence — cache hit within TTL → returns cache, no network", async () => {
  const restaurantId = "places_cache_test";
  const cached = {
    discoveredAt: new Date().toISOString(),
    source: "restaurant_website" as const,
    pizzas: [
      {
        name: "Buffalo Chicken",
        sizes: [{ name: "Large", price: 17.99 }],
      },
    ],
    sides: [
      { name: "Garlic Knots", sizes: [{ name: "Regular", price: 5.99 }] },
    ],
    drinks: [],
    deliveryCues: {
      offersDelivery: true,
      deliveryRadiusMiles: 5,
      rawSignal: "We deliver within 5 miles",
    },
  };
  writeFileSync(join(TMP_DIR, `${restaurantId}.json`), JSON.stringify(cached));

  const restaurant: Restaurant = {
    ...PLACES_NO_WEBSITE,
    id: restaurantId,
    website: "https://should-not-be-fetched.invalid",
  };

  const result = await enrichEvidence(restaurant, "buffalo chicken");
  assert.strictEqual(result.source, "cache");
  assert.strictEqual(result.enriched.menu.pizzas[0].name, "Buffalo Chicken");
  assert.strictEqual(result.enriched.serviceType, "delivery");
  assert.strictEqual(result.enriched.deliveryRadius, 5);
  assert.ok(result.deliveryCues !== null);
  assert.strictEqual(result.deliveryCues!.offersDelivery, true);
});

// 4 — cache hit: delivery cue pickup_only applied when serviceType is unknown
test("enrichEvidence — cache with offersDelivery=false → serviceType becomes pickup_only", async () => {
  const restaurantId = "places_pickup_cache";
  const cached = {
    discoveredAt: new Date().toISOString(),
    source: "restaurant_website" as const,
    pizzas: [{ name: "Cheese", sizes: [{ name: "Large", price: 14.99 }] }],
    sides: [],
    drinks: [],
    deliveryCues: {
      offersDelivery: false,
      deliveryRadiusMiles: null,
      rawSignal: "Pickup only",
    },
  };
  writeFileSync(join(TMP_DIR, `${restaurantId}.json`), JSON.stringify(cached));

  const restaurant: Restaurant = {
    ...PLACES_NO_WEBSITE,
    id: restaurantId,
    website: "https://should-not-be-fetched.invalid",
  };

  const result = await enrichEvidence(restaurant);
  assert.strictEqual(result.source, "cache");
  assert.strictEqual(result.enriched.serviceType, "pickup_only");
});

// 5 — cache hit: offersDelivery=null → serviceType stays unknown
test("enrichEvidence — cache with offersDelivery=null → serviceType unchanged", async () => {
  const restaurantId = "places_null_delivery_cache";
  const cached = {
    discoveredAt: new Date().toISOString(),
    source: "restaurant_website" as const,
    pizzas: [{ name: "Veggie", sizes: [{ name: "Large", price: 15.99 }] }],
    sides: [],
    drinks: [],
    deliveryCues: {
      offersDelivery: null,
      deliveryRadiusMiles: null,
      rawSignal: null,
    },
  };
  writeFileSync(join(TMP_DIR, `${restaurantId}.json`), JSON.stringify(cached));

  const restaurant: Restaurant = {
    ...PLACES_NO_WEBSITE,
    id: restaurantId,
    website: "https://should-not-be-fetched.invalid",
  };

  const result = await enrichEvidence(restaurant);
  assert.strictEqual(result.source, "cache");
  assert.strictEqual(result.enriched.serviceType, "unknown");
});

// 6 — stale cache (>24h) → treated as miss, falls through to unchanged (no key)
test("enrichEvidence — stale cache (>24h) → cache miss, falls through to unchanged", async () => {
  const restaurantId = "places_stale_cache";
  const stale = {
    discoveredAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    source: "restaurant_website" as const,
    pizzas: [{ name: "Old Pizza", sizes: [{ name: "Large", price: 10.0 }] }],
    sides: [],
    deliveryCues: {
      offersDelivery: true,
      deliveryRadiusMiles: 3,
      rawSignal: null,
    },
  };
  writeFileSync(join(TMP_DIR, `${restaurantId}.json`), JSON.stringify(stale));

  const restaurant: Restaurant = {
    ...PLACES_WITH_WEBSITE,
    id: restaurantId,
  };

  // No API key → extraction would fail anyway → unchanged
  const result = await enrichEvidence(restaurant);
  assert.notStrictEqual(result.source, "cache");
  // Stale cache must NOT be used — Old Pizza should not appear in menu
  assert.ok(result.enriched.menu.pizzas.every((p) => p.name !== "Old Pizza"));
});

// 7 — enrichment does not mutate the original restaurant object
test("enrichEvidence — original restaurant object is not mutated on cache hit", async () => {
  const restaurantId = "places_immutability_test";
  const cached = {
    discoveredAt: new Date().toISOString(),
    source: "restaurant_website" as const,
    pizzas: [{ name: "Supreme", sizes: [{ name: "Large", price: 18.99 }] }],
    sides: [],
    drinks: [],
    deliveryCues: {
      offersDelivery: true,
      deliveryRadiusMiles: 4,
      rawSignal: null,
    },
  };
  writeFileSync(join(TMP_DIR, `${restaurantId}.json`), JSON.stringify(cached));

  const restaurant: Restaurant = {
    ...PLACES_NO_WEBSITE,
    id: restaurantId,
    website: "https://should-not-be-fetched.invalid",
  };
  const originalPizzaCount = restaurant.menu.pizzas.length;

  const result = await enrichEvidence(restaurant);
  // enriched is a new object
  assert.notStrictEqual(result.enriched, restaurant);
  // original menu unchanged
  assert.strictEqual(restaurant.menu.pizzas.length, originalPizzaCount);
  assert.strictEqual(restaurant.serviceType, "unknown");
  assert.strictEqual(restaurant.deliveryRadius, null);
});

// 8 — enriched restaurant has menuSource='restaurant_website' so compatibility
//     bypasses the generic-template path and uses the real menu
test("enrichEvidence — cache hit sets menuSource=restaurant_website on enriched restaurant", async () => {
  const restaurantId = "places_menu_source_test";
  const cached = {
    discoveredAt: new Date().toISOString(),
    source: "restaurant_website" as const,
    pizzas: [{ name: "Hawaiian", sizes: [{ name: "Large", price: 16.99 }] }],
    sides: [],
    drinks: [],
    deliveryCues: {
      offersDelivery: null,
      deliveryRadiusMiles: null,
      rawSignal: null,
    },
  };
  writeFileSync(join(TMP_DIR, `${restaurantId}.json`), JSON.stringify(cached));

  const restaurant: Restaurant = {
    ...PLACES_NO_WEBSITE,
    id: restaurantId,
    website: "https://should-not-be-fetched.invalid",
  };

  const result = await enrichEvidence(restaurant);
  assert.strictEqual(result.source, "cache");
  assert.strictEqual(result.enriched.menuSource, "restaurant_website");
});

// 9 — Domino's restaurants are skipped by id even when website is set
//      (dominos.com would otherwise fetch a marketing page on top of the
//      truthful provider-adapter API data; Beta DECIDE 2026-05-07 Q6)
test("enrichEvidence — dominos_* with website set → returns unchanged, no fetch, no cache lookup", async () => {
  const dominosWithWebsite: Restaurant = {
    id: "dominos_4242",
    name: "Domino's Pizza",
    phone: "+14155552323",
    address: "1 Market St, San Francisco, CA",
    lat: 0,
    lng: 0,
    deliveryRadius: 5,
    estimatedDeliveryMinutes: 30,
    acceptsCash: true,
    serviceType: "delivery",
    website: "https://www.dominos.com/",
    menu: {
      pizzas: [{ name: "Pepperoni", sizes: [{ name: "Large", price: 14.99 }] }],
      sides: [],
    },
    hours: "Daily",
  };

  const result = await enrichEvidence(dominosWithWebsite, "pepperoni");
  assert.strictEqual(result.source, "unchanged");
  assert.strictEqual(result.enriched, dominosWithWebsite);
  assert.strictEqual(result.deliveryCues, null);
  // Verify menuSource was NOT set (Domino's is provider-adapter truth, not website-fetched)
  assert.strictEqual(result.enriched.menuSource, undefined);
});

// T-011 — Drinks extraction tests

test("drinks parity with sides — cache hit returns drinks alongside sides", async () => {
  const restaurantId = "places_drinks_parity";
  const cachePath = join(TMP_DIR, `${restaurantId}.json`);
  const cache = {
    discoveredAt: new Date().toISOString(),
    source: "restaurant_website",
    pizzas: [{ name: "Pepperoni", sizes: [{ name: "Large", price: 16.99 }] }],
    sides: [{ name: "Wings", sizes: [{ name: "6pc", price: 6.99 }] }],
    drinks: [
      {
        id: "coke-20-oz",
        name: "Coke",
        sizes: [{ id: "20-oz", name: "20 oz", price: 2.5 }],
      },
    ],
    deliveryCues: {
      offersDelivery: true,
      deliveryRadiusMiles: 5,
      rawSignal: "delivery",
    },
  };
  writeFileSync(cachePath, JSON.stringify(cache));

  const restaurant: Restaurant = {
    ...PLACES_NO_WEBSITE,
    id: restaurantId,
    website: "https://example.invalid",
  };
  const result = await enrichEvidence(restaurant);
  assert.equal(result.source, "cache");
  assert.equal(result.enriched.menu.drinks?.length, 1);
  assert.equal(result.enriched.menu.drinks?.[0].name, "Coke");
  assert.equal(result.enriched.menu.sides?.length, 1);
});

test("fail-open when cache entry omits drinks array — validator rejects, falls back to unchanged", async () => {
  const restaurantId = "places_missing_drinks";
  const cachePath = join(TMP_DIR, `${restaurantId}.json`);
  // Intentionally omit drinks field
  const malformed = {
    discoveredAt: new Date().toISOString(),
    source: "restaurant_website",
    pizzas: [{ name: "Pepperoni", sizes: [{ name: "Large", price: 16.99 }] }],
    sides: [],
    deliveryCues: {
      offersDelivery: true,
      deliveryRadiusMiles: 5,
      rawSignal: "delivery",
    },
  };
  writeFileSync(cachePath, JSON.stringify(malformed));
  const restaurant: Restaurant = {
    ...PLACES_NO_WEBSITE,
    id: restaurantId,
    website: "https://example.invalid",
  };
  const result = await enrichEvidence(restaurant);
  // Validator rejects → cache miss → website fetch fails (invalid URL or no ANTHROPIC_API_KEY) → unchanged
  assert.equal(result.source, "unchanged");
});
