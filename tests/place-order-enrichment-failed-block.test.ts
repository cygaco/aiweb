/**
 * tests/place-order-enrichment-failed-block.test.ts —
 * SP-20260517-005 / S-7 / AC-7.*.
 *
 *   AC-7.1: place_order called with all-unknown places restaurant +
 *           no override → error_code: "compatibility_blocked" with
 *           verdict_tier: "enrichment_failed"; no Bland dispatch.
 *   AC-7.2: place_order with override_compatibility=true → dispatch
 *           proceeds + override audit log records
 *           block_reason="enrichment_failed".
 *   AC-7.3: place_order against a normal "go" restaurant — new rule
 *           has no effect.
 *
 * Strategy: build the MCP server in-process via createServer(), grab
 * the place_order tool's handler from _registeredTools, call it
 * directly with controlled args. Push a places-style fixture
 * onto TEST_RESTAURANTS so getRestaurantById finds it.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Route logs into a per-run temp dir so we can spy on them.
const TMP = mkdtempSync(join(tmpdir(), "place-order-test-"));
process.env.COMPATIBILITY_OVERRIDE_EVENTS_FILE = join(TMP, "override.jsonl");
process.env.COMPATIBILITY_EVENTS_FILE = join(TMP, "compat.jsonl");
process.env.ENRICHMENT_EVENTS_FILE = join(TMP, "enrichment.jsonl");
process.env.INCLUDE_TEST_RESTAURANTS = "true";
process.env.BLAND_HARNESS_MODE = "1";
process.env.PROFILE_ENCRYPTION_SECRET = "0".repeat(64);

import { createServer } from "../src/server.js";
import { TEST_RESTAURANTS } from "../src/data/restaurants.js";
import type { Restaurant } from "../src/data/restaurants.js";

const FIXTURE: Restaurant = {
  id: "places_t094_unenriched",
  name: "Generic Pizza Co",
  phone: "+15555550099",
  address: "1 Generic Way, Medford, OR",
  lat: 42.3265,
  lng: -122.8756,
  deliveryRadius: 5,
  estimatedDeliveryMinutes: 30,
  acceptsCash: true,
  serviceType: "delivery",
  menu: {
    pizzas: [
      { name: "Pepperoni", sizes: [{ name: "Large", price: 16.99 }] },
      { name: "Cheese", sizes: [{ name: "Large", price: 15.99 }] },
    ],
    sides: [],
  },
  hours: "11-21",
  // menuSource omitted → isPlacesGeneric() returns true.
};

let server: ReturnType<typeof createServer>;
type Handler = (
  args: Record<string, unknown>,
  extra: Record<string, unknown>,
) => Promise<{ content: Array<{ type: string; text: string }> }>;

function getPlaceOrderHandler(): Handler {
  const tools = (
    server as unknown as {
      _registeredTools: Record<string, { handler: Handler }>;
    }
  )._registeredTools;
  const t = tools["place_order"];
  if (!t) throw new Error("place_order not registered");
  return t.handler;
}

before(() => {
  // Push the fixture so getRestaurantById finds it.
  TEST_RESTAURANTS.push(FIXTURE);
  server = createServer();
});

after(() => {
  // Pop the fixture so other suites are not affected.
  const idx = TEST_RESTAURANTS.findIndex((r) => r.id === FIXTURE.id);
  if (idx !== -1) TEST_RESTAURANTS.splice(idx, 1);
});

async function callPlaceOrder(args: Record<string, unknown>) {
  const handler = getPlaceOrderHandler();
  const res = await handler(args, {});
  return JSON.parse(res.content[0].text);
}

test("AC-7.1: all-unknown places restaurant + no override → compatibility_blocked + verdict_tier=enrichment_failed", async () => {
  const body = await callPlaceOrder({
    restaurant_name: FIXTURE.name,
    restaurant_id: FIXTURE.id,
    items: [
      {
        name: "From the Garden Pizza",
        size: "XL",
        quantity: 1,
        price: 0,
      },
    ],
    delivery_address: "1 Demo St, Medford, OR",
    customer_name: "Test User",
    customer_phone: "+14155551234",
    intent_style: "veggie",
  });
  assert.equal(body.status, "error");
  assert.equal(body.error_code, "compatibility_blocked");
  assert.equal(body.verdict_tier, "enrichment_failed");
  assert.match(body.message, /Refusing to dispatch/);
  // No call_id means no Bland dispatch fired.
  assert.equal(body.call_id, undefined);
});

test("AC-7.2: override_compatibility=true → dispatch proceeds, audit log captures block_reason=enrichment_failed", async () => {
  const body = await callPlaceOrder({
    restaurant_name: FIXTURE.name,
    restaurant_id: FIXTURE.id,
    items: [
      {
        name: "From the Garden Pizza",
        size: "XL",
        quantity: 1,
        price: 0,
      },
    ],
    delivery_address: "1 Demo St, Medford, OR",
    customer_name: "Test User",
    customer_phone: "+14155551234",
    intent_style: "veggie",
    override_compatibility: true,
  });
  assert.equal(
    body.status,
    "calling",
    `expected dispatch, got: ${JSON.stringify(body)}`,
  );
  assert.ok(
    typeof body.call_id === "string" && body.call_id.startsWith("sim_"),
    `expected sim_* callId, got ${body.call_id}`,
  );
  // Verify the override was audit-logged with the new block_reason.
  // All events share the same events file; cat=compatibility-override
  // distinguishes them.
  const eventsFile = process.env.COMPATIBILITY_EVENTS_FILE!;
  assert.ok(existsSync(eventsFile), "events log missing");
  const overrides = readFileSync(eventsFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter(
      (e) =>
        e.cat === "compatibility-override" &&
        e.data?.restaurant_id === FIXTURE.id,
    );
  assert.ok(
    overrides.length >= 1,
    `expected at least 1 compatibility-override event for ${FIXTURE.id}, got 0`,
  );
  const last = overrides[overrides.length - 1];
  assert.equal(last.data.block_reason, "enrichment_failed");
});

test("AC-7.3: normal go-state restaurant — new rule has no effect (dispatches)", async () => {
  // test_vlad has a real menu — verdict will be "go" for a known style.
  const body = await callPlaceOrder({
    restaurant_name: "Vlad's Pizza Restaurant",
    restaurant_id: "test_vlad",
    items: [
      {
        name: "Pepperoni",
        size: 'Large 14"',
        quantity: 1,
        price: 12.99,
      },
    ],
    delivery_address: "1 Market St, San Francisco, CA",
    customer_name: "Test User",
    customer_phone: "+14155551234",
    intent_style: "pepperoni",
  });
  assert.equal(
    body.status,
    "calling",
    `expected dispatch on go-state, got: ${JSON.stringify(body)}`,
  );
  assert.ok(
    typeof body.call_id === "string" && body.call_id.startsWith("sim_"),
  );
});
