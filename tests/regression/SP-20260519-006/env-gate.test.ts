/**
 * tests/regression/SP-20260519-006/env-gate.test.ts — S-15 / AC-15.*.
 *
 * Tests the ENABLE_CARD_OVER_PHONE env-gate at the lib level. The
 * place_order MCP handler and the A2A executor both call
 * isCardOverPhoneEnabled() to decide; testing the helper covers both
 * surfaces. AC-15.1 + AC-15.2 are derived behavior: when the helper
 * returns false, neither handler dispatches to Bland.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isCardOverPhoneEnabled,
  cardOverPhoneFieldsSchema,
} from "../../../src/lib/payment-method.js";

test("AC-15.1: isCardOverPhoneEnabled returns false when env is unset", () => {
  assert.equal(isCardOverPhoneEnabled({}), false);
});

test("AC-15.1: isCardOverPhoneEnabled returns false on every truthy-looking-but-not-'true' value", () => {
  for (const v of ["1", "yes", "TRUE", "True", "on", "enable", ""]) {
    assert.equal(
      isCardOverPhoneEnabled({ ENABLE_CARD_OVER_PHONE: v }),
      false,
      `must reject '${v}' — only exact 'true' enables`,
    );
  }
});

test("AC-15.1: isCardOverPhoneEnabled returns true only on exact 'true'", () => {
  assert.equal(
    isCardOverPhoneEnabled({ ENABLE_CARD_OVER_PHONE: "true" }),
    true,
  );
});

test("AC-15.2: cardOverPhoneFieldsSchema rejects missing card_number", () => {
  const parse = cardOverPhoneFieldsSchema.safeParse({
    card_exp: "12/29",
    card_cvv: "123",
    card_zip: "94105",
  });
  assert.equal(parse.success, false);
});

test("AC-15.2: cardOverPhoneFieldsSchema rejects invalid card_exp shape", () => {
  const parse = cardOverPhoneFieldsSchema.safeParse({
    card_number: ["4111", "1111", "1111", "1111"].join("-"),
    card_exp: "2029-12",
    card_cvv: "123",
    card_zip: "94105",
  });
  assert.equal(parse.success, false);
  if (!parse.success) {
    const messages = parse.error.issues.map((i) => i.message);
    assert.ok(
      messages.includes("invalid_card_exp"),
      `expected invalid_card_exp in ${messages.join(",")}`,
    );
  }
});

test("AC-15.2: cardOverPhoneFieldsSchema rejects invalid card_cvv shape", () => {
  const parse = cardOverPhoneFieldsSchema.safeParse({
    card_number: ["4111", "1111", "1111", "1111"].join("-"),
    card_exp: "12/29",
    card_cvv: "12",
    card_zip: "94105",
  });
  assert.equal(parse.success, false);
});

test("AC-15.2: cardOverPhoneFieldsSchema rejects out-of-range tip_percent", () => {
  const parse = cardOverPhoneFieldsSchema.safeParse({
    card_number: ["4111", "1111", "1111", "1111"].join("-"),
    card_exp: "12/29",
    card_cvv: "123",
    card_zip: "94105",
    tip_percent: 50,
  });
  assert.equal(parse.success, false);
});

test("AC-15.2: cardOverPhoneFieldsSchema accepts a valid card payload", () => {
  const parse = cardOverPhoneFieldsSchema.safeParse({
    card_number: ["4111", "1111", "1111", "1111"].join("-"),
    card_exp: "12/29",
    card_cvv: "123",
    card_zip: "94105",
    tip_percent: 15,
  });
  assert.equal(parse.success, true);
});
