import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Route the event log into a per-run temp dir so we can spy on it without
// polluting the project's runtime/ dir. event-log.ts reads the env var at
// write-time, so setting it before any assess call is enough.
const TMP_DIR = mkdtempSync(join(tmpdir(), "compat-test-"));
const EVENTS_FILE = join(TMP_DIR, "events.jsonl");
process.env.COMPATIBILITY_EVENTS_FILE = EVENTS_FILE;

import {
  checkDeliveryAvailability,
  checkDeliveryCoverage,
  checkItemAvailability,
  assessCompatibility,
} from "../src/lib/compatibility.js";
import type { Restaurant } from "../src/data/restaurants.js";

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────

const VLAD: Restaurant = {
  id: "test_vlad",
  name: "Vlad's Pizza Restaurant",
  phone: "+14152335033",
  address: "San Francisco, CA",
  lat: 37.7749,
  lng: -122.4194,
  deliveryRadius: 10,
  estimatedDeliveryMinutes: 30,
  acceptsCash: true,
  serviceType: "delivery",
  menu: {
    pizzas: [
      {
        name: "Pepperoni",
        sizes: [{ name: 'Large 14"', price: 12.99 }],
      },
      {
        name: "Cheese",
        sizes: [{ name: 'Large 14"', price: 11.99 }],
      },
      {
        name: "Meat Lovers",
        sizes: [{ name: 'Large 14"', price: 15.99 }],
      },
    ],
    sides: [],
  },
  hours: "11:00 AM - 11:00 PM",
  isTest: true,
};

const PICKUP_ONLY: Restaurant = {
  ...VLAD,
  id: "test_pickup_only",
  name: "Slice Box",
  serviceType: "pickup_only",
  deliveryRadius: 0,
};

const PLACES: Restaurant = {
  id: "places_xyz",
  name: "Random Pizza Co.",
  phone: "+14155551234",
  address: "Somewhere, CA",
  lat: 37.78,
  lng: -122.42,
  deliveryRadius: null,
  estimatedDeliveryMinutes: 30,
  acceptsCash: true,
  serviceType: "unknown",
  menu: {
    pizzas: [
      { name: "Pepperoni", sizes: [{ name: "Large", price: 16.99 }] },
      { name: "Cheese", sizes: [{ name: "Large", price: 15.99 }] },
      { name: "Specialty", sizes: [{ name: "Large", price: 18.99 }] },
    ],
    sides: [],
  },
  hours: "Daily",
};

const DOMINOS_LATLNG_ZERO: Restaurant = {
  id: "dominos_1234",
  name: "Domino's Pizza",
  phone: "+14155556789",
  address: "Some St, San Francisco, CA",
  lat: 0,
  lng: 0,
  deliveryRadius: 5,
  estimatedDeliveryMinutes: 30,
  acceptsCash: true,
  serviceType: "delivery",
  menu: {
    pizzas: [{ name: "Pepperoni", sizes: [{ name: "Large", price: 12.99 }] }],
    sides: [],
  },
  hours: "11–11",
};

// User position: 1 Market St, SF — ~0.3 mi from VLAD
const USER_NEAR_LAT = 37.7945;
const USER_NEAR_LNG = -122.3959;
// User far from VLAD (Ohio-ish)
const USER_FAR_LAT = 41.0;
const USER_FAR_LNG = -81.5;

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

// 1
test("checkDeliveryAvailability — test_vlad serviceType=delivery → available", () => {
  const r = checkDeliveryAvailability(VLAD);
  assert.strictEqual(r.state, "available");
  assert.ok(r.confidence >= 0.9);
});

// 2
test("checkDeliveryAvailability — places restaurant (serviceType unknown) → unknown", () => {
  const r = checkDeliveryAvailability(PLACES);
  assert.strictEqual(r.state, "unknown");
  assert.ok(r.confidence <= 0.5);
});

// 3
test("checkDeliveryAvailability — explicit pickup_only", () => {
  const r = checkDeliveryAvailability(PICKUP_ONLY);
  assert.strictEqual(r.state, "pickup_only");
});

// 4
test("checkDeliveryCoverage — test_vlad with user near (0.3 mi vs 10 mi radius) → in_range", () => {
  const r = checkDeliveryCoverage(VLAD, USER_NEAR_LAT, USER_NEAR_LNG);
  assert.strictEqual(r.state, "in_range");
  assert.ok(r.confidence >= 0.9);
});

// 5
test("checkDeliveryCoverage — test_vlad with user 50 mi away → out_of_range", () => {
  const r = checkDeliveryCoverage(VLAD, USER_FAR_LAT, USER_FAR_LNG);
  assert.strictEqual(r.state, "out_of_range");
});

// 6
test("checkDeliveryCoverage — places (deliveryRadius=null) → unknown", () => {
  const r = checkDeliveryCoverage(PLACES, USER_NEAR_LAT, USER_NEAR_LNG);
  assert.strictEqual(r.state, "unknown");
  assert.ok(r.confidence <= 0.5);
});

