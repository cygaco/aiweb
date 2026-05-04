import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildCallPrompt } from "../src/connectors/bland.js";
import {
  buildCustomizationSurface,
  legacyItemsToCart,
} from "../src/lib/cart-flow.js";
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
    const surface = buildCustomizationSurface(restaurant, cart);

    assert.ok(surface.customization_options?.["Meat Lovers"]?.crusts);
    assert.ok(surface.customization_options?.["Meat Lovers"]?.toppings);
    assert.equal(surface.drink_options?.length, 4);
    assert.equal(surface.side_options?.length, 2);
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
