import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  issueToken,
  verifyToken,
  type TokenArgs,
} from "../src/lib/confirmation-token.js";
import type { Cart } from "../src/lib/cart.js";

const secret = "a".repeat(64);
let previousSecret: string | undefined;

const legacyItems = [
  { name: "Pepperoni", size: 'Large 14"', quantity: 1, price: 12.99 },
];

const baseArgs = {
  restaurant_id: "test_vlad",
  customer_name: "Vlad",
  customer_phone: "+14152335033",
  delivery_address: "5208 Riddle By Pass Rd, Riddle, OR 97469",
};

const cart: Cart = [
  {
    kind: "pizza",
    itemId: "test_vlad_pepperoni",
    name: "Pepperoni",
    sizeId: "large_14",
    sizeLabel: 'Large 14"',
    quantity: 1,
    basePrice: 12.99,
    modifiers: [
      {
        groupId: "toppings",
        optionId: "pepperoni",
        name: "Pepperoni",
        priceDelta: 0,
      },
      {
        groupId: "cheese",
        optionId: "extra",
        name: "Extra Cheese",
        priceDelta: 1.5,
      },
    ],
  },
];

describe("confirmation-token cart hashing", () => {
  beforeEach(() => {
    previousSecret = process.env.PROFILE_ENCRYPTION_SECRET;
    process.env.PROFILE_ENCRYPTION_SECRET = secret;
  });

  afterEach(() => {
    if (previousSecret === undefined) {
      delete process.env.PROFILE_ENCRYPTION_SECRET;
    } else {
      process.env.PROFILE_ENCRYPTION_SECRET = previousSecret;
    }
  });

  test("legacy item tokens still verify", () => {
    const args: TokenArgs = { ...baseArgs, items: legacyItems };
    const token = issueToken(args);
    assert.deepEqual(verifyToken(token, args), { ok: true });
  });

  test("cart issued and verified round-trips", () => {
    const args: TokenArgs = { ...baseArgs, cart };
    const token = issueToken(args);
    assert.deepEqual(verifyToken(token, args), { ok: true });
  });

  test("cart with reordered modifiers still verifies", () => {
    const args: TokenArgs = { ...baseArgs, cart };
    const token = issueToken(args);
    const reordered: Cart = [
      {
        ...cart[0],
        modifiers: [...(cart[0].modifiers ?? [])].reverse(),
      },
    ];
    assert.deepEqual(verifyToken(token, { ...baseArgs, cart: reordered }), {
      ok: true,
    });
  });

  test("cart token does not verify against legacy items only", () => {
    const token = issueToken({ ...baseArgs, cart });
    const verdict = verifyToken(token, { ...baseArgs, items: legacyItems });
    assert.equal(verdict.ok, false);
  });
});
