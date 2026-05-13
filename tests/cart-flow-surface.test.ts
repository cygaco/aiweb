import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCallPrompt } from "../src/connectors/bland.js";
import {
  buildCustomizationSurface,
  legacyItemsToCart,
} from "../src/lib/cart-flow.js";
import type { Drink } from "../src/lib/cart.js";
import { TEST_RESTAURANTS } from "../src/data/restaurants.js";

describe("cart customization surface", () => {
  test("Vlad suggested order exposes modifiers, drinks, sides, and deals", () => {
    const restaurant = TEST_RESTAURANTS.find((r) => r.id === "test_vlad")!;
    const cart = legacyItemsToCart(
      [
        {
          name: "Meat Lovers",
          size: 'Large 14"',
          quantity: 1,
          price: 15.99,
        },
      ],
      restaurant,
    );
    const surface = buildCustomizationSurface(restaurant, cart, "mcp");

    assert.ok(surface.customization_options?.["Meat Lovers"]?.crusts);
    assert.ok(surface.customization_options?.["Meat Lovers"]?.toppings);
    // 4 real drinks (Coca-Cola, Diet Coke, Sprite, Dasani Water) + 2 defaults
    // (case-insensitive name match: "Coca-Cola" != "Coke" so Coke default
    // kept; "Diet Coke"/"Sprite" suppressed; "Dasani Water" != "Water" so
    // Water default kept).
    assert.equal(surface.drink_options?.length, 6);
    // 2 real sides ("Wings (8pc)", "Cheesy Bread") + 3 defaults
    // ("wings (8pc)" != "wings" so Wings default kept; "Cheesy Bread" matches
    // "Cheesy bread"; Breadsticks/Garlic knots not in real menu).
    assert.equal(surface.side_options?.length, 5);
    assert.equal(surface.applicable_deals?.length, 2);
  });
});

describe("Bland cart renderer", () => {
  test("cart path renders modifiers and drink lines", () => {
    const prompt = buildCallPrompt({
      restaurantName: "Vlad's Pizza Restaurant",
      restaurantPhone: "+14152335033",
      deliveryAddress: "5208 Riddle By Pass Rd, Riddle, OR 97469",
      customerName: "Vlad",
      customerPhone: "+14152335033",
      cart: [
        {
          kind: "pizza",
          itemId: "test_vlad_meat_lovers",
          name: "Meat Lovers",
          sizeId: "large_14",
          sizeLabel: 'Large 14"',
          quantity: 1,
          basePrice: 15.99,
          modifiers: [
            {
              groupId: "toppings",
              optionId: "extra_cheese",
              name: "Extra Cheese",
              priceDelta: 1.5,
              placement: "whole",
              amount: "extra",
            },
          ],
        },
        {
          kind: "drink",
          itemId: "coke_2l",
          name: "Coca-Cola",
          sizeId: "2l",
          sizeLabel: "2L Bottle",
          quantity: 1,
          basePrice: 3.99,
        },
      ],
    });

    assert.match(prompt, /Extra Cheese/);
    assert.match(prompt, /Coca-Cola/);
    assert.match(prompt, /EXPECTED TOTAL: approximately \$21\.48/);
    assert.match(prompt, /Riddle By Pass Road/);
  });
});

