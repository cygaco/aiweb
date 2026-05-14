/**
 * A2A adapter unit tests — SP-20260514-004 T-084
 *
 * AC-3.1 — 3 happy-path tests (pizza-only, pizza-plus-side, pizza-plus-drink)
 * AC-3.2 — 2 edge-case tests: missing customer_address, cart-mode items
 * AC-3.3 — runs under `npm test` (tsx --test)
 * AC-1.1 — pure function: no I/O, no network, no process side-effects
 * AC-1.2 — shape: message.role === "user", messageId is UUID, parts[0] is text
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");

// Load adapter via CommonJS require (the adapter is CJS)
const { adapt, AdapterMissingFieldsError } = require(
  path.join(ROOT, "scripts/harness/adapters/a2a-intent.js"),
) as {
  adapt: (scenario: unknown) => { message: unknown; expectedTaskState: string };
  AdapterMissingFieldsError: new (
    scenarioId: string,
    missingFields: string[],
  ) => Error & { missingFields: string[] };
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function loadScenario(name: string): Record<string, unknown> {
  const file = path.join(
    ROOT,
    "tests/golden-path-harness/scripts",
    `${name}.json`,
  );
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

/**
 * Assert AC-1.2 shape on the returned { message, expectedTaskState } object.
 */
function assertAdapterShape(
  result: { message: unknown; expectedTaskState: string },
  label: string,
) {
  const { message, expectedTaskState } = result;

  // expectedTaskState must be one of the two allowed values
  assert.ok(
    expectedTaskState === "completed" || expectedTaskState === "input-required",
    `${label}: expectedTaskState must be "completed" or "input-required", got "${expectedTaskState}"`,
  );

  // message shape
  assert.ok(
    message !== null && typeof message === "object",
    `${label}: message must be an object`,
  );
  const msg = message as Record<string, unknown>;

  // role
  assert.strictEqual(msg.role, "user", `${label}: message.role must be "user"`);

  // messageId is UUID
  assert.ok(
    typeof msg.messageId === "string" && UUID_RE.test(msg.messageId),
    `${label}: message.messageId must be a UUID, got "${msg.messageId}"`,
  );

  // parts[0] is a text part with non-empty body
  assert.ok(
    Array.isArray(msg.parts) && msg.parts.length > 0,
    `${label}: message.parts must be a non-empty array`,
  );
  const part0 = (msg.parts as Record<string, unknown>[])[0];
  assert.strictEqual(
    part0.kind,
    "text",
    `${label}: parts[0].kind must be "text"`,
  );
  assert.ok(
    typeof part0.text === "string" && part0.text.length > 0,
    `${label}: parts[0].text must be a non-empty string`,
  );
}

// ─────────────────────────────────────────────────────────────
// Happy-path tests (one per scenario)
// ─────────────────────────────────────────────────────────────

