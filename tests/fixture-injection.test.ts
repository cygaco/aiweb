// SP-20260517-005 / S-11 / T-098 — TEST_RESTAURANTS_FIXTURE_FILE plumbing.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findNearbyRestaurants,
  getRestaurantById,
  _resetFixtureCache,
} from "../src/data/restaurants.js";

const ORIGINAL_FIXTURE_ENV = process.env.TEST_RESTAURANTS_FIXTURE_FILE;
const ORIGINAL_INCLUDE_TEST = process.env.INCLUDE_TEST_RESTAURANTS;

afterEach(() => {
  if (ORIGINAL_FIXTURE_ENV === undefined) {
    delete process.env.TEST_RESTAURANTS_FIXTURE_FILE;
  } else {
    process.env.TEST_RESTAURANTS_FIXTURE_FILE = ORIGINAL_FIXTURE_ENV;
  }
  if (ORIGINAL_INCLUDE_TEST === undefined) {
    delete process.env.INCLUDE_TEST_RESTAURANTS;
  } else {
    process.env.INCLUDE_TEST_RESTAURANTS = ORIGINAL_INCLUDE_TEST;
  }
  _resetFixtureCache();
});

function withFixture(restaurants: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "fixture-test-"));
  const path = join(dir, "fixtures.json");
  writeFileSync(path, JSON.stringify({ restaurants }));
  return path;
}

const PLACES_FIXTURE = {
  id: "places_fixture_sf",
  name: "Fixture Pizza",
  phone: "+14155550199",
  address: "1 Fixture St, SF",
  lat: 37.7944,
  lng: -122.3973,
  deliveryRadius: 5,
  estimatedDeliveryMinutes: 25,
  acceptsCash: true,
  serviceType: "delivery",
  menu: {
    pizzas: [{ name: "Pepperoni", sizes: [{ name: "Large", price: 16.99 }] }],
    sides: [],
  },
  hours: "11-21",
};

test("fixture injection: places-style restaurant appears in findNearbyRestaurants", async () => {
  process.env.TEST_RESTAURANTS_FIXTURE_FILE = withFixture([PLACES_FIXTURE]);
  process.env.INCLUDE_TEST_RESTAURANTS = "false";
  _resetFixtureCache();
  const out = await findNearbyRestaurants("1 Market St, San Francisco, CA");
  assert.ok(out.some((r) => r.id === "places_fixture_sf"));
});

test("fixture injection: getRestaurantById resolves fixture entries", async () => {
  process.env.TEST_RESTAURANTS_FIXTURE_FILE = withFixture([PLACES_FIXTURE]);
  _resetFixtureCache();
  // Need to call findNearbyRestaurants OR getRestaurantById — both lazy-load.
  const found = getRestaurantById("places_fixture_sf");
  assert.ok(found);
  assert.equal(found?.name, "Fixture Pizza");
});

test("fixture injection: INCLUDE_TEST_RESTAURANTS=false suppresses test_vlad but keeps fixtures", async () => {
  process.env.TEST_RESTAURANTS_FIXTURE_FILE = withFixture([PLACES_FIXTURE]);
  process.env.INCLUDE_TEST_RESTAURANTS = "false";
  _resetFixtureCache();
  const out = await findNearbyRestaurants("1 Market St, San Francisco, CA");
  assert.equal(
    out.some((r) => r.id === "test_vlad"),
    false,
  );
  assert.ok(out.some((r) => r.id === "places_fixture_sf"));
});

test("fixture injection: missing env var → no fixture, normal behavior", async () => {
  delete process.env.TEST_RESTAURANTS_FIXTURE_FILE;
  process.env.INCLUDE_TEST_RESTAURANTS = "true";
  _resetFixtureCache();
  const out = await findNearbyRestaurants("1 Market St, San Francisco, CA");
  assert.ok(out.some((r) => r.id === "test_vlad"));
});

test("fixture injection: nonexistent file → silent skip, no crash", async () => {
  process.env.TEST_RESTAURANTS_FIXTURE_FILE = "/path/does/not/exist.json";
  process.env.INCLUDE_TEST_RESTAURANTS = "true";
  _resetFixtureCache();
  const out = await findNearbyRestaurants("1 Market St, San Francisco, CA");
  // test_vlad still appears because INCLUDE_TEST_RESTAURANTS=true.
  assert.ok(out.some((r) => r.id === "test_vlad"));
});

test("fixture injection: malformed JSON → silent skip", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fixture-malformed-"));
  const path = join(dir, "bad.json");
  writeFileSync(path, "{ not valid json");
  process.env.TEST_RESTAURANTS_FIXTURE_FILE = path;
  process.env.INCLUDE_TEST_RESTAURANTS = "true";
  _resetFixtureCache();
  const out = await findNearbyRestaurants("1 Market St, San Francisco, CA");
  // Falls back to test_vlad — no crash.
  assert.ok(out.some((r) => r.id === "test_vlad"));
});
