/**
 * Preset / per-restaurant size binding tests.
 *
 * Run: npm test  OR  npx tsx --test tests/preset-restaurant-binding.test.ts
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  pickSizeForPizza,
  orderFromIntent,
  COLD_PRESETS,
} from "../src/lib/presets.js";
import type { Restaurant } from "../src/data/restaurants.js";
import { TEST_RESTAURANTS } from "../src/data/restaurants.js";
import {
  buildCallPrompt,
  type PlaceOrderRequest,
} from "../src/connectors/bland.js";

const VLAD = TEST_RESTAURANTS.find((r) => r.id === "test_vlad")!;

// A synthetic restaurant where Large is 16" (not 14") and prices differ.
// Verifies the preset functions read sizes from the chosen restaurant's menu.
const SIXTEEN_INCH: Restaurant = {
  id: "synthetic_16",
  name: "Sixteen Inch Pizza Co",
  phone: "+15555550100",
  address: "Test, USA",
  lat: 0,
  lng: 0,
  deliveryRadius: 10,
  estimatedDeliveryMinutes: 30,
  acceptsCash: true,
  hours: "11:00 AM - 11:00 PM",
  menu: {
    pizzas: [
      {
        name: "Pepperoni",
        sizes: [
          { name: 'Medium 12"', price: 13.5 },
          { name: 'Large 16"', price: 18.99 },
        ],
      },
      {
        name: "Cheese",
        sizes: [{ name: 'Large 16"', price: 16.99 }],
      },
      {
        name: "Meat Lovers",
        sizes: [{ name: 'Large 16"', price: 22.99 }],
      },
      {
        name: "Veggie",
        sizes: [{ name: 'Large 16"', price: 19.99 }],
      },
    ],
    sides: [
      { name: "Wings (8pc)", sizes: [{ name: "Regular", price: 11.99 }] },
      { name: "Garden Salad", sizes: [{ name: "Regular", price: 9.99 }] },
    ],
  },
  isTest: true,
};

// A restaurant whose menu has only Pepperoni (no cheese/meat-lovers/etc.).
// Used to verify presets that need missing pizzas degrade gracefully.
const PEPPERONI_ONLY: Restaurant = {
  ...SIXTEEN_INCH,
  id: "synthetic_pep_only",
  menu: {
    pizzas: [
      {
        name: "Pepperoni",
        sizes: [{ name: 'Large 16"', price: 18.99 }],
      },
    ],
    sides: [],
  },
};

describe("pickSizeForPizza", () => {
  test("exact name + exact size returns correct {sizeLabel, price}", () => {
    const got = pickSizeForPizza(VLAD, "Pepperoni", "large");
    assert.deepEqual(got, { sizeLabel: 'Large 14"', price: 12.99 });
  });

  test("exact name with medium preference", () => {
    const got = pickSizeForPizza(VLAD, "Pepperoni", "medium");
    assert.deepEqual(got, { sizeLabel: 'Medium 12"', price: 10.99 });
  });

  test("exact name with small preference", () => {
    const got = pickSizeForPizza(VLAD, "Pepperoni", "small");
    assert.deepEqual(got, { sizeLabel: 'Small 10"', price: 8.99 });
  });

  test("synthetic restaurant emits 16-inch sizes", () => {
    const got = pickSizeForPizza(SIXTEEN_INCH, "Pepperoni", "large");
    assert.deepEqual(got, { sizeLabel: 'Large 16"', price: 18.99 });
  });

  test("missing pizza returns null (no silent fallback)", () => {
    const got = pickSizeForPizza(VLAD, "Hawaiian", "large");
    assert.equal(got, null);
  });

  test("missing size for an existing pizza returns null", () => {
    const got = pickSizeForPizza(SIXTEEN_INCH, "Cheese", "small");
    assert.equal(got, null);
  });

  test("fuzzy name match (target substring of menu name)", () => {
    const r: Restaurant = {
      ...SIXTEEN_INCH,
      menu: {
        ...SIXTEEN_INCH.menu,
        pizzas: [
          {
            name: "Classic Pepperoni",
            sizes: [{ name: 'Large 14"', price: 13.99 }],
          },
        ],
      },
    };
    const got = pickSizeForPizza(r, "Pepperoni", "large");
    assert.deepEqual(got, { sizeLabel: 'Large 14"', price: 13.99 });
  });

  test("fuzzy match deterministic on first match", () => {
    const r: Restaurant = {
      ...SIXTEEN_INCH,
      menu: {
        ...SIXTEEN_INCH.menu,
        pizzas: [
          {
            name: "Classic Pepperoni",
            sizes: [{ name: 'Large 14"', price: 13.99 }],
          },
          {
            name: "Spicy Pepperoni",
            sizes: [{ name: 'Large 14"', price: 14.99 }],
          },
        ],
      },
    };
    const got = pickSizeForPizza(r, "Pepperoni", "large");
    assert.deepEqual(got, { sizeLabel: 'Large 14"', price: 13.99 });
  });
});

describe("COLD_PRESETS — restaurant-bound sizes", () => {
  test("quick_pepperoni against Vlad emits 14-inch at $12.99", () => {
    const preset = COLD_PRESETS.find((p) => p.id === "quick_pepperoni")!;
    const items = preset.items(VLAD);
    assert.equal(items.length, 1);
    assert.equal(items[0].name, "Pepperoni");
    assert.equal(items[0].size, 'Large 14"');
    assert.equal(items[0].price, 12.99);
  });

  test("quick_pepperoni against synthetic 16-inch emits 16-inch at synthetic price", () => {
    const preset = COLD_PRESETS.find((p) => p.id === "quick_pepperoni")!;
    const items = preset.items(SIXTEEN_INCH);
    assert.equal(items.length, 1);
    assert.equal(items[0].size, 'Large 16"');
    assert.equal(items[0].price, 18.99);
    // The whole point: must DIFFER from Vlad's
    assert.notEqual(items[0].size, 'Large 14"');
  });

  test("game_day against Vlad uses Vlad's prices", () => {
    const preset = COLD_PRESETS.find((p) => p.id === "game_day")!;
    const items = preset.items(VLAD, 6);
    // Should have meat lovers + pepperoni at Vlad's large prices (15.99 / 12.99)
    const ml = items.find((i) => i.name === "Meat Lovers");
    const pep = items.find((i) => i.name === "Pepperoni");
    assert.ok(ml, "expected Meat Lovers");
    assert.ok(pep, "expected Pepperoni");
    assert.equal(ml.size, 'Large 14"');
    assert.equal(ml.price, 15.99);
    assert.equal(pep.size, 'Large 14"');
    assert.equal(pep.price, 12.99);
  });

  test("kids_party preset emits cheese-heavy mix at restaurant prices", () => {
    const preset = COLD_PRESETS.find((p) => p.id === "kids_party")!;
    const items = preset.items(VLAD, 8);
    const cheese = items.find((i) => i.name === "Cheese");
    const pep = items.find((i) => i.name === "Pepperoni");
    assert.ok(cheese);
    assert.ok(pep);
    assert.equal(cheese.price, 11.99); // Vlad's cheese large
    assert.equal(pep.price, 12.99); // Vlad's pepperoni large
  });

  test("preset returns empty when restaurant lacks needed pizzas (no silent fallback)", () => {
    const preset = COLD_PRESETS.find((p) => p.id === "kids_party")!;
    // PEPPERONI_ONLY has no Cheese — preset should drop the cheese line, keep pepperoni
    const items = preset.items(PEPPERONI_ONLY, 8);
    const cheese = items.find((i) => i.name === "Cheese");
    const pep = items.find((i) => i.name === "Pepperoni");
    assert.equal(cheese, undefined, "no Cheese on this restaurant");
    assert.ok(pep, "Pepperoni should still be present");
  });
});

describe("orderFromIntent — restaurant-bound", () => {
  test('intent veggie large returns Veggie at Vlad\'s "Large 14"" price', () => {
    const items = orderFromIntent(VLAD, { style: "veggie", size: "large" });
    assert.equal(items.length, 1);
    assert.equal(items[0].name, "Veggie");
    assert.equal(items[0].size, 'Large 14"');
    assert.equal(items[0].price, 14.99);
  });

  test("intent meat_lovers returns Meat Lovers", () => {
    const items = orderFromIntent(VLAD, {
      style: "meat lovers",
      size: "large",
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].name, "Meat Lovers");
    assert.equal(items[0].price, 15.99);
  });

  test("unknown style defaults to pepperoni (legacy behavior preserved)", () => {
    const items = orderFromIntent(VLAD, { style: "wat", size: "large" });
    assert.equal(items.length, 1);
    assert.equal(items[0].name, "Pepperoni");
  });

  test("orderFromIntent accepts legacy size labels like 'Large 14\"' as preference token", () => {
    const items = orderFromIntent(VLAD, {
      style: "pepperoni",
      size: 'Large 14"',
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].size, 'Large 14"');
  });

  test("intent with style 'cheese' returns Cheese pizza", () => {
    const items = orderFromIntent(VLAD, { style: "cheese", size: "large" });
    assert.equal(items.length, 1);
    assert.equal(items[0].name, "Cheese");
    assert.equal(items[0].price, 11.99);
  });

  test("missing pizza returns empty array (caller decides)", () => {
    const items = orderFromIntent(PEPPERONI_ONLY, {
      style: "veggie",
      size: "large",
    });
    assert.equal(items.length, 0);
  });
});

describe("buildCallPrompt snapshot — restaurant-bound size in prompt", () => {
  test("Vlad's prompt has 14-inch, synthetic prompt has 16-inch", () => {
    const preset = COLD_PRESETS.find((p) => p.id === "quick_pepperoni")!;

    const vladItems = preset.items(VLAD);
    const sixteenItems = preset.items(SIXTEEN_INCH);

    const baseOrder = (
      restaurant: Restaurant,
      items: typeof vladItems,
    ): PlaceOrderRequest => ({
      restaurantName: restaurant.name,
      restaurantPhone: restaurant.phone,
      items,
      deliveryAddress: "123 Main Road, San Francisco, California 94110",
      customerName: "Test User",
      customerPhone: "+14155550100",
    });

    const vladPrompt = buildCallPrompt(baseOrder(VLAD, vladItems));
    const sixteenPrompt = buildCallPrompt(
      baseOrder(SIXTEEN_INCH, sixteenItems),
    );

    assert.ok(
      vladPrompt.includes('Large 14"'),
      "Vlad's prompt must mention 14 inch",
    );
    assert.ok(
      sixteenPrompt.includes('Large 16"'),
      "Synthetic restaurant prompt must mention 16 inch",
    );
    assert.ok(
      !sixteenPrompt.includes('Large 14"'),
      "Synthetic prompt must NOT contain 14 inch",
    );
  });
});