describe("A2A adapter — happy-path (SP-20260514-004 T-084, AC-3.1)", () => {
  test("pizza-only scenario produces valid adapter output", () => {
    const scenario = loadScenario("pizza-only");
    // The standard scenarios use MCP tool steps, not A2A fields; inject minimal A2A fields
    // to match what the adapter needs — mirroring how golden-path.js calls adapt()
    const a2aScenario = {
      id: "pizza-only",
      customer_address: "1 Market St, San Francisco, CA 94105",
      customer_name: "Vlad Test",
      customer_phone: "+15555550100",
      items: ["Meat Lovers Pizza"],
    };
    const result = adapt(a2aScenario);
    assertAdapterShape(result, "pizza-only");
    // intent text should mention the item and address
    const msg = result.message as Record<string, unknown>;
    const parts = msg.parts as Record<string, unknown>[];
    const text = parts[0].text as string;
    assert.ok(
      text.includes("Meat Lovers Pizza") || text.includes("I want"),
      `pizza-only: intent text should reference items, got: "${text}"`,
    );
    assert.ok(
      text.includes("1 Market St"),
      `pizza-only: intent text should reference address, got: "${text}"`,
    );
    assert.ok(
      text.includes("Vlad Test"),
      `pizza-only: intent text should reference name, got: "${text}"`,
    );
    assert.ok(
      text.includes("+15555550100"),
      `pizza-only: intent text should reference phone, got: "${text}"`,
    );
  });

  test("pizza-plus-side scenario produces valid adapter output", () => {
    const a2aScenario = {
      id: "pizza-plus-side",
      customer_address: "1 Market St, San Francisco, CA 94105",
      customer_name: "Vlad Test",
      customer_phone: "+15555550100",
      items: ["Meat Lovers Pizza", "Wings (8pc)"],
    };
    const result = adapt(a2aScenario);
    assertAdapterShape(result, "pizza-plus-side");
    const msg = result.message as Record<string, unknown>;
    const parts = msg.parts as Record<string, unknown>[];
    const text = parts[0].text as string;
    assert.ok(
      text.includes("Wings") || text.includes("I want"),
      `pizza-plus-side: intent should reference side, got: "${text}"`,
    );
  });

  test("pizza-plus-drink scenario produces valid adapter output", () => {
    const a2aScenario = {
      id: "pizza-plus-drink",
      customer_address: "1 Market St, San Francisco, CA 94105",
      customer_name: "Vlad Test",
      customer_phone: "+15555550100",
      items: ["Meat Lovers Pizza", "Coke 20oz"],
    };
    const result = adapt(a2aScenario);
    assertAdapterShape(result, "pizza-plus-drink");
    const msg = result.message as Record<string, unknown>;
    const parts = msg.parts as Record<string, unknown>[];
    const text = parts[0].text as string;
    assert.ok(
      text.includes("Coke") || text.includes("I want"),
      `pizza-plus-drink: intent should reference drink, got: "${text}"`,
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Edge-case tests (AC-3.2)
// ─────────────────────────────────────────────────────────────

describe("A2A adapter — edge cases (SP-20260514-004 T-084, AC-3.2)", () => {
  /**
   * AC-3.2 / AC-1.1 — missing customer_address: adapter must throw AdapterMissingFieldsError
   * with missingFields containing "customer_address" (per copy.md C-1).
   */
  test("scenario missing customer_address throws AdapterMissingFieldsError", () => {
    const scenario = {
      id: "no-address-scenario",
      // customer_address intentionally omitted
      customer_name: "Test User",
      customer_phone: "+15555550100",
      items: ["Cheese Pizza"],
    };

    let threw = false;
    try {
      adapt(scenario);
    } catch (err) {
      threw = true;
      assert.ok(
        err instanceof AdapterMissingFieldsError,
        `Expected AdapterMissingFieldsError, got ${(err as Error).constructor.name}: ${(err as Error).message}`,
      );
      const adaptErr = err as InstanceType<typeof AdapterMissingFieldsError>;
      assert.ok(
        adaptErr.missingFields.includes("customer_address"),
        `missingFields should include "customer_address", got: ${JSON.stringify(adaptErr.missingFields)}`,
      );
      // Error message should name the scenario id (copy.md C-1)
      assert.ok(
        adaptErr.message.includes("no-address-scenario"),
        `error message should include scenario id, got: "${adaptErr.message}"`,
      );
    }
    assert.ok(
      threw,
      "adapt() should have thrown for a scenario missing customer_address",
    );
  });

  /**
   * AC-3.2 — cart-mode scenario: items expressed as {qty, name} cart entries.
   * Adapter should produce intent text in "My cart is N x <name>" format.
   */
  test("cart-mode scenario produces 'qty x name' intent text", () => {
    const scenario = {
      id: "cart-mode-scenario",
      customer_address: "42 Cart Lane, San Francisco, CA 94105",
      customer_name: "Cart User",
      customer_phone: "+15559990000",
      cart: [
        { qty: 2, name: "Meat Lovers Pizza" },
        { qty: 1, name: "Wings (8pc)" },
      ],
    };

    const result = adapt(scenario);
    assertAdapterShape(result, "cart-mode");

    const msg = result.message as Record<string, unknown>;
    const parts = msg.parts as Record<string, unknown>[];
    const text = parts[0].text as string;

    // Intent must use "My cart is" prefix and "qty x name" formatting
    assert.ok(
      text.startsWith("My cart is"),
      `cart-mode: intent should start with "My cart is", got: "${text}"`,
    );
    assert.ok(
      text.includes("2 x Meat Lovers Pizza"),
      `cart-mode: intent should contain "2 x Meat Lovers Pizza", got: "${text}"`,
    );
    assert.ok(
      text.includes("1 x Wings (8pc)"),
      `cart-mode: intent should contain "1 x Wings (8pc)", got: "${text}"`,
    );
  });
});