// 7
test("checkItemAvailability — test_vlad + 'Meat Lovers' (matches menu) → available", () => {
  const r = checkItemAvailability(VLAD, "Meat Lovers");
  assert.strictEqual(r.state, "available");
  assert.ok(r.confidence >= 0.9);
});

// 8
test("checkItemAvailability — test_vlad + 'sushi' → not_available", () => {
  const r = checkItemAvailability(VLAD, "sushi");
  assert.strictEqual(r.state, "not_available");
});

// 9
test("checkItemAvailability — places + 'pepperoni' (matches generic) → likely_available", () => {
  const r = checkItemAvailability(PLACES, "pepperoni");
  assert.strictEqual(r.state, "likely_available");
  assert.ok(r.confidence <= 0.7);
});

// 10
test("checkItemAvailability — places + 'meat_lovers' (not in generic) → unknown", () => {
  const r = checkItemAvailability(PLACES, "meat_lovers");
  assert.strictEqual(r.state, "unknown");
});

// 11
test("checkItemAvailability — empty intent → unknown with 'ask user' nextStep", () => {
  const r = checkItemAvailability(VLAD, "");
  assert.strictEqual(r.state, "unknown");
  assert.match(r.nextStep ?? "", /ask user/i);
});

// 12
test("assessCompatibility — all-go: VLAD + near user + Meat Lovers → go", () => {
  const r = assessCompatibility(
    VLAD,
    USER_NEAR_LAT,
    USER_NEAR_LNG,
    "Meat Lovers",
  );
  assert.strictEqual(r.overall, "go");
  assert.strictEqual(r.nextStep, null);
});

// 13
test("assessCompatibility — one no_go (out_of_range) → no_go + nextStep about different restaurant", () => {
  const r = assessCompatibility(VLAD, USER_FAR_LAT, USER_FAR_LNG, "Pepperoni");
  assert.strictEqual(r.overall, "no_go");
  assert.match(r.nextStep ?? "", /closer|different/i);
});

// 14
test("assessCompatibility — two unknowns → caution + nextStep targets lowest-confidence check", () => {
  // PLACES: delivery=unknown(0.4), coverage=unknown(0.4), item depends.
  // intent='pepperoni' → places generic match → likely_available (0.6).
  // Lowest confidence: 0.4 — tie between delivery (first) and coverage.
  // Combiner picks the first lowest in the ordered iteration (delivery).
  const r = assessCompatibility(
    PLACES,
    USER_NEAR_LAT,
    USER_NEAR_LNG,
    "pepperoni",
  );
  assert.strictEqual(r.overall, "caution");
  assert.ok(r.nextStep && r.nextStep.length > 0);
});

// 15
test("assessCompatibility — mix of go + caution + no_go → no_go wins", () => {
  // VLAD with intent 'sushi' (not_available) + far user (out_of_range).
  // Both checks are no_go; the first failing check (delivery is OK; coverage
  // first → out_of_range) drives the next step.
  const r = assessCompatibility(VLAD, USER_FAR_LAT, USER_FAR_LNG, "sushi");
  assert.strictEqual(r.overall, "no_go");
});

// 16 — logger spy
test("assessCompatibility — emits EVT-compatibility line to events file", () => {
  // Snapshot length, run an assess, confirm the file grew with the right cat.
  const before = existsSync(EVENTS_FILE)
    ? readFileSync(EVENTS_FILE, "utf8")
    : "";
  assessCompatibility(VLAD, USER_NEAR_LAT, USER_NEAR_LNG, "Pepperoni");
  const after = readFileSync(EVENTS_FILE, "utf8");
  assert.ok(after.length > before.length);
  const newLines = after.slice(before.length).trim().split("\n");
  const last = JSON.parse(newLines[newLines.length - 1]);
  assert.strictEqual(last.cat, "compatibility");
  assert.strictEqual(last.actor, "alex");
  assert.strictEqual(last.data.restaurant_id, "test_vlad");
  assert.strictEqual(last.data.overall, "go");
});

// 17a — snake_case intent matches menu names (server schema documents
// `meat_lovers` format). Caught by QA gauntlet — without underscore→space
// normalization, the fuzzy match misses and emits not_available.
test("checkItemAvailability — snake_case intent ('meat_lovers') matches 'Meat Lovers'", () => {
  const r = checkItemAvailability(VLAD, "meat_lovers");
  assert.strictEqual(r.state, "available");
});

// 17 — Domino's lat=0/lng=0 special case (PRD-V2-DELTA C-1)
test("checkDeliveryCoverage — dominos_* with lat=0/lng=0 → unknown (NOT out_of_range)", () => {
  const r = checkDeliveryCoverage(
    DOMINOS_LATLNG_ZERO,
    USER_NEAR_LAT,
    USER_NEAR_LNG,
  );
  assert.strictEqual(r.state, "unknown");
  assert.notStrictEqual(r.state, "out_of_range");
  assert.match(r.source, /coords_missing|dominos/);
});
