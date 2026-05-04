import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Cart, CartItem, SelectedModifier } from "../src/lib/cart.js";
import { applyCartDiff } from "../src/lib/cart-flow.js";
import { TEST_RESTAURANTS } from "../src/data/restaurants.js";

const baseCart: Cart = [
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

const drink: CartItem = {
  kind: "drink",
  itemId: "coke_2l",
  name: "Coca-Cola",
  sizeId: "2l",
  sizeLabel: "2L Bottle",
  quantity: 1,
  basePrice: 3.99,
};

const extraCheese: SelectedModifier = {
  groupId: "toppings",
  optionId: "extra_cheese",
  name: "Extra Cheese",
  priceDelta: 1.5,
  placement: "whole",
  amount: "extra",
};

describe("update_order cart diff semantics", () => {
  test("add appends a fresh cart line", () => {
    const updated = applyCartDiff({
      op: "add",
      cart: baseCart,
      item: drink,
    });

    assert.equal(updated.length, 2);
    assert.deepEqual(updated[1], drink);
    assert.notEqual(updated, baseCart);
    assert.notEqual(updated[0], baseCart[0]);
  });

  test("remove deletes the selected line", () => {
    const updated = applyCartDiff({
      op: "remove",
      cart: [...baseCart, drink],
      line_index: 0,
    });

    assert.equal(updated.length, 1);
    assert.equal(updated[0].itemId, "coke_2l");
  });

  test("add_modifier appends to the target line only", () => {
    const updated = applyCartDiff({
      op: "add_modifier",
      cart: [...baseCart, drink],
      line_index: 0,
      modifier: extraCheese,
    });

    assert.equal(updated[0].modifiers?.length, 1);
    assert.equal(updated[0].modifiers?.[0].name, "Extra Cheese");
    assert.equal(updated[1].modifiers, undefined);
  });

  test("swap_to_deal replaces the cart with a matching deal line", () => {
    const restaurant = TEST_RESTAURANTS.find((r) => r.id === "test_vlad")!;
    const updated = applyCartDiff(
      {
        op: "swap_to_deal",
        cart: baseCart,
        deal_id: "vlad_family_combo",
      },
      (dealId) => restaurant.menu.deals?.find((d) => d.id === dealId),
    );

    assert.equal(updated.length, 1);
    assert.equal(updated[0].kind, "deal");
    assert.equal(updated[0].itemId, "vlad_family_combo");
    assert.equal(updated[0].basePrice, 32.99);
    assert.equal(updated[0].components?.length, 3);
  });
});