describe("customization surface — discriminated union + merge + TR-2 event", () => {
  test("merges defaults at medium confidence when real menu lacks an item", () => {
    const restaurant = TEST_RESTAURANTS.find((r) => r.id === "test_vlad")!;
    const cart = legacyItemsToCart(
      [{ name: "Meat Lovers", size: 'Large 14"', quantity: 1, price: 15.99 }],
      restaurant,
    );
    const surface = buildCustomizationSurface(restaurant, cart, "mcp");
    // Real Coke present at high confidence (has id, no menu_confidence field)
    const coke = surface.drink_options?.find(
      (d) =>
        d.name.toLowerCase().includes("coca-cola") ||
        d.name.toLowerCase() === "coke",
    );
    assert.ok(coke, "real Coke should be present");
    assert.ok("id" in coke!, "real Coke should be Drink with id");
    // Default Water present at medium confidence (case-insensitive non-match with Dasani Water)
    const water = surface.drink_options?.find(
      (d) => "menu_confidence" in d && d.name === "Water",
    );
    assert.ok(water, "default Water should be present at medium confidence");
    assert.equal(
      (water as { menu_confidence: string }).menu_confidence,
      "medium",
    );
  });

  test("emits customization-surface-built event with surface tag", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cf-surface-evt-"));
    const evtFile = join(tmp, "events.jsonl");
    process.env.COMPATIBILITY_EVENTS_FILE = evtFile;

    const restaurant = TEST_RESTAURANTS.find((r) => r.id === "test_vlad")!;
    const cart = legacyItemsToCart(
      [{ name: "Meat Lovers", size: 'Large 14"', quantity: 1, price: 15.99 }],
      restaurant,
    );
    buildCustomizationSurface(restaurant, cart, "mcp");

    const lines = readFileSync(evtFile, "utf8").trim().split("\n");
    const surfaceEvents = lines
      .map(
        (l) => JSON.parse(l) as { cat: string; data: Record<string, unknown> },
      )
      .filter((e) => e.cat === "customization-surface-built");
    assert.ok(
      surfaceEvents.length >= 1,
      "must emit at least one customization-surface-built event",
    );
    assert.equal(surfaceEvents[0].data.surface, "mcp");
    assert.equal(
      typeof surfaceEvents[0].data.drink_options_count_high,
      "number",
    );
    assert.equal(
      typeof surfaceEvents[0].data.drink_options_count_medium,
      "number",
    );

    delete process.env.COMPATIBILITY_EVENTS_FILE;
  });

  // Type-wall: DrinkOption is intentionally NOT a Drink. The following would
  // FAIL TypeScript compilation if uncommented:
  //   const bad: Drink = { name: "X", sizes: [{ name: "20oz" }], menu_confidence: "medium" };
  // cartTotal accepts CartItem[]; DrinkOption is not a CartItem (no kind/itemId/basePrice).
  // The compile-time check is the wall; tsc --noEmit in CI is the gate.
  test("type-wall: Drink and DrinkOption are distinct shapes (compile-time gate)", () => {
    // Runtime check: real entries narrow on menu_confidence:"high" and have id;
    // defaults narrow on menu_confidence:"medium" and lack id.
    const restaurant = TEST_RESTAURANTS.find((r) => r.id === "test_vlad")!;
    const cart = legacyItemsToCart(
      [{ name: "Meat Lovers", size: 'Large 14"', quantity: 1, price: 15.99 }],
      restaurant,
    );
    const surface = buildCustomizationSurface(restaurant, cart, "mcp");
    const realDrinks = (surface.drink_options ?? []).filter(
      (d) => d.menu_confidence === "high",
    );
    const defaultDrinks = (surface.drink_options ?? []).filter(
      (d) => d.menu_confidence !== "high",
    );
    assert.ok(realDrinks.length > 0, "at least one high-confidence real drink");
    assert.ok(
      defaultDrinks.length > 0,
      "at least one medium-confidence default drink",
    );
    // Real drinks must have id; defaults must NOT
    for (const d of realDrinks) {
      assert.ok("id" in d, "real drink has id");
    }
    for (const d of defaultDrinks) {
      assert.ok(!("id" in d), "default drink has no id");
    }
  });

  test("type-wall: DrinkOption is NOT a Drink (@ts-expect-error compile-time)", () => {
    // @ts-expect-error — Drink requires id and price; DrinkOption has neither.
    const bad: Drink = {
      name: "X",
      sizes: [{ name: "20oz" }],
      menu_confidence: "medium",
    };
    // If the @ts-expect-error directive is satisfied (i.e. the line WOULD error
    // without it), the type wall holds. Reference `bad` to satisfy noUnusedLocals.
    void bad;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-23 NEW TESTS (SP-20260512-002) — brand suppression + deal helpers
// ─────────────────────────────────────────────────────────────────────────────

import { dealComponentsMatchCart, dealSavings } from "../src/lib/cart-flow.js";
import type { Cart, CartItem } from "../src/lib/cart.js";
import type { Restaurant } from "../src/data/restaurants.js";

// ── Additional fixtures ───────────────────────────────────────────────────

const VLAD_R = TEST_RESTAURANTS.find((r) => r.id === "test_vlad")!;

// Pepsi-only restaurant (mirrors S-22 but for surface tests)
const PEPSI_RESTAURANT: Restaurant = {
  id: "test_pepsi_r",
  name: "Pepsi Pizza Co.",
  phone: "+14155559999",
  address: "SF, CA",
  lat: 37.775,
  lng: -122.42,
  deliveryRadius: 10,
  estimatedDeliveryMinutes: 35,
  acceptsCash: true,
  serviceType: "delivery",
  menu: {
    pizzas: [
      { name: "Pepperoni", sizes: [{ name: 'Large 14"', price: 12.99 }] },
    ],
    sides: [{ name: "Wings", sizes: [{ name: "Regular", price: 7.99 }] }],
    drinks: [
      {
        id: "pepsi_20oz",
        name: "Pepsi",
        brand: "Pepsi",
        sizes: [{ id: "20oz", name: "20oz Bottle", price: 2.49 }],
      },
      {
        id: "water_pepsi",
        name: "Water",
        sizes: [{ id: "20oz", name: "20oz Bottle", price: 1.5 }],
      },
    ],
  },
  hours: "11–11",
  isTest: true,
};

// No-drinks restaurant
const NO_DRINKS_RESTAURANT: Restaurant = {
  id: "test_nodrinks",
  name: "Dry Pizza",
  phone: "+14155550000",
  address: "SF, CA",
  lat: 37.775,
  lng: -122.42,
  deliveryRadius: 10,
  estimatedDeliveryMinutes: 30,
  acceptsCash: true,
  serviceType: "delivery",
  menu: {
    pizzas: [{ name: "Cheese", sizes: [{ name: "Large", price: 11.99 }] }],
    sides: [],
  },
  hours: "11–11",
  isTest: true,
};

// Unbranded-drinks restaurant
const UNBRANDED_RESTAURANT: Restaurant = {
  ...NO_DRINKS_RESTAURANT,
  id: "test_unbranded",
  menu: {
    ...NO_DRINKS_RESTAURANT.menu,
    drinks: [
      {
        id: "house_cola",
        name: "House Cola",
        // no brand field — undefined
        sizes: [{ id: "20oz", name: "20oz", price: 1.99 }],
      },
    ],
  },
};

// ── S-23 Tests ────────────────────────────────────────────────────────────

describe("S-23: brand suppression", () => {
  // 1. Real Pepsi entries → Coke/Diet Coke/Sprite defaults dropped, Water retained
  test("S23-1: Pepsi real drinks → Coke/Diet Coke/Sprite defaults suppressed, Water retained", () => {
    const cart = legacyItemsToCart(
      [{ name: "Pepperoni", size: 'Large 14"', quantity: 1, price: 12.99 }],
      PEPSI_RESTAURANT,
    );
    const surface = buildCustomizationSurface(PEPSI_RESTAURANT, cart, "mcp");
    const drinkNames = (surface.drink_options ?? []).map((d) =>
      d.name.toLowerCase(),
    );
    // Pepsi real drink present
    assert.ok(drinkNames.some((n) => n.includes("pepsi")));
    // Coke/Diet Coke/Sprite defaults from coca_cola portfolio suppressed
    assert.ok(
      !drinkNames.includes("coke"),
      "Coke default should be suppressed",
    );
    assert.ok(
      !drinkNames.includes("diet coke"),
      "Diet Coke default should be suppressed",
    );
    assert.ok(
      !drinkNames.includes("sprite"),
      "Sprite default should be suppressed",
    );
    // Water retained (no brand → never suppressed)
    assert.ok(drinkNames.some((n) => n.includes("water")));
  });

  // 2. Real Coca-Cola entries → Coke/Diet Coke/Sprite defaults stay (same portfolio)
  test("S23-2: Coca-Cola real drinks → same-portfolio defaults (Coke/Sprite) retained", () => {
    const cart = legacyItemsToCart(
      [{ name: "Meat Lovers", size: 'Large 14"', quantity: 1, price: 15.99 }],
      VLAD_R,
    );
    const surface = buildCustomizationSurface(VLAD_R, cart, "mcp");
    const drinkNames = (surface.drink_options ?? []).map((d) =>
      d.name.toLowerCase(),
    );
    // Real Coca-Cola (high confidence) present
    assert.ok(drinkNames.some((n) => n.includes("coca-cola")));
    // Coke default (same portfolio — coca_cola) should NOT be suppressed by brand
    // Note: name-match may suppress it if "Coke" == "Coca-Cola" but they differ
    // (Coca-Cola != Coke case-insensitively) so Coke default should remain
    assert.ok(
      drinkNames.some((n) => n === "coke"),
      "Coke default should remain (different name from Coca-Cola, same portfolio)",
    );
    // Water retained
    assert.ok(drinkNames.some((n) => n.includes("water")));
  });

  // 3. No real drinks → all defaults surface unchanged
  test("S23-3: no real drinks → all defaults surface unchanged", () => {
    const cart = legacyItemsToCart(
      [{ name: "Cheese", size: "Large", quantity: 1, price: 11.99 }],
      NO_DRINKS_RESTAURANT,
    );
    const surface = buildCustomizationSurface(
      NO_DRINKS_RESTAURANT,
      cart,
      "mcp",
    );
    const drinkNames = (surface.drink_options ?? []).map((d) =>
      d.name.toLowerCase(),
    );
    // All 4 defaults should be present
    assert.ok(drinkNames.includes("coke"));
    assert.ok(drinkNames.includes("diet coke"));
    assert.ok(drinkNames.includes("sprite"));
    assert.ok(drinkNames.some((n) => n.includes("water")));
  });

  // 4. Real drink with brand===undefined → no suppression applied
  test("S23-4: real drink with brand=undefined (unbranded) → no portfolio suppression", () => {
    const cart = legacyItemsToCart(
      [{ name: "Cheese", size: "Large", quantity: 1, price: 11.99 }],
      UNBRANDED_RESTAURANT,
    );
    const surface = buildCustomizationSurface(
      UNBRANDED_RESTAURANT,
      cart,
      "mcp",
    );
    const drinkNames = (surface.drink_options ?? []).map((d) =>
      d.name.toLowerCase(),
    );
    // Coke/Diet Coke/Sprite defaults should NOT be suppressed (no real portfolio)
    assert.ok(drinkNames.includes("coke"), "Coke default should remain");
    assert.ok(drinkNames.includes("sprite"), "Sprite default should remain");
  });

  // 5. Real drink with unknown portfolio → no suppression of name-portfolio defaults
  test("S23-5: real drink with regional brand (unknown portfolio) → no suppression of name-portfolio defaults", () => {
    const regionalRestaurant: Restaurant = {
      ...NO_DRINKS_RESTAURANT,
      id: "test_regional",
      menu: {
        ...NO_DRINKS_RESTAURANT.menu,
        drinks: [
          {
            id: "nehi_grape",
            name: "Nehi Grape",
            brand: "Nehi", // not in BRAND_PORTFOLIOS → unknown
            sizes: [{ id: "12oz", name: "12oz", price: 1.5 }],
          },
        ],
      },
    };
    const cart = legacyItemsToCart(
      [{ name: "Cheese", size: "Large", quantity: 1, price: 11.99 }],
      regionalRestaurant,
    );
    const surface = buildCustomizationSurface(regionalRestaurant, cart, "mcp");
    const drinkNames = (surface.drink_options ?? []).map((d) =>
      d.name.toLowerCase(),
    );
    // Unknown portfolio → no suppression of Coke/Sprite/Diet Coke
    assert.ok(drinkNames.includes("coke"), "Coke default should remain");
    assert.ok(drinkNames.includes("sprite"), "Sprite default should remain");
  });

  // 6. suppressed_default_count field present on event log
  test("S23-6: suppressed_default_count field present on customization-surface-built event", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cf-s23-"));
    const evtFile = join(tmp, "events.jsonl");
    process.env.COMPATIBILITY_EVENTS_FILE = evtFile;

    const cart = legacyItemsToCart(
      [{ name: "Pepperoni", size: 'Large 14"', quantity: 1, price: 12.99 }],
      PEPSI_RESTAURANT,
    );
    buildCustomizationSurface(PEPSI_RESTAURANT, cart, "mcp");

    const lines = readFileSync(evtFile, "utf8").trim().split("\n");
    const evt = lines
      .map(
        (l) => JSON.parse(l) as { cat: string; data: Record<string, unknown> },
      )
      .find((e) => e.cat === "customization-surface-built");
    assert.ok(evt, "must have customization-surface-built event");
    assert.ok(
      "suppressed_default_count" in evt!.data,
      "event must have suppressed_default_count field",
    );
    assert.ok(
      typeof evt!.data.suppressed_default_count === "number",
      "suppressed_default_count must be a number",
    );
    // Pepsi restaurant should suppress Coke/Diet Coke/Sprite (3 coca_cola defaults)
    assert.ok(
      (evt!.data.suppressed_default_count as number) >= 3,
      `Expected >= 3 suppressed defaults, got ${evt!.data.suppressed_default_count}`,
    );
    delete process.env.COMPATIBILITY_EVENTS_FILE;
  });

  // 7. real_drink_portfolios field present on event log
  test("S23-7: real_drink_portfolios field present on customization-surface-built event", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cf-s23-portf-"));
    const evtFile = join(tmp, "events.jsonl");
    process.env.COMPATIBILITY_EVENTS_FILE = evtFile;

    const cart = legacyItemsToCart(
      [{ name: "Pepperoni", size: 'Large 14"', quantity: 1, price: 12.99 }],
      PEPSI_RESTAURANT,
    );
    buildCustomizationSurface(PEPSI_RESTAURANT, cart, "mcp");

    const lines = readFileSync(evtFile, "utf8").trim().split("\n");
    const evt = lines
      .map(
        (l) => JSON.parse(l) as { cat: string; data: Record<string, unknown> },
      )
      .find((e) => e.cat === "customization-surface-built");
    assert.ok(evt, "must have customization-surface-built event");
    assert.ok(
      "real_drink_portfolios" in evt!.data,
      "event must have real_drink_portfolios field",
    );
    assert.ok(
      Array.isArray(evt!.data.real_drink_portfolios),
      "real_drink_portfolios must be an array",
    );
    // Pepsi restaurant → portfolios include "pepsi"
    assert.ok(
      (evt!.data.real_drink_portfolios as string[]).includes("pepsi"),
      "real_drink_portfolios must include pepsi",
    );
    delete process.env.COMPATIBILITY_EVENTS_FILE;
  });
});

describe("S-23: dealComponentsMatchCart", () => {
  const vladMixMatch = VLAD_R.menu.deals!.find(
    (d) => d.id === "vlad_mix_match",
  )!;
  const vladFamilyCombo = VLAD_R.menu.deals!.find(
    (d) => d.id === "vlad_family_combo",
  )!;

  // 8. dealComponentsMatchCart with mix_match deal and qualifying cart → true
  test("S23-8: dealComponentsMatchCart — vlad_mix_match + [medium pizza, side] → true", () => {
    const cart: Cart = [
      {
        kind: "pizza",
        itemId: "test_vlad_pepperoni",
        name: "Pepperoni",
        sizeId: "medium_12",
        sizeLabel: 'Medium 12"',
        quantity: 1,
        basePrice: 10.99,
      },
      {
        kind: "side",
        itemId: "test_vlad_wings_8pc",
        name: "Wings (8pc)",
        sizeId: "regular",
        sizeLabel: "Regular",
        quantity: 1,
        basePrice: 8.99,
      },
    ];
    assert.strictEqual(dealComponentsMatchCart(vladMixMatch, cart), true);
  });

  // 9. dealComponentsMatchCart — large-only cart doesn't meet mix_match
  test("S23-9: dealComponentsMatchCart — [large pepperoni only] with minItems=2 → false", () => {
    const cart: Cart = [
      {
        kind: "pizza",
        itemId: "test_vlad_pepperoni",
        name: "Pepperoni",
        sizeId: "large_14",
        sizeLabel: 'Large 14"',
        quantity: 1,
        basePrice: 12.99,
      },
    ];
    // vlad_mix_match requires medium pizza + minItems=2 eligible items
    // large pizza doesn't match medium constraint AND count is 1 < 2
    assert.strictEqual(dealComponentsMatchCart(vladMixMatch, cart), false);
  });

  // 10. dealComponentsMatchCart — empty cart → false
  test("S23-10: dealComponentsMatchCart — empty cart → false", () => {
    assert.strictEqual(dealComponentsMatchCart(vladMixMatch, []), false);
    assert.strictEqual(dealComponentsMatchCart(vladFamilyCombo, []), false);
  });

  // 11. dealSavings — family combo with matching cart → verified: true, savings > 0
  test("S23-11: dealSavings — vlad_family_combo with matching cart → verified=true, savings>0", () => {
    const cart: Cart = [
      {
        kind: "pizza",
        itemId: "test_vlad_pepperoni",
        name: "Pepperoni",
        sizeId: "large_14",
        sizeLabel: 'Large 14"',
        quantity: 2,
        basePrice: 12.99,
      },
      {
        kind: "side",
        itemId: "wings_8pc",
        name: "Wings (8pc)",
        sizeId: "regular",
        sizeLabel: "Regular",
        quantity: 1,
        basePrice: 8.99,
      },
      {
        kind: "drink",
        itemId: "coke_2l",
        name: "Coke 2L",
        sizeId: "2l",
        sizeLabel: "2L",
        quantity: 1,
        basePrice: 3.99,
      },
    ];
    const result = dealSavings(vladFamilyCombo, cart, VLAD_R);
    assert.strictEqual(result.verified, true);
    assert.ok(result.savings !== null && result.savings > 0);
    assert.match(result.reason, /matched at high confidence|all components/i);
  });

  // 12. dealSavings — mismatch cart → verified: false, savings: null
  test("S23-12: dealSavings — vlad_family_combo with mismatch cart → verified=false, savings=null", () => {
    // Only one large pizza, no side, no drink — family combo needs 2 pizzas + side + drink
    const cart: Cart = [
      {
        kind: "pizza",
        itemId: "test_vlad_pepperoni",
        name: "Pepperoni",
        sizeId: "large_14",
        sizeLabel: 'Large 14"',
        quantity: 1,
        basePrice: 12.99,
      },
    ];
    const result = dealSavings(vladFamilyCombo, cart, VLAD_R);
    assert.strictEqual(result.verified, false);
    assert.strictEqual(result.savings, null);
    assert.ok(result.reason.length > 0);
  });

  // 13. applicable_deals[].match === 'page_only' on empty cart for all deals
  test("S23-13: applicable_deals all page_only when cart is empty", () => {
    const emptyCart: Cart = [];
    const surface = buildCustomizationSurface(VLAD_R, emptyCart, "mcp");
    assert.ok(
      surface.applicable_deals?.length ?? 0 > 0,
      "vlad should have deals",
    );
    for (const entry of surface.applicable_deals ?? []) {
      assert.strictEqual(
        entry.match,
        "page_only",
        `Deal "${entry.deal.name}" should be page_only on empty cart`,
      );
      assert.strictEqual(entry.savings, null);
    }
  });

  // 14. applicable_deals[].match === 'components_align' with verified savings when cart matches
  test("S23-14: applicable_deals components_align + savings != null when cart matches family combo", () => {
    const cart: Cart = [
      {
        kind: "pizza",
        itemId: "test_vlad_pepperoni",
        name: "Pepperoni",
        sizeId: "large_14",
        sizeLabel: 'Large 14"',
        quantity: 2,
        basePrice: 12.99,
      },
      {
        kind: "side",
        itemId: "wings_8pc",
        name: "Wings (8pc)",
        sizeId: "regular",
        sizeLabel: "Regular",
        quantity: 1,
        basePrice: 8.99,
      },
      {
        kind: "drink",
        itemId: "coke_2l",
        name: "Coke 2L",
        sizeId: "2l",
        sizeLabel: "2L",
        quantity: 1,
        basePrice: 3.99,
      },
    ];
    const surface = buildCustomizationSurface(VLAD_R, cart, "mcp");
    const familyEntry = surface.applicable_deals?.find(
      (d) => d.deal.id === "vlad_family_combo",
    );
    assert.ok(familyEntry, "vlad_family_combo should be in applicable_deals");
    assert.strictEqual(familyEntry!.match, "components_align");
    assert.ok(
      familyEntry!.savings !== null && familyEntry!.savings > 0,
      `Expected savings > 0, got ${familyEntry!.savings}`,
    );
  });
});
