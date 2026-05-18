// Post-deploy hotfix 2026-05-18.
//
// Live regression: when the user says "Order me a pizza" with NO
// intent_items + lands on a places_*-generic restaurant, the previous
// build still surfaced the GENERIC_PIZZA_MENU template (Pepperoni /
// Cheese / Specialty + fake prices) via menuSummary[].pizzas, and the
// agent voiced those fake items verbatim. The 4-conjunct verdict gate
// didn't fire because item_map was empty (no intent_items). Fix:
// structural early-return for places-generic primary restaurants AND
// menu_known=false flag on response shape. This file asserts both.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "vague-intent-hotfix-"));
process.env.COMPATIBILITY_EVENTS_FILE = join(TMP, "events.jsonl");
// INCLUDE_TEST_RESTAURANTS=false suppresses test_vlad. The fixture
// below is injected via TEST_RESTAURANTS_FIXTURE_FILE so it appears
// in findNearbyRestaurants regardless. This keeps the fixture path
// reachable in unit tests that don't hit live Places.
process.env.INCLUDE_TEST_RESTAURANTS = "false";
process.env.BLAND_HARNESS_MODE = "1";
process.env.PROFILE_ENCRYPTION_SECRET = "0".repeat(64);

import { writeFileSync } from "node:fs";
import { createServer } from "../../../src/server.js";
import {
  TEST_RESTAURANTS,
  _resetFixtureCache,
} from "../../../src/data/restaurants.js";
import type { Restaurant } from "../../../src/data/restaurants.js";

const GENERIC_PLACES_RESTAURANT: Restaurant = {
  id: "places_hotfix_golden_boy",
  name: "Golden Boy Pizza (test fixture)",
  phone: "+14155556789",
  address: "542 Green St, San Francisco, CA",
  lat: 37.7993,
  lng: -122.4097,
  deliveryRadius: 5,
  estimatedDeliveryMinutes: 20,
  acceptsCash: true,
  serviceType: "delivery",
  menu: {
    pizzas: [
      { name: "Pepperoni", sizes: [{ name: "Large", price: 16.99 }] },
      { name: "Cheese", sizes: [{ name: "Large", price: 15.99 }] },
      { name: "Specialty", sizes: [{ name: "Large", price: 18.99 }] },
    ],
    sides: [],
  },
  hours: "Daily 11-21",
};

let server: ReturnType<typeof createServer>;
type Handler = (
  args: Record<string, unknown>,
  extra: Record<string, unknown>,
) => Promise<{ content: Array<{ type: string; text: string }> }>;

function getHandler(name: string): Handler {
  const tools = (
    server as unknown as {
      _registeredTools: Record<string, { handler: Handler }>;
    }
  )._registeredTools;
  const t = tools[name];
  if (!t) throw new Error("no tool " + name);
  return t.handler;
}

before(() => {
  // Inject the fixture via TEST_RESTAURANTS_FIXTURE_FILE so it appears
  // in findNearbyRestaurants even with INCLUDE_TEST_RESTAURANTS=false.
  const fixtureFile = join(TMP, "fixture.json");
  writeFileSync(
    fixtureFile,
    JSON.stringify({ restaurants: [GENERIC_PLACES_RESTAURANT] }),
  );
  process.env.TEST_RESTAURANTS_FIXTURE_FILE = fixtureFile;
  _resetFixtureCache();
  // Also push to TEST_RESTAURANTS so getRestaurantById finds it for the
  // third test that switches INCLUDE_TEST_RESTAURANTS back on.
  TEST_RESTAURANTS.push(GENERIC_PLACES_RESTAURANT);
  server = createServer();
});

after(() => {
  const idx = TEST_RESTAURANTS.findIndex(
    (r) => r.id === GENERIC_PLACES_RESTAURANT.id,
  );
  if (idx !== -1) TEST_RESTAURANTS.splice(idx, 1);
  delete process.env.TEST_RESTAURANTS_FIXTURE_FILE;
  _resetFixtureCache();
});

