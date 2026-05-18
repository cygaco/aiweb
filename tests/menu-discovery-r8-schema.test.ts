/**
 * tests/menu-discovery-r8-schema.test.ts — SP-20260517-005 / S-13 / AC-13.*.
 *
 * Verifies the R-8 schema adoption:
 *   AC-13.1: Existing cache entries (no R-8 fields) still validate (back-compat).
 *   AC-13.2: Entry with `cuisines: ["PIZZA","VEGAN"]` validates.
 *   AC-13.3: Entry with an unknown enum value rejects.
 *   AC-13.4: Per-item allergen + dietaryRestriction validates.
 *   AC-13.5: Type-level — tested via `npx tsc --noEmit` separately.
 *
 * Also covers the redteam-plan threat (cuisines outside enum drop the entry).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidCachedMenuResult } from "../src/lib/menu-discovery.js";
import {
  isCuisine,
  isAllergen,
  isDietaryRestriction,
  isSpiciness,
  isPreparationMethod,
  isValidFoodMenuAttributes,
  isValidCuisines,
} from "../src/lib/menu-taxonomy.js";

const BASE = {
  discoveredAt: "2026-05-18T00:00:00.000Z",
  source: "restaurant_website",
  pizzas: [{ name: "Pepperoni", sizes: [{ name: "Large", price: 14.99 }] }],
  sides: [{ name: "Wings", sizes: [{ name: "8pc", price: 9.99 }] }],
  drinks: [
    {
      id: "coke-2l",
      name: "Coke",
      brand: "Coca-Cola",
      sizes: [{ id: "2l", name: "2L", price: 4.0 }],
    },
  ],
  deliveryCues: {
    offersDelivery: true,
    deliveryRadiusMiles: 5,
    rawSignal: null,
  },
};

test("AC-13.1: existing cache entry without R-8 fields validates (back-compat)", () => {
  assert.equal(isValidCachedMenuResult(BASE), true);
});

test("AC-13.2: cache entry with cuisines:[PIZZA,VEGAN] validates", () => {
  const r = { ...BASE, cuisines: ["PIZZA", "VEGAN"] };
  assert.equal(isValidCachedMenuResult(r), true);
});

test("AC-13.3: cache entry with cuisines:[NONEXISTENT] rejects", () => {
  const r = { ...BASE, cuisines: ["NONEXISTENT"] };
  assert.equal(isValidCachedMenuResult(r), false);
});

test("AC-13.3 variant: cuisines exceeding max (6 entries) rejects", () => {
  const r = {
    ...BASE,
    cuisines: ["PIZZA", "VEGAN", "ITALIAN", "AMERICAN", "MEXICAN", "THAI"],
  };
  assert.equal(isValidCachedMenuResult(r), false);
});

test("AC-13.4: per-item allergen + dietaryRestriction on a pizza validates", () => {
  const r = {
    ...BASE,
    pizzas: [
      {
        name: "Margherita",
        sizes: [{ name: "Large", price: 14.99 }],
        allergen: ["DAIRY", "WHEAT"],
        dietaryRestriction: ["VEGETARIAN"],
      },
    ],
  };
  assert.equal(isValidCachedMenuResult(r), true);
});

test("AC-13.4 variant: invalid allergen on a side rejects", () => {
  const r = {
    ...BASE,
    sides: [
      {
        name: "Wings",
        sizes: [{ name: "8pc", price: 9.99 }],
        allergen: ["GLUTEN_FREE"],
      },
    ],
  };
  assert.equal(isValidCachedMenuResult(r), false);
});

test("AC-13.4 variant: drink with valid R-8 attrs validates", () => {
  const r = {
    ...BASE,
    drinks: [
      {
        id: "lacroix",
        name: "LaCroix",
        sizes: [{ id: "12oz", name: "12oz", price: 2.5 }],
        dietaryRestriction: ["VEGAN", "VEGETARIAN"],
        ingredients: [{ name: "Water" }, { name: "Natural Lime Flavor" }],
      },
    ],
  };
  assert.equal(isValidCachedMenuResult(r), true);
});

test("AC-13.4 variant: drink with malformed ingredients (missing name) rejects", () => {
  const r = {
    ...BASE,
    drinks: [
      {
        id: "lacroix",
        name: "LaCroix",
        sizes: [{ id: "12oz", name: "12oz", price: 2.5 }],
        ingredients: [{ name: "Water" }, {}],
      },
    ],
  };
  assert.equal(isValidCachedMenuResult(r), false);
});

test("redteam-plan threat 5: spiciness with invalid value rejects (no silent coercion)", () => {
  const r = {
    ...BASE,
    pizzas: [
      {
        name: "Diavola",
        sizes: [{ name: "Large", price: 16.99 }],
        spiciness: "VOLCANIC",
      },
    ],
  };
  assert.equal(isValidCachedMenuResult(r), false);
});

// ──────────────────────────────────────────────────────────────────────────
// Direct unit tests on the taxonomy guards (cheap, comprehensive).
// ──────────────────────────────────────────────────────────────────────────

test("taxonomy: isCuisine accepts known values, rejects unknowns + non-strings", () => {
  assert.equal(isCuisine("PIZZA"), true);
  assert.equal(isCuisine("VEGAN"), true);
  assert.equal(isCuisine("OTHER"), true);
  assert.equal(isCuisine("PIZZAS"), false);
  assert.equal(isCuisine("pizza"), false);
  assert.equal(isCuisine(42), false);
  assert.equal(isCuisine(null), false);
});

test("taxonomy: isAllergen covers FDA top-8 + rejects drift", () => {
  for (const v of [
    "DAIRY",
    "EGG",
    "FISH",
    "PEANUT",
    "SHELLFISH",
    "SOY",
    "TREE_NUT",
    "WHEAT",
  ]) {
    assert.equal(isAllergen(v), true, `${v} should pass`);
  }
  assert.equal(isAllergen("GLUTEN"), false);
  assert.equal(isAllergen("dairy"), false);
});

test("taxonomy: isDietaryRestriction", () => {
  assert.equal(isDietaryRestriction("VEGAN"), true);
  assert.equal(isDietaryRestriction("HALAL"), true);
  assert.equal(isDietaryRestriction("PALEO"), false);
});

test("taxonomy: isSpiciness", () => {
  assert.equal(isSpiciness("MILD"), true);
  assert.equal(isSpiciness("MEDIUM"), true);
  assert.equal(isSpiciness("HOT"), true);
  assert.equal(isSpiciness("EXTRA_HOT"), false);
});

test("taxonomy: isPreparationMethod", () => {
  assert.equal(isPreparationMethod("BAKED"), true);
  assert.equal(isPreparationMethod("SOUS_VIDE"), false);
});

test("taxonomy: isValidFoodMenuAttributes accepts undefined (back-compat)", () => {
  assert.equal(isValidFoodMenuAttributes(undefined), true);
  assert.equal(isValidFoodMenuAttributes({}), true);
  assert.equal(isValidFoodMenuAttributes({ allergen: [] }), true);
});

test("taxonomy: isValidFoodMenuAttributes rejects oversized arrays", () => {
  // allergen cap = 8
  assert.equal(
    isValidFoodMenuAttributes({
      allergen: [
        "DAIRY",
        "EGG",
        "FISH",
        "PEANUT",
        "SHELLFISH",
        "SOY",
        "TREE_NUT",
        "WHEAT",
        "DAIRY",
      ],
    }),
    false,
  );
});

test("taxonomy: isValidCuisines accepts undefined + valid arrays", () => {
  assert.equal(isValidCuisines(undefined), true);
  assert.equal(isValidCuisines([]), true);
  assert.equal(isValidCuisines(["PIZZA"]), true);
  assert.equal(isValidCuisines(["INVALID"]), false);
  assert.equal(isValidCuisines("PIZZA"), false); // not an array
});
