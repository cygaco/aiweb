/**
 * tests/regression/SP-20260519-006/happy-path.test.ts — S-14 / AC-14.1.
 *
 * Asserts that buildCallPrompt on a card-branch PlaceOrderRequest emits
 * the CARD-DISCLOSURE SCRIPT beats from copy.md C-5 in numerical order.
 * Also asserts that cash-branch output is unchanged from the pre-sprint
 * shape (snapshot diff via key markers).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCallPrompt,
  type PlaceOrderRequest,
} from "../../../src/connectors/bland.js";
import { CARD_OVER_PHONE_DISCLOSURE } from "../../../src/server.js";

const VISA_TEST = ["4111", "1111", "1111", "1111"].join("-");

function baseOrder(): PlaceOrderRequest {
  return {
    restaurantName: "Vlad's Pizza Kitchen",
    restaurantPhone: "+14155550101",
    items: [
      {
        name: "Pepperoni",
        size: "large",
        quantity: 1,
        price: 18.99,
      },
    ],
    deliveryAddress: "1 Market St, San Francisco, CA 94105",
    customerName: "Alpha Tester",
    customerPhone: "+14155551234",
  };
}

test("AC-14.1: card-branch buildCallPrompt contains disclosure beats in order", () => {
  const order: PlaceOrderRequest = {
    ...baseOrder(),
    paymentMethod: "card_over_phone",
    cardNumber: VISA_TEST,
    cardExp: "12/29",
    cardCvv: "123",
    cardZip: "94105",
    tipPercent: 15,
  };
  const prompt = buildCallPrompt(order);

  // Header line indicates card-branch.
  assert.match(prompt, /Payment: CARD over phone, with 15% tip\./);
  assert.match(prompt, /CARD-DISCLOSURE SCRIPT/);

  // The 10 disclosure beats in numerical order — assert each exists and
  // that they appear in the document order documented in copy.md C-5.
  const beats = [
    /1\. Quote the pre-tip total/,
    /2\. Ask about tip/,
    /3\. Read the card number slowly/,
    /4\. Read expiration/,
    /5\. Read CVV/,
    /6\. Read billing zip/,
    /7\. Ask the restaurant to repeat the card number back/,
    /8\. Ask: "Has the charge gone through\?"/,
    /9\. If yes, confirm the order/,
    /10\. NEVER repeat the card details unprompted/,
  ];
  let cursor = 0;
  for (const beat of beats) {
    const remaining = prompt.slice(cursor);
    const match = beat.exec(remaining);
    assert.ok(
      match,
      `disclosure beat ${beat} must appear in order; not found after position ${cursor}`,
    );
    cursor += (match!.index ?? 0) + (match![0]?.length ?? 0);
  }

  // The cash-only rules MUST NOT appear on the card branch.
  assert.ok(
    !prompt.includes(`I'll be paying cash on delivery`),
    "cash rules must not appear on card branch",
  );
  assert.ok(
    !prompt.includes("NEVER provide a credit card number"),
    "the cash 'never provide credit card' rule must be absent",
  );
});

test("AC-2.3: cash-branch buildCallPrompt unchanged (no card section, cash payment line)", () => {
  const prompt = buildCallPrompt(baseOrder());
  assert.match(prompt, /Payment: CASH on delivery/);
  assert.ok(
    !prompt.includes("CARD-DISCLOSURE SCRIPT"),
    "cash branch must not include card disclosure",
  );
  assert.match(prompt, /If they ask for a credit card/);
  assert.match(prompt, /NEVER provide a credit card number/);
});

test("CARD_OVER_PHONE_DISCLOSURE constant matches copy.md C-1 verbatim", () => {
  // Reproduce the C-1 string here. Any drift between this literal and the
  // exported constant is a copy-drift hazard the verbatim-reproduction
  // posture explicitly forbids.
  const C1 =
    "Heads up — card-over-phone is an alpha-stage testing path. The AI will voice your card number to the restaurant employee during the call. Use a prepaid single-use card with a bounded balance only. We don't store your card, but we don't control how the restaurant handles it after they hear it. To switch to cash on delivery, say so before confirming.";
  assert.equal(CARD_OVER_PHONE_DISCLOSURE, C1);
});