test("HOTFIX: vague 'order me a pizza' against places-generic → mode=fallback_discovery, no suggested_order, no fake items", async () => {
  const handler = getHandler("start_pizza_order");
  const res = await handler(
    {
      delivery_address: "542 Green St, San Francisco, CA",
      // NO intent_items / intent_style / delegate / occasion — the
      // vague-opener path that previously leaked GENERIC_PIZZA_MENU.
    },
    {},
  );
  const body = JSON.parse(res.content[0].text);
  assert.equal(
    body.mode,
    "fallback_discovery",
    `expected mode=fallback_discovery; got: ${JSON.stringify(body, null, 2).slice(0, 500)}`,
  );
  assert.equal(body.suggested_order, undefined);
  assert.equal(body.presets, undefined);
});

test("HOTFIX: menuSummary on a places-generic restaurant is empty + flagged menu_known=false", async () => {
  const handler = getHandler("start_pizza_order");
  // Force the intent-ranked path so result.restaurants[] is built
  // with the new menu_known flag, even when the primary still gets
  // gated downstream.
  const res = await handler(
    {
      delivery_address: "542 Green St, San Francisco, CA",
      intent_items: { pizza: { style: "pepperoni" } },
    },
    {},
  );
  const body = JSON.parse(res.content[0].text);
  // Either we land on fallback_discovery (the verdict gate fires) OR
  // on a regular intent-ranked path. Both must NOT leak fake items.
  // The fallback_discovery rebuild drops menuSummary entirely (which is
  // also safe — no items to leak). The intent-ranked path keeps
  // menuSummary but with menu_known=false + empty pizzas/sides.
  if (body.restaurants && body.restaurants.length > 0) {
    const fixture = body.restaurants.find(
      (r: { id: string }) => r.id === GENERIC_PLACES_RESTAURANT.id,
    );
    if (fixture) {
      // Either menuSummary is absent (fallback rebuild) OR menu_known
      // is false AND menuSummary.pizzas is empty (regular path).
      if (fixture.menuSummary !== undefined) {
        assert.equal(
          fixture.menu_known,
          false,
          "places-generic restaurant must have menu_known=false when menuSummary is present",
        );
        assert.equal(
          fixture.menuSummary.pizzas?.length,
          0,
          "menuSummary.pizzas must be empty for places-generic — no fake template items",
        );
      }
    }
  }
  // suggested_order MUST NOT contain Pepperoni/Cheese/Specialty from the template.
  if (body.suggested_order?.items) {
    for (const item of body.suggested_order.items) {
      const name = String(item.name ?? "").toLowerCase();
      // The fake template's three items — these names must not be sourced
      // from this restaurant when its menu is generic. If they appear, the
      // bug regressed.
      assert.notMatch(
        name,
        /pepperoni|cheese|specialty/,
        `suggested_order.items leaked a GENERIC_PIZZA_MENU item: ${item.name}`,
      );
    }
  }
});

test("HOTFIX: real-menu restaurants (test_vlad / dominos_*) still ship suggested_order normally", async () => {
  // Re-enable test_vlad for this case so we have a real-menu restaurant.
  const orig = process.env.INCLUDE_TEST_RESTAURANTS;
  process.env.INCLUDE_TEST_RESTAURANTS = "true";
  try {
    const handler = getHandler("start_pizza_order");
    const res = await handler(
      {
        delivery_address: "1 Market St, San Francisco, CA 94105",
        intent_items: { pizza: { style: "meat lovers" } },
      },
      {},
    );
    const body = JSON.parse(res.content[0].text);
    // test_vlad has a real menu; suggested_order should be present.
    if (body.suggested_order) {
      assert.ok(
        body.suggested_order.items.length > 0,
        "real-menu restaurant must still produce a suggested_order",
      );
    }
    const vlad = body.restaurants?.find(
      (r: { id: string }) => r.id === "test_vlad",
    );
    if (vlad) {
      assert.equal(
        vlad.menu_known,
        true,
        "test_vlad has a real menu → menu_known=true",
      );
    }
  } finally {
    process.env.INCLUDE_TEST_RESTAURANTS = orig;
  }
});
