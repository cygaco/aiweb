// SP-20260517-005 / S-8 / AC-8.* — multi-pizza intent (zod union).

import { test } from "node:test";
import assert from "node:assert/strict";
import { assessCompatibility } from "../src/lib/compatibility.js";
import type { Restaurant } from "../src/data/restaurants.js";

const VLAD: Restaurant = {
  id: "test_vlad_m",
  name: "Vlad's Pizza Test",
  phone: "+14155550111",
  address: "1 Test St, SF",
  lat: 37.7749,
  lng: -122.4194,
  deliveryRadius: 10,
  estimatedDeliveryMinutes: 25,
  acceptsCash: true,
  serviceType: "delivery",
  menu: {
    pizzas: [
      { name: "Pepperoni", sizes: [{ name: "Large", price: 14.99 }] },
      { name: "Meat Lovers", sizes: [{ name: "Large", price: 16.99 }] },
      { name: "Veggie", sizes: [{ name: "Large", price: 15.99 }] },
    ],
    sides: [],
  },
  hours: "11-21",
};

test("AC-8.1: singular pizza form produces pizza:<style> slot", () => {
  const a = assessCompatibility(VLAD, 37.7945, -122.3959, {
    pizza: { style: "veggie" },
  });
  assert.ok(Object.keys(a.item_map).includes("pizza:veggie"));
});

test("AC-8.2: array form with 2 distinct pizzas populates both slots", () => {
  const a = assessCompatibility(VLAD, 37.7945, -122.3959, {
    pizza: [
      { style: "veggie", size: "XL" },
      { style: "meat_lovers", size: "medium" },
    ],
  });
  const keys = Object.keys(a.item_map);
  assert.ok(keys.includes("pizza:veggie"));
  assert.ok(keys.includes("pizza:meat lovers"));
  assert.equal(a.item.state, "available");
});

test("AC-8.2: 1 known + 1 unknown pizza in array → worst-evidence rollup", () => {
  const a = assessCompatibility(VLAD, 37.7945, -122.3959, {
    pizza: [{ style: "veggie" }, { style: "Hawaiian-Spam-Surprise" }],
  });
  const keys = Object.keys(a.item_map);
  assert.ok(keys.includes("pizza:veggie"));
  assert.ok(keys.includes("pizza:hawaiian-spam-surprise"));
  assert.equal(a.item.state, "not_available");
});

test("dedupe: singular and array-of-1 produce equivalent state", () => {
  const single = assessCompatibility(VLAD, 37.7945, -122.3959, {
    pizza: { style: "veggie" },
  });
  const array1 = assessCompatibility(VLAD, 37.7945, -122.3959, {
    pizza: [{ style: "veggie" }],
  });
  assert.equal(single.item.state, array1.item.state);
  assert.equal(single.overall, array1.overall);
});

test("legacy 'pizza' alias key preserved for back-compat (S22-5/S22-14)", () => {
  const a = assessCompatibility(VLAD, 37.7945, -122.3959, {
    pizza: { style: "veggie" },
  });
  assert.ok("pizza" in a.item_map);
  assert.equal(a.item_map.pizza.state, "available");
});
