/**
 * Cart schema fidelity tests.
 *
 * Validates that src/lib/cart.ts can losslessly represent the real chain
 * carts captured in _docs/research/chain-menus/SAMPLES.md.
 *
 * Run: npm test  OR  npx tsx --test tests/cart-schema.test.ts
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  type Cart,
  type CartItem,
  type Deal,
  cartTotal,
  lineTotal,
  canonicalizeCart,
} from "../src/lib/cart.js";

describe("cart schema fidelity — Domino's sample cart from SAMPLES.md", () => {
  const dominosCart: Cart = [
    {
      kind: "pizza",
      itemId: "dominos_pepperoni",
      name: "Hand-Tossed Pizza",
      sizeId: "large_14",
      sizeLabel: 'Large 14"',
      quantity: 1,
      basePrice: 14.99,
      modifiers: [
        {
          groupId: "crust",
          optionId: "hand_tossed",
          name: "Hand Tossed",
          priceDelta: 0,
        },
        {
          groupId: "sauce",
          optionId: "robust_tomato",
          name: "Robust Inspired Tomato",
          priceDelta: 0,
          amount: "normal",
        },
        {
          groupId: "cheese",
          optionId: "mozzarella",
          name: "Mozzarella",
          priceDelta: 0,
          amount: "extra",
        },
        {
          groupId: "toppings",
          optionId: "pepperoni",
          name: "Pepperoni",
          priceDelta: 0,
          placement: "whole",
          amount: "normal",
        },
        {
          groupId: "toppings",
          optionId: "italian_sausage",
          name: "Italian Sausage",
          priceDelta: 0,
          placement: "whole",
          amount: "normal",
        },
        {
          groupId: "toppings",
          optionId: "mushrooms",
          name: "Mushrooms",
          priceDelta: 0,
          placement: "left",
          amount: "normal",
        },
        {
          groupId: "toppings",
          optionId: "banana_peppers",
          name: "Banana Peppers",
          priceDelta: 0,
          placement: "right",
          amount: "normal",
        },
      ],
    },
    {
      kind: "side",
      itemId: "dominos_wings_8pc",
      name: "8pc Wings",
      sizeId: "regular",
      sizeLabel: "8pc",
      quantity: 1,
      basePrice: 11.39,
      modifiers: [
        {
          groupId: "wing_flavor",
          optionId: "hot_buffalo",
          name: "Hot Buffalo",
          priceDelta: 0,
        },
      ],
    },
    {
      kind: "side",
      itemId: "dominos_stuffed_cheesy_bread",
      name: "Stuffed Cheesy Bread",
      sizeId: "regular",
      sizeLabel: "Regular",
      quantity: 1,
      basePrice: 7.99,
      modifiers: [
        {
          groupId: "bread_variant",
          optionId: "bacon_jalapeno",
          name: "Bacon & Jalapeño",
          priceDelta: 0,
        },
      ],
    },
    {
      kind: "side",
      itemId: "dominos_garlic_dip",
      name: "Garlic Dipping Sauce",
      sizeId: "single",
      sizeLabel: "Single",
      quantity: 2,
      basePrice: 0.79,
    },
    {
      kind: "drink",
      itemId: "dominos_coke_2l",
      name: "Coke",
      sizeId: "2l",
      sizeLabel: "2L",
      quantity: 1,
      basePrice: 3.99,
    },
  ];

  test("cart represents all 5 line types from the Domino's sample", () => {
    assert.equal(dominosCart.length, 5);
    assert.equal(dominosCart.filter((i) => i.kind === "pizza").length, 1);
    assert.equal(dominosCart.filter((i) => i.kind === "side").length, 3);
    assert.equal(dominosCart.filter((i) => i.kind === "drink").length, 1);
  });

  test("subtotal matches the sample $39.94", () => {
    // 14.99 + 11.39 + 7.99 + (0.79 × 2) + 3.99 = 39.94
    const subtotal = cartTotal(dominosCart);
    assert.ok(
      Math.abs(subtotal - 39.94) < 0.01,
      `expected ~$39.94, got $${subtotal.toFixed(2)}`,
    );
  });

  test("topping placement (whole/left/right) round-trips through canonicalize", () => {
    const canonical = canonicalizeCart(dominosCart) as Array<{
      modifiers: Array<{ optionId: string; placement?: string }>;
    }>;
    const pizzaMods = canonical[0].modifiers;
    const mushrooms = pizzaMods.find((m) => m.optionId === "mushrooms");
    const bananaPeppers = pizzaMods.find(
      (m) => m.optionId === "banana_peppers",
    );
    assert.equal(mushrooms?.placement, "left");
    assert.equal(bananaPeppers?.placement, "right");
  });

  test("dipping-sauce quantity 2 produces line total $1.58", () => {
    const dipLine = dominosCart.find((i) => i.itemId === "dominos_garlic_dip")!;
    assert.ok(
      Math.abs(lineTotal(dipLine) - 1.58) < 0.01,
      `expected $1.58, got $${lineTotal(dipLine).toFixed(2)}`,
    );
  });
});

describe("cart schema fidelity — Pizza Hut Stuffed Crust upcharge", () => {
  const pizzaHutLine: CartItem = {
    kind: "pizza",
    itemId: "ph_stuffed_crust_large",
    name: "Original Stuffed Crust Pizza",
    sizeId: "large",
    sizeLabel: "Large",
    quantity: 1,
    basePrice: 16.99,
    modifiers: [
      {
        groupId: "crust",
        optionId: "stuffed",
        name: "Original Stuffed Crust",
        priceDelta: 2.5,
      },
      {
        groupId: "sauce",
        optionId: "marinara",
        name: "Classic Marinara",
        priceDelta: 0,
        amount: "normal",
      },
      {
        groupId: "cheese_addons",
        optionId: "three_cheese_blend",
        name: "3-Cheese Blend",
        priceDelta: 0,
      },
      {
        groupId: "toppings",
        optionId: "crispy_pepperoni",
        name: "Crispy Cupped Pepperoni",
        priceDelta: 0,
        placement: "whole",
      },
    ],
  };

  test("crust upcharge applies to lineTotal", () => {
    // base 16.99 + crust 2.50 = 19.49
    assert.ok(
      Math.abs(lineTotal(pizzaHutLine) - 19.49) < 0.01,
      `expected $19.49, got $${lineTotal(pizzaHutLine).toFixed(2)}`,
    );
  });
});

describe("cart schema fidelity — Papa John's per-(crust × size) pricing", () => {
  // Papa John's Epic Stuffed Crust Large = $17.00 flat (already encoded in basePrice
  // when adapter populates from priceMatrix). Crust modifier delta is 0 here
  // because the price was already resolved through the matrix.
  const papaJohnsLine: CartItem = {
    kind: "pizza",
    itemId: "pj_epic_stuffed_large",
    name: "Large Epic Stuffed Crust — Pepperoni",
    sizeId: "large",
    sizeLabel: "Large",
    quantity: 1,
    basePrice: 17.0, // resolved from priceMatrix["epic_stuffed"]["large"]
    modifiers: [
      {
        groupId: "crust",
        optionId: "epic_stuffed",
        name: "Epic Stuffed Crust",
        priceDelta: 0,
      },
      {
        groupId: "toppings",
        optionId: "pepperoni",
        name: "Pepperoni",
        priceDelta: 0,
        placement: "whole",
      },
    ],
  };

  test("priceMatrix-resolved basePrice flows through lineTotal cleanly", () => {
    assert.equal(lineTotal(papaJohnsLine), 17.0);
  });
});

describe("cart schema fidelity — deal types from SAMPLES.md", () => {
  const mixMatch: Deal = {
    id: "dominos_mix_match",
    name: "Mix & Match",
    description:
      "Pick any 2+ items from medium 2-topping pizza, wings, sandwich, pasta, salad, bread, dessert, 2L drink",
    type: "mix_match",
    components: [
      { kind: "pizza", constraints: { size: "medium", maxToppings: 2 } },
    ],
    priceRule: { kind: "per_item_fixed", perItemPrice: 6.99, minItems: 2 },
  };

  const bundle: Deal = {
    id: "dominos_perfect_combo",
    name: "Perfect Combo",
    description:
      "2 medium 1-topping pizzas + 16pc Parmesan bread bites + 8pc cinnamon twists + 2L soda",
    type: "bundle",
    components: [
      {
        kind: "pizza",
        constraints: { size: "medium", maxToppings: 1, count: 2 },
      },
      { kind: "side", constraints: { item: "parmesan_bread_bites_16pc" } },
      { kind: "side", constraints: { item: "cinnamon_twists_8pc" } },
      { kind: "drink", constraints: { size: "2L" } },
    ],
    priceRule: { kind: "total_fixed", totalPrice: 19.99 },
  };

  const discount: Deal = {
    id: "ph_wings_wednesday",
    name: "Wings Wednesday",
    description: "All wings 50% off on Wednesdays",
    type: "discount",
    components: [{ kind: "side", constraints: { category: "wings" } }],
    priceRule: { kind: "percent_off", percent: 50, appliesTo: "item" },
  };

  test("mix_match deal type round-trips", () => {
    assert.equal(mixMatch.type, "mix_match");
    assert.equal(mixMatch.priceRule.kind, "per_item_fixed");
    if (mixMatch.priceRule.kind === "per_item_fixed") {
      assert.equal(mixMatch.priceRule.perItemPrice, 6.99);
      assert.equal(mixMatch.priceRule.minItems, 2);
    }
  });

  test("bundle deal type round-trips", () => {
    assert.equal(bundle.type, "bundle");
    assert.equal(bundle.priceRule.kind, "total_fixed");
    assert.equal(bundle.components.length, 4);
  });

  test("discount deal type with per-item percent_off", () => {
    assert.equal(discount.type, "discount");
    if (discount.priceRule.kind === "percent_off") {
      assert.equal(discount.priceRule.percent, 50);
      assert.equal(discount.priceRule.appliesTo, "item");
    }
  });
});

describe("cart schema fidelity — deal-as-cart-line", () => {
  // Per the schema: a deal applied to the cart appears as a CartItem of
  // kind "deal" whose basePrice is the deal's total and whose components
  // enumerate what's actually being ordered.
  const cartWithDeal: Cart = [
    {
      kind: "deal",
      itemId: "dominos_perfect_combo",
      name: "Perfect Combo",
      quantity: 1,
      basePrice: 19.99,
      components: [
        {
          kind: "pizza",
          itemId: "dominos_pepperoni",
          name: "Pepperoni Pizza",
          sizeId: "medium",
          sizeLabel: 'Medium 12"',
          modifiers: [
            {
              groupId: "toppings",
              optionId: "pepperoni",
              name: "Pepperoni",
              priceDelta: 0,
              placement: "whole",
            },
          ],
        },
        {
          kind: "pizza",
          itemId: "dominos_cheese",
          name: "Cheese Pizza",
          sizeId: "medium",
          sizeLabel: 'Medium 12"',
        },
        {
          kind: "side",
          itemId: "parmesan_bread_bites_16pc",
          name: "Parmesan Bread Bites",
          sizeId: "16pc",
          sizeLabel: "16pc",
        },
        {
          kind: "drink",
          itemId: "coke_2l",
          name: "Coke",
          sizeId: "2l",
          sizeLabel: "2L",
        },
      ],
    },
  ];

  test("deal cart-line totals at fixed price", () => {
    assert.equal(lineTotal(cartWithDeal[0]), 19.99);
    assert.equal(cartTotal(cartWithDeal), 19.99);
  });

  test("deal components enumerate what's in the bundle", () => {
    const components = cartWithDeal[0].components!;
    assert.equal(components.length, 4);
    assert.equal(components.filter((c) => c.kind === "pizza").length, 2);
  });
});

describe("canonicalizeCart determinism", () => {
  test("modifier order is stable regardless of input order", () => {
    const a: Cart = [
      {
        kind: "pizza",
        itemId: "p1",
        name: "Pizza",
        sizeId: "lg",
        sizeLabel: "Large",
        quantity: 1,
        basePrice: 10,
        modifiers: [
          {
            groupId: "toppings",
            optionId: "z_pepperoni",
            name: "Pepperoni",
            priceDelta: 0,
          },
          {
            groupId: "toppings",
            optionId: "a_anchovies",
            name: "Anchovies",
            priceDelta: 0,
          },
        ],
      },
    ];
    const b: Cart = [
      {
        kind: "pizza",
        itemId: "p1",
        name: "Pizza",
        sizeId: "lg",
        sizeLabel: "Large",
        quantity: 1,
        basePrice: 10,
        modifiers: [
          {
            groupId: "toppings",
            optionId: "a_anchovies",
            name: "Anchovies",
            priceDelta: 0,
          },
          {
            groupId: "toppings",
            optionId: "z_pepperoni",
            name: "Pepperoni",
            priceDelta: 0,
          },
        ],
      },
    ];
    assert.deepEqual(canonicalizeCart(a), canonicalizeCart(b));
  });
});
