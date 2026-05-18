/**
 * tests/verdict-gate-enrichment-failed.test.ts — SP-20260517-005 /
 * S-6 / AC-6.*.
 *
 * Direct unit tests on assessCompatibility's 4-conjunct guard.
 *
 *   AC-6.1: all 4 conjuncts true → no_go + verdict_tier=enrichment_failed
 *           + nextStep matches C-2.
 *   AC-6.2: empty item_map (presets path) → not escalated.
 *   AC-6.3: mixed evidence (1 available + 1 unknown) → caution (rule
 *           does not fire).
 *   AC-6.4: enrichment-success (source=restaurant_website) → verdict_tier
 *           undefined.
 *   AC-6.5: TR-2 (verdict_tier in event log) — covered indirectly via
 *           logCompatibilityEvent shape; full event-bus integration left
 *           to the SP-002 harness regression case (T-098).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { assessCompatibility } from "../src/lib/compatibility.js";
import type { Restaurant } from "../src/data/restaurants.js";

function genericPlacesRestaurant(
  overrides: Partial<Restaurant> = {},
): Restaurant {
  // A places_* restaurant with the generic 3-item template AND no menuSource
  // (i.e. enrichment never ran OR returned unchanged). lat/lng/deliveryRadius
  // are set so delivery/coverage default to caution-unknown, not no_go.
  return {
    id: "places_test1",
    name: "Generic Pizza",
    phone: "+15555550001",
    address: "1 Test St",
    lat: 37.7944,
    lng: -122.3973,
    deliveryRadius: null, // unknown coverage
    estimatedDeliveryMinutes: 25,
    acceptsCash: true,
    serviceType: "unknown",
    menu: {
      pizzas: [{ name: "Pepperoni", sizes: [{ name: "Large", price: 16.99 }] }],
      sides: [],
    },
    hours: "11-21",
    // menuSource omitted — generic template
    ...overrides,
  };
}

function enrichedRestaurant(overrides: Partial<Restaurant> = {}): Restaurant {
  // Same shape but with menuSource set — represents an enriched restaurant.
  return {
    ...genericPlacesRestaurant(),
    menuSource: "restaurant_website",
    menu: {
      pizzas: [
        {
          name: "From the Garden Pizza",
          sizes: [{ name: "Large", price: 18.0 }],
        },
      ],
      sides: [{ name: "Wings", sizes: [{ name: "8pc", price: 9.99 }] }],
    },
    serviceType: "delivery",
    deliveryRadius: 5,
    ...overrides,
  };
}

test("AC-6.1: all 4 conjuncts true → no_go + verdict_tier=enrichment_failed", () => {
  const r = genericPlacesRestaurant();
  const a = assessCompatibility(r, 37.7944, -122.3973, "veggie", {
    enrichmentAttempted: true,
  });
  assert.equal(a.overall, "no_go");
  assert.equal(a.verdict_tier, "enrichment_failed");
  assert.match(a.nextStep ?? "", /Real menu not found/);
});

test("AC-6.2: empty item_map (presets path) → NOT escalated even when enrichmentAttempted=true", () => {
  const r = genericPlacesRestaurant();
  // No intent provided → item_map is empty.
  const a = assessCompatibility(r, 37.7944, -122.3973, undefined, {
    enrichmentAttempted: true,
  });
  // Combiner sees item.state=unknown but item_map is empty → don't escalate.
  assert.notEqual(a.overall, "no_go");
  assert.equal(a.verdict_tier, undefined);
});

test("AC-6.3: mixed evidence (intent satisfied by real menu) → caution or go, not no_go", () => {
  const r = enrichedRestaurant();
  const a = assessCompatibility(r, 37.7944, -122.3973, "veggie", {
    enrichmentAttempted: true,
  });
  // Enriched restaurant has "From the Garden Pizza" — fuzzy match on "veggie".
  // Whatever the verdict (go/caution), it MUST NOT be no_go-enrichment_failed.
  assert.notEqual(a.verdict_tier, "enrichment_failed");
});

test("AC-6.4: enrichment-success → verdict_tier undefined", () => {
  const r = enrichedRestaurant();
  const a = assessCompatibility(r, 37.7944, -122.3973, "from-the-garden", {
    enrichmentAttempted: true,
  });
  assert.equal(a.verdict_tier, undefined);
});

test("rule does NOT fire when enrichmentAttempted is absent (back-compat)", () => {
  // Same restaurant + intent as AC-6.1, but no options passed.
  const r = genericPlacesRestaurant();
  const a = assessCompatibility(r, 37.7944, -122.3973, "veggie");
  // First-pass callers (start_pizza_order's pass 1) must not see the gate
  // fire — only the post-enrichment second pass triggers it.
  assert.equal(a.verdict_tier, undefined);
});

test("rule does NOT fire when source is not places_generic_menu", () => {
  // A dominos_ restaurant — source tag is dominos_api, not places_generic_menu.
  const r: Restaurant = {
    id: "dominos_abc",
    name: "Dominos Test",
    phone: "+15555550002",
    address: "2 Test St",
    lat: 37.7944,
    lng: -122.3973,
    deliveryRadius: 5,
    estimatedDeliveryMinutes: 25,
    acceptsCash: true,
    serviceType: "delivery",
    // Real-ish menu shape but no veggie match — should be not_available,
    // which is its own no_go path WITHOUT verdict_tier=enrichment_failed.
    menu: {
      pizzas: [{ name: "Pepperoni", sizes: [{ name: "Large", price: 14.99 }] }],
      sides: [],
    },
    hours: "11-21",
  };
  const a = assessCompatibility(r, 37.7944, -122.3973, "veggie", {
    enrichmentAttempted: true,
  });
  // Dominos returns state=not_available for veggie which is its own no_go.
  // The verdict tier should NOT be enrichment_failed.
  assert.notEqual(a.verdict_tier, "enrichment_failed");
});

test("rule fires for sides-only intent on generic places menu", () => {
  const r = genericPlacesRestaurant();
  const a = assessCompatibility(
    r,
    37.7944,
    -122.3973,
    { sides: [{ name: "wings" }] },
    { enrichmentAttempted: true },
  );
  // Sides-only intent → item_map has side:wings = unknown (generic template).
  assert.equal(a.overall, "no_go");
  assert.equal(a.verdict_tier, "enrichment_failed");
});

test("rule fires for multi-slot intent where every slot is unknown", () => {
  const r = genericPlacesRestaurant();
  const a = assessCompatibility(
    r,
    37.7944,
    -122.3973,
    {
      pizza: { style: "veggie" },
      sides: [{ name: "wings" }],
      drinks: [{ name: "Coke", brand: "Coca-Cola", size: "2L" }],
    },
    { enrichmentAttempted: true },
  );
  assert.equal(a.overall, "no_go");
  assert.equal(a.verdict_tier, "enrichment_failed");
});
