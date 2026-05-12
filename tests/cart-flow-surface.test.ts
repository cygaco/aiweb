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
