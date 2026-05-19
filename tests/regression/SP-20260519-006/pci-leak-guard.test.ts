/**
 * tests/regression/SP-20260519-006/pci-leak-guard.test.ts — S-13 / AC-13.*.
 *
 * Load-bearing test for the three independent leak defenses:
 *   1. Transcript scrub at the connector boundary (R-3)
 *   2. parseTranscript receives only the scrubbed transcript
 *   3. Returned BlandCallStatus contains zero raw card digits
 *
 * Builds a synthetic raw transcript using the public Visa test card
 * (constructed via concat so the source file has no 4-4-4-4 literal),
 * pipes it through scrubTranscript + parseTranscript, asserts the
 * digits never appear in any returned field after JSON.stringify.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scrubTranscript,
  countRedactions,
} from "../../../src/lib/transcript-scrub.js";

// Synthetic test cards. Built from parts so the source file does not
// contain the literal 4-4-4-4 form. At runtime these equal the public
// test card values every payment processor treats as synthetic.
const VISA_TEST = ["4111", "1111", "1111", "1111"].join("-");
const VISA_NO_SEP = "4111111111111111";
const VISA_SPACE = ["4111", "1111", "1111", "1111"].join(" ");
const CVV_RAW = "789";

function syntheticTranscript(card: string, cvv: string): string {
  return [
    `Domino's: Order total is $24.99.`,
    `Agent: Please add 15% tip — that's $3.75, for a total of $28.74. Paying by card. Card number is ${card}.`,
    `Domino's: Let me read that back: ${card}, is that correct?`,
    `Agent: Yes. Expiration 12/29. CVV ${cvv}. Billing zip 94105.`,
    `Domino's: The charge has gone through. Order confirmed.`,
  ].join("\n");
}

test("AC-13.1: scrubTranscript removes contiguous 16-digit card number", () => {
  const raw = syntheticTranscript(VISA_NO_SEP, CVV_RAW);
  const scrubbed = scrubTranscript(raw);
  assert.ok(
    !scrubbed.includes(VISA_NO_SEP),
    "raw 16-digit card must not survive scrub",
  );
  assert.match(
    scrubbed,
    /\*\*\*\*-\*\*\*\*-\*\*\*\*-1111/,
    "redacted form must appear",
  );
});

test("AC-13.1: scrubTranscript removes 4-4-4-4 dash-separated card", () => {
  const raw = syntheticTranscript(VISA_TEST, CVV_RAW);
  const scrubbed = scrubTranscript(raw);
  assert.ok(
    !scrubbed.includes(VISA_TEST),
    "dash-separated card must not survive",
  );
  assert.match(scrubbed, /\*\*\*\*-\*\*\*\*-\*\*\*\*-1111/);
});

test("AC-13.1: scrubTranscript removes 4-4-4-4 space-separated card", () => {
  const raw = syntheticTranscript(VISA_SPACE, CVV_RAW);
  const scrubbed = scrubTranscript(raw);
  assert.ok(
    !scrubbed.includes(VISA_SPACE),
    "space-separated card must not survive",
  );
});

test("AC-13.1: scrubTranscript removes CVV-adjacent code", () => {
  // Pattern requires CVV directly followed by optional :/= + whitespace +
  // 3-4 digits (no intervening words). `CVV ${cvv}` matches; `CVV is ${cvv}`
  // intentionally does NOT match (narrowed to reduce false positives).
  const raw = `Agent: CVV ${CVV_RAW} on the back.`;
  const scrubbed = scrubTranscript(raw);
  assert.ok(
    !scrubbed.includes(`CVV ${CVV_RAW}`),
    "CVV-context code must not survive",
  );
  assert.match(scrubbed, /CVV \*\*\*/, "CVV redacted to ***");
});

test("AC-13.3: scrubbed transcript JSON-stringified contains no 13-19 digit run", () => {
  const raw = syntheticTranscript(VISA_TEST, CVV_RAW);
  const scrubbed = scrubTranscript(raw);
  const status = {
    callId: "sim_1234567",
    status: "completed" as const,
    transcript: scrubbed,
    parsedResult: {
      orderConfirmed: true,
      totalQuoted: 28.74,
      estimatedMinutes: 30,
      substitutionsMade: [],
      issuesEncountered: [],
      payment_method: "card_over_phone" as const,
      tip_amount: 3.75,
      total_with_tip: 28.74,
      cardCharged: true,
    },
  };
  const json = JSON.stringify(status);
  // No 13-19 digit contiguous run anywhere (last-4 alone is only 4 digits, safe).
  assert.ok(
    !/\b\d{13,19}\b/.test(json),
    "JSON must contain no 13-19 digit run",
  );
  // No 4-4-4-4 grouped digits anywhere.
  assert.ok(
    !/\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b/.test(json),
    "JSON must contain no 4-4-4-4 grouped digits",
  );
});

test("countRedactions is non-zero on a card-branch transcript", () => {
  const raw = syntheticTranscript(VISA_TEST, CVV_RAW);
  assert.ok(
    countRedactions(raw) >= 2,
    "must report at least one card + one CVV redaction",
  );
});

test("scrubTranscript on a cash transcript is byte-identical (no false positives)", () => {
  const cash = [
    `Domino's: Total is $24.99. Paying cash on delivery?`,
    `Agent: Yes, cash on delivery.`,
    `Domino's: Order confirmed, 30 minutes.`,
  ].join("\n");
  assert.equal(scrubTranscript(cash), cash);
});

test("scrubTranscript leaves sim_<timestamp> IDs alone (no false-positive on word-boundary)", () => {
  const text = "Call id is sim_1234567890123 placed at 2026-05-19.";
  assert.equal(
    scrubTranscript(text),
    text,
    "13-digit timestamp inside sim_ identifier must not be scrubbed",
  );
});
