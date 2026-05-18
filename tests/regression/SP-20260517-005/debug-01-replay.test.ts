// SPRINT GOAL TEST — SP-20260517-005 / replays ai-web-debug-01.docx.
// Every assertion would have FAILED before this sprint and now PASSES.
// Bug classes closed:
//   1. stale-deploy-exposes-removed-tools (R-1, T-089)
//   2. all-unknown-verdict-ships-cart (R-3, T-093/T-094)
//   3. homepage-only-fetch-misses-nav-link-menus (R-2, T-090/T-091/T-092)

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "sp-20260517-005-replay-"));
process.env.COMPATIBILITY_EVENTS_FILE = join(TMP, "events.jsonl");
process.env.INCLUDE_TEST_RESTAURANTS = "true";
process.env.BLAND_HARNESS_MODE = "1";
process.env.PROFILE_ENCRYPTION_SECRET = "0".repeat(64);

import { createServer } from "../../../src/server.js";
import { TEST_RESTAURANTS } from "../../../src/data/restaurants.js";
import type { Restaurant } from "../../../src/data/restaurants.js";
import { assessCompatibility } from "../../../src/lib/compatibility.js";
import { findMenuPageCandidates } from "../../../src/lib/menu-discovery.js";

// Mirrors what Places returned for Kaleidoscope pre-enrichment.
const KALEIDOSCOPE_LIKE: Restaurant = {
  id: "places_debug01_kaleidoscope_like",
  name: "Kaleidoscope-Like Pizzeria",
  phone: "+15555550100",
  address: "3084 Crater Lake Hwy, Medford, OR",
  lat: 42.3582,
  lng: -122.8388,
  deliveryRadius: 5,
  estimatedDeliveryMinutes: 25,
  acceptsCash: true,
  serviceType: "delivery",
  menu: {
    pizzas: [
      { name: "Pepperoni", sizes: [{ name: "Large", price: 16.99 }] },
      { name: "Cheese", sizes: [{ name: "Large", price: 15.99 }] },
      { name: "Specialty", sizes: [{ name: "Large", price: 18.99 }] },
    ],
    sides: [],
  },
  hours: "11-21",
};

let server: ReturnType<typeof createServer>;
type Handler = (
  args: Record<string, unknown>,
  extra: Record<string, unknown>,
) => Promise<{ content: Array<{ type: string; text: string }> }>;

function getHandler(name: string): Handler {
  const tools = (
    server as unknown as {
      _registeredTools: Record<string, { handler: Handler }>;
    }
  )._registeredTools;
  const t = tools[name];
  if (!t) throw new Error("tool " + name + " not registered");
  return t.handler;
}

before(() => {
  TEST_RESTAURANTS.push(KALEIDOSCOPE_LIKE);
  server = createServer();
});

after(() => {
  const idx = TEST_RESTAURANTS.findIndex((r) => r.id === KALEIDOSCOPE_LIKE.id);
  if (idx !== -1) TEST_RESTAURANTS.splice(idx, 1);
});

test("BUG-1 (image 1): MCP tool surface no longer exposes profile tools", () => {
  const tools = Object.keys(
    (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools,
  );
  const EXPECTED = new Set([
    "prepare_order",
    "start_pizza_order",
    "update_order",
    "place_order",
    "check_order_status",
  ]);
  const unexpected = tools.filter((t) => !EXPECTED.has(t));
  const missing = [...EXPECTED].filter((t) => !tools.includes(t));
  assert.deepEqual(unexpected, []);
  assert.deepEqual(missing, []);
});

test("BUG-3 (image 4): link-discovery finds /pizza, /eat, /drink on Kaleidoscope nav", () => {
  const html =
    '<a href="https://kaleidoscopepizza.com/eat/">Eat</a>' +
    '<a href="https://kaleidoscopepizza.com/pizza/">Pizza</a>' +
    '<a href="https://kaleidoscopepizza.com/drink/">Drink</a>' +
    '<a href="https://order.toasttab.com/online/kaleidoscope">Order</a>';
  const c = findMenuPageCandidates(html, "https://kaleidoscopepizza.com/");
  assert.ok(c.some((u) => u.includes("/pizza")));
  assert.ok(c.some((u) => u.includes("/eat")));
  assert.ok(c.some((u) => u.includes("/drink")));
  assert.ok(c.some((u) => u.includes("toasttab.com")));
});

test("BUG-2a (image 3): assessCompatibility refuses unenriched restaurant on user's actual intent", () => {
  const a = assessCompatibility(
    KALEIDOSCOPE_LIKE,
    42.3265,
    -122.8756,
    {
      pizza: { style: "veggie", size: "XL" },
      sides: [{ name: "wings" }],
      drinks: [{ name: "Coke", brand: "Coca-Cola", size: "2L" }],
    },
    { enrichmentAttempted: true },
  );
  assert.equal(a.overall, "no_go");
  assert.equal(a.verdict_tier, "enrichment_failed");
  assert.match(a.nextStep ?? "", /Real menu not found/);
});

test("BUG-2b (image 5): place_order refuses dispatch against unenriched restaurant", async () => {
  const handler = getHandler("place_order");
  const res = await handler(
    {
      restaurant_name: KALEIDOSCOPE_LIKE.name,
      restaurant_id: KALEIDOSCOPE_LIKE.id,
      items: [
        { name: "From the Garden Pizza", size: "XL", quantity: 2, price: 0 },
      ],
      delivery_address:
        "SpringHill Suites by Marriott Medford, Room 102, Medford, OR",
      customer_name: "Vladislav Zhirnov",
      customer_phone: "+14152335033",
      intent_style: "veggie",
    },
    {},
  );
  const body = JSON.parse(res.content[0].text);
  assert.equal(body.status, "error");
  assert.equal(body.error_code, "compatibility_blocked");
  assert.equal(body.verdict_tier, "enrichment_failed");
  assert.equal(body.call_id, undefined);
});

test("BUG-2c (image 6 pushback): override_compatibility=true proceeds + audit-logs", async () => {
  const handler = getHandler("place_order");
  const res = await handler(
    {
      restaurant_name: KALEIDOSCOPE_LIKE.name,
      restaurant_id: KALEIDOSCOPE_LIKE.id,
      items: [
        { name: "From the Garden Pizza", size: "XL", quantity: 1, price: 0 },
      ],
      delivery_address: "1 Demo St, Medford, OR",
      customer_name: "Test User",
      customer_phone: "+14155551234",
      intent_style: "veggie",
      override_compatibility: true,
    },
    {},
  );
  const body = JSON.parse(res.content[0].text);
  assert.equal(body.status, "calling");
  assert.ok(body.call_id?.startsWith("sim_"));

  const events = readFileSync(process.env.COMPATIBILITY_EVENTS_FILE!, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter(
      (e) =>
        e.cat === "compatibility-override" &&
        e.data?.restaurant_id === KALEIDOSCOPE_LIKE.id,
    );
  assert.ok(events.length >= 1);
  assert.equal(
    events[events.length - 1].data.block_reason,
    "enrichment_failed",
  );
});
