/**
 * Address-speech normalization tests.
 *
 * Run: npm test  OR  npx tsx --test tests/address-speech.test.ts
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { speakableAddress } from "../src/lib/address-speech.js";
import {
  buildCallPrompt,
  type PlaceOrderRequest,
} from "../src/connectors/bland.js";

describe("speakableAddress — table-driven cases", () => {
  const cases: Array<[string, string, string]> = [
    // [input, expected, description]
    ["123 Main Rd", "123 Main Road", "Rd → Road (the user-reported bug)"],
    ["123 Main St", "123 Main Street", "St → Street"],
    ["456 Elm Ave", "456 Elm Avenue", "Ave → Avenue"],
    ["789 Pine Blvd", "789 Pine Boulevard", "Blvd → Boulevard"],
    ["123 N Main St", "123 North Main Street", "Leading directional + suffix"],
    ["123 Main St NW", "123 Main Street Northwest", "Trailing directional"],
    ["123 Main St, Apt 4B", "123 Main Street, Apartment 4B", "Apt expansion"],
    ["123 Main St, Ste 200", "123 Main Street, Suite 200", "Suite expansion"],
    [
      "123 Rd, St. Louis, MO 63101",
      "123 Road, Saint Louis, MO 63101",
      "Saint disambiguation — bare Rd still expands",
    ],
    [
      "100 St. Mary's Hospital Rd",
      "100 Saint Mary's Hospital Road",
      "Saint preserves; trailing Rd expands",
    ],
    ["42 Calle del Sol", "42 Calle del Sol", "No-op when nothing matches"],
    ["123 Main Road", "123 Main Road", "No-op (already spelled out)"],
    [
      "123 Main St, San Francisco, CA 94110",
      "123 Main Street, San Francisco, California 94110",
      "State (CA in top 5)",
    ],
    [
      "123 Main St, Springfield, MA 01103",
      "123 Main Street, Springfield, MA 01103",
      "State (MA NOT in top 5 — left unchanged)",
    ],
    ["", "", "Empty input"],
    ["123 Main", "123 Main", "No suffix → no-op"],
    ["123 Main Rd Apt 2", "123 Main Road Apartment 2", "Compact form"],
    ["#42 Main St", "Number 42 Main Street", "# expansion"],
    ["123 Main Pkwy", "123 Main Parkway", "Pkwy"],
    ["123 Main Hwy", "123 Main Highway", "Hwy"],
    [
      "123 SW Broadway",
      "123 Southwest Broadway",
      "Two-letter directional, leading",
    ],
    ["Main St & 1st Ave", "Main Street & 1st Avenue", "Intersection-style"],
    ["123 Main Cir", "123 Main Circle", "Cir"],
    [
      "123 East Main Street",
      "123 East Main Street",
      "No-op when full forms used",
    ],
    [
      "123 Saint Mark's Pl",
      "123 Saint Mark's Place",
      "Saint as full word + suffix expands",
    ],
  ];

  for (const [input, expected, description] of cases) {
    test(description, () => {
      const actual = speakableAddress(input);
      assert.equal(
        actual,
        expected,
        `\n  input:    "${input}"\n  expected: "${expected}"\n  actual:   "${actual}"`,
      );
    });
  }
});

describe("speakableAddress — invariants", () => {
  test("idempotent: f(f(x)) === f(x)", () => {
    const inputs = [
      "123 Main Rd",
      "123 N Main St NW, Apt 4B, San Francisco, CA 94110",
      "St. Louis, MO 63101",
      "42 Calle del Sol",
      "",
    ];
    for (const x of inputs) {
      const once = speakableAddress(x);
      const twice = speakableAddress(once);
      assert.equal(
        twice,
        once,
        `Not idempotent for "${x}": once="${once}", twice="${twice}"`,
      );
    }
  });

  test("returns input unchanged for null-ish edge cases", () => {
    assert.equal(speakableAddress(""), "");
  });
});

describe("integration: buildCallPrompt applies speakableAddress", () => {
  const baseOrder: PlaceOrderRequest = {
    restaurantName: "Test Pizza",
    restaurantPhone: "+15555550100",
    items: [
      {
        name: "Pepperoni",
        size: 'Large 14"',
        quantity: 1,
        price: 12.99,
      },
    ],
    deliveryAddress: "123 Main Rd, San Francisco, CA 94110",
    customerName: "Jane Doe",
    customerPhone: "+14155550199",
  };

  test('Bland prompt contains "Road" not " Rd"', () => {
    const prompt = buildCallPrompt(baseOrder);
    assert.ok(
      prompt.includes("Road"),
      "expected expanded 'Road' in the prompt",
    );
    // Make sure the bare " Rd" abbreviation is gone (still allowed inside
    // the deliberate "wrapCustomerData" tag value if any other word legit
    // contained it — no such case in this fixture).
    assert.ok(
      !prompt.includes(" Rd,"),
      "expected bare ' Rd,' to be expanded away",
    );
    assert.ok(
      prompt.includes("California"),
      "expected CA → California (top-5 state expansion)",
    );
  });

  test("PlaceOrderRequest.deliveryAddress remains raw after buildCallPrompt", () => {
    const before = baseOrder.deliveryAddress;
    buildCallPrompt(baseOrder);
    assert.equal(
      baseOrder.deliveryAddress,
      before,
      "buildCallPrompt must not mutate stored address",
    );
  });
});
