#!/usr/bin/env node
/**
 * a2a-intent.js — Pure-function adapter: scenario → A2A message/send payload
 *
 * Sprint: SP-20260514-004
 * Ticket: T-20260514-082
 *
 * Translates a golden-path scenario object (per tests/golden-path-harness/scripts/*.json)
 * into a single A2A `message/send` payload. The executor's extractInput() reads
 * structured fields from the `data` part; the `text` part carries the human-readable
 * intent string described in copy.md C-3.
 *
 * Design decision: adapter sets confirmed=false (omits it) so the executor returns
 * `input-required` (proposed cart) quickly — no Bland polling required, timing is
 * well within AC-2.3's 5s/7s budget. expectedTaskState is always "input-required"
 * for the standard 3 happy-path scenarios.
 */

"use strict";

const { randomUUID } = require("crypto");

// ─────────────────────────────────────────────────────────────
// Custom error classes
// ─────────────────────────────────────────────────────────────

class AdapterMissingFieldsError extends Error {
  constructor(scenarioId, missingFields) {
    const fieldList = missingFields.join(", ");
    super(
      `A2A adapter: scenario "${scenarioId}" missing required field(s) [${fieldList}]. ` +
        `Either add the missing field to the scenario JSON, or set "a2a_expected_task_state": "input-required" ` +
        `if input-required is the desired test outcome.`,
    );
    this.name = "AdapterMissingFieldsError";
    this.scenarioId = scenarioId;
    this.missingFields = missingFields;
  }
}

class AdapterInvalidOverrideError extends Error {
  constructor(scenarioId, reason) {
    super(
      `A2A adapter: scenario "${scenarioId}" a2a_intent override is invalid: ${reason}`,
    );
    this.name = "AdapterInvalidOverrideError";
    this.scenarioId = scenarioId;
  }
}

// ─────────────────────────────────────────────────────────────
// Translation helpers
// ─────────────────────────────────────────────────────────────

/**
 * Derives a human-readable intent string from the scenario per copy.md C-3 rules:
 *   1. Read customer_address, customer_name, customer_phone from root.
 *   2. If items is set: "I want <items joined with commas>"
 *   3. Else if cart is set: "My cart is <cart items as 'qty x name' joined with commas>"
 *   4. Append ", delivered to <address>, customer <name>, phone <phone>, confirmed: true"
 */
function deriveIntentText(scenario) {
  const { customer_address, customer_name, customer_phone, items, cart } =
    scenario;

  let prefix;
  if (items && items.length > 0) {
    // items is an array of strings per IN-1
    const itemList = Array.isArray(items)
      ? items.map((it) => (typeof it === "string" ? it : it.name)).join(", ")
      : String(items);
    prefix = `I want ${itemList}`;
  } else if (cart && cart.length > 0) {
    // cart is array of {qty, name} per IN-1
    const cartList = cart
      .map((entry) => {
        const qty = entry.qty ?? entry.quantity ?? 1;
        const name = entry.name ?? entry.itemId ?? "item";
        return `${qty} x ${name}`;
      })
      .join(", ");
    prefix = `My cart is ${cartList}`;
  } else {
    // No items or cart — use a generic prefix; executor will return input-required
    prefix = "I want to place an order";
  }

  return `${prefix}, delivered to ${customer_address}, customer ${customer_name}, phone ${customer_phone}, confirmed: true`;
}

/**
 * Derives the structured data fields for the A2A message's data part.
 * These are the fields extractInput() can parse from a `data` part.
 * Note: we do NOT include confirmed:true so the executor returns input-required quickly.
 */
function deriveDataFields(scenario) {
  const data = {
    address: scenario.customer_address,
    name: scenario.customer_name,
    phone: scenario.customer_phone,
  };

  // Items or cart - pick up from scenario
  if (scenario.cart && scenario.cart.length > 0) {
    data.cart = scenario.cart;
  } else if (scenario.items && scenario.items.length > 0) {
    data.items = scenario.items;
  }

  // intent_style from items if scenario has an items field that's a string array
  // or infer from cart item names
  if (scenario.intent_style) {
    data.intent_style = scenario.intent_style;
  }

  return data;
}

// ─────────────────────────────────────────────────────────────
// Main adapter function
// ─────────────────────────────────────────────────────────────

/**
 * adapt(scenario) → { message, expectedTaskState }
 *
 * Pure function — no I/O, no global state, no network.
 * Unit-testable in isolation (AC-1.1).
 *
 * @param {Object} scenario - Scenario object loaded from tests/golden-path-harness/scripts/*.json
 * @returns {{ message: Object, expectedTaskState: string }}
 */
function adapt(scenario) {
  const scenarioId = scenario.id || "<unknown>";

  // ── Handle a2a_intent override (IN-2) ──────────────────────
  if (scenario.a2a_intent !== undefined) {
    const override = scenario.a2a_intent;
    if (typeof override !== "string" || override.length === 0) {
      throw new AdapterInvalidOverrideError(
        scenarioId,
        "must be a non-empty string",
      );
    }
    if (override.length > 2000) {
      throw new AdapterInvalidOverrideError(
        scenarioId,
        "must be ≤ 2000 characters",
      );
    }
    const expectedTaskState =
      scenario.a2a_expected_task_state === "input-required"
        ? "input-required"
        : "input-required"; // default: always input-required for 1-shot test
    return {
      message: {
        role: "user",
        messageId: randomUUID(),
        parts: [{ kind: "text", text: override }],
      },
      expectedTaskState,
    };
  }

  // ── Validate required fields (IN-1) ──────────────────────
  const missingFields = [];
  if (!scenario.customer_address) missingFields.push("customer_address");
  if (!scenario.customer_name) missingFields.push("customer_name");
  if (!scenario.customer_phone) missingFields.push("customer_phone");
  const hasItems = scenario.items && scenario.items.length > 0;
  const hasCart = scenario.cart && scenario.cart.length > 0;

  if (!hasItems && !hasCart) {
    // If a2a_expected_task_state is set, allow missing items (will be input-required anyway)
    if (!scenario.a2a_expected_task_state) {
      missingFields.push("items or cart");
    }
  }

  if (missingFields.length > 0) {
    // If the scenario explicitly expects input-required, don't throw — let it pass through
    if (scenario.a2a_expected_task_state === "input-required") {
      // Partial data is fine for input-required scenarios
    } else {
      throw new AdapterMissingFieldsError(scenarioId, missingFields);
    }
  }

  // ── Derive intent text (copy.md C-3) ─────────────────────
  const intentText = deriveIntentText(scenario);

  // ── Derive structured data for extractInput ───────────────
  const dataFields = deriveDataFields(scenario);

  // ── Determine expected task state ─────────────────────────
  // Without confirmed:true in the data, executor returns input-required (fast).
  // AC-2.3 requires <5s per scenario — this avoids the 15s Bland poll wait.
  const expectedTaskState =
    scenario.a2a_expected_task_state === "completed"
      ? "completed"
      : "input-required";

  // ── Build A2A message (AC-1.2) ───────────────────────────
  const message = {
    role: "user",
    messageId: randomUUID(),
    parts: [
      // parts[0]: text part — human-readable intent (AC-1.2)
      { kind: "text", text: intentText },
      // parts[1]: data part — structured fields for extractInput()
      { kind: "data", data: dataFields },
    ],
  };

  return { message, expectedTaskState };
}

module.exports = {
  adapt,
  AdapterMissingFieldsError,
  AdapterInvalidOverrideError,
};
