import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  issueToken,
  verifyToken,
  type TokenArgs,
} from "../src/lib/confirmation-token.js";

const secret = "a".repeat(64);
let previousSecret: string | undefined;

const legacyItems = [
  { name: "Pepperoni", size: 'Large 14"', quantity: 1, price: 12.99 },
];

const baseArgs: TokenArgs = {
  restaurant_id: "test_vlad",
  customer_name: "Vlad",
  customer_phone: "+14152335033",
  delivery_address: "5208 Riddle By Pass Rd, Riddle, OR 97469",
  items: legacyItems,
};

describe("confirmation-token delivery_instructions binding", () => {
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

  // Case 1: no instructions on either side — still verifies
  test("no instructions on issue or verify → ok", () => {
    const token = issueToken(baseArgs);
    assert.deepEqual(verifyToken(token, baseArgs), { ok: true });
  });

  // Case 2: issue with instructions, verify with same → ok
  test("same instructions on issue and verify → ok", () => {
    const args: TokenArgs = {
      ...baseArgs,
      delivery_instructions: "leave at side door",
    };
    const token = issueToken(args);
    assert.deepEqual(verifyToken(token, args), { ok: true });
  });

  // Case 3: issue with instructions, verify with different → mismatch
  test("different instructions on verify → mismatch", () => {
    const token = issueToken({
      ...baseArgs,
      delivery_instructions: "leave at side door",
    });
    const result = verifyToken(token, {
      ...baseArgs,
      delivery_instructions: "ring bell",
    });
    assert.deepEqual(result, {
      ok: false,
      reason: "delivery_instructions mismatch",
    });
  });

  // Case 4: issued with instructions, verify without → mismatch
  test("instructions on issue but not verify → mismatch", () => {
    const token = issueToken({
      ...baseArgs,
      delivery_instructions: "gate code 1234",
    });
    const result = verifyToken(token, baseArgs);
    assert.deepEqual(result, {
      ok: false,
      reason: "delivery_instructions mismatch",
    });
  });

  // Case 5: issued without instructions, verify with instructions → mismatch
  test("no instructions on issue but instructions on verify → mismatch", () => {
    const token = issueToken(baseArgs);
    const result = verifyToken(token, {
      ...baseArgs,
      delivery_instructions: "leave at door",
    });
    assert.deepEqual(result, {
      ok: false,
      reason: "delivery_instructions mismatch",
    });
  });

  // Case 6: token expiry still triggers even when instructions match
  test("expired token with matching instructions → expired", () => {
    const args: TokenArgs = {
      ...baseArgs,
      delivery_instructions: "leave at door",
    };
    const token = issueToken(args);
    const origNow = Date.now;
    try {
      Date.now = () => origNow() + 11 * 60 * 1000;
      const result = verifyToken(token, args);
      assert.deepEqual(result, { ok: false, reason: "token expired" });
    } finally {
      Date.now = origNow;
    }
  });

  // Case 7: backward compat — token issued without delivery_instructions
  //         (no delivery_instructions_hash in payload) verifies when
  //         args.delivery_instructions is also absent
  test("legacy token (no instructions hash) verifies with no instructions on verify", () => {
    // baseArgs has no delivery_instructions — payload will have no hash field
    const token = issueToken(baseArgs);
    assert.deepEqual(verifyToken(token, baseArgs), { ok: true });
  });
});
