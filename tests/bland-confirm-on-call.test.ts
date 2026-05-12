import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildCallPrompt } from "../src/connectors/bland.js";

describe("Bland prompt — confirm_on_call_items appendage", () => {
  test("renders the appendage when confirmOnCallItems is non-empty", () => {
    const prompt = buildCallPrompt({
      restaurantName: "Test Pizza",
      restaurantPhone: "+14155551111",
      deliveryAddress: "123 Main St, San Francisco, CA",
      customerName: "Test User",
      customerPhone: "+14155552222",
      items: [{ name: "Pepperoni", size: "Large", quantity: 1, price: 15.99 }],
      confirmOnCallItems: [{ name: "Coke", size: "20oz" }, { name: "Wings" }],
    });
    assert.match(prompt, /Also ask the restaurant about:/);
    assert.match(prompt, /Coke/);
    assert.match(prompt, /20oz/);
    assert.match(prompt, /Wings/);
  });

  test("omits the appendage when confirmOnCallItems is absent or empty", () => {
    const prompt = buildCallPrompt({
      restaurantName: "Test Pizza",
      restaurantPhone: "+14155551111",
      deliveryAddress: "123 Main St, San Francisco, CA",
      customerName: "Test User",
      customerPhone: "+14155552222",
      items: [{ name: "Pepperoni", size: "Large", quantity: 1, price: 15.99 }],
    });
    assert.doesNotMatch(prompt, /Also ask the restaurant about/);
  });
});
