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

// 9 — generic template is not evidence; both match and no-match → unknown
test("checkItemAvailability — places + 'pepperoni' (generic template match) → unknown, not likely_available", () => {
  const r = checkItemAvailability(PLACES, "pepperoni");
  assert.strictEqual(r.state, "unknown");
  assert.notStrictEqual(r.state, "likely_available");
  assert.ok(r.confidence <= 0.5);
  assert.strictEqual(r.source, "places_generic_menu");
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
test("assessCompatibility — three unknowns → caution + nextStep targets lowest-confidence check", () => {
  // PLACES: delivery=unknown(0.4), coverage=unknown(0.4), item=unknown(0.4).
  // Generic template no longer produces likely_available — all three unknown.
  // All three in caution set; combiner picks first (delivery) for nextStep.
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

// 18 — generic template match is never likely_available (Sprint Phase 3)
test("checkItemAvailability — places + 'meat_lovers' match in generic template → unknown, not likely_available", () => {
  // Even if the intent is in the generic 3-item list, it must not produce likely_available.
  const placesWithMeatLovers: Restaurant = {
    ...PLACES,
    menu: {
      pizzas: [
        { name: "Meat Lovers", sizes: [{ name: "Large", price: 16.99 }] },
      ],
      sides: [],
    },
  };
  const r = checkItemAvailability(placesWithMeatLovers, "meat_lovers");
  assert.strictEqual(r.state, "unknown");
  assert.notStrictEqual(r.state, "likely_available");
});

// 19 — Domino's unchanged by the generic-menu tightening
test("checkItemAvailability — dominos + 'pepperoni' on real menu → available", () => {
  const r = checkItemAvailability(DOMINOS_LATLNG_ZERO, "pepperoni");
  assert.strictEqual(r.state, "available");
});

// 20 — places + intent not in generic → unknown (unchanged from before)
test("checkItemAvailability — places + 'sushi' → unknown, not not_available", () => {
  const r = checkItemAvailability(PLACES, "sushi");
  assert.strictEqual(r.state, "unknown");
  assert.strictEqual(r.source, "places_generic_menu");
});

// 21 — enriched places restaurant (menuSource='restaurant_website') bypasses generic-template path
test("checkItemAvailability — places + menuSource=restaurant_website + item on menu → available", () => {
  const enrichedPlaces: Restaurant = {
    ...PLACES,
    menuSource: "restaurant_website",
    menu: {
      pizzas: [
        { name: "Buffalo Chicken", sizes: [{ name: "Large", price: 17.99 }] },
        { name: "Pepperoni", sizes: [{ name: "Large", price: 15.99 }] },
      ],
      sides: [],
    },
  };
  const r = checkItemAvailability(enrichedPlaces, "Buffalo Chicken");
  assert.strictEqual(r.state, "available");
  assert.notStrictEqual(r.source, "places_generic_menu");
});

// 22 — enriched places restaurant + item NOT on menu → not_available (real evidence)
test("checkItemAvailability — places + menuSource=restaurant_website + item not on menu → not_available", () => {
  const enrichedPlaces: Restaurant = {
    ...PLACES,
    menuSource: "restaurant_website",
    menu: {
      pizzas: [{ name: "Cheese", sizes: [{ name: "Large", price: 14.99 }] }],
      sides: [],
    },
  };
  const r = checkItemAvailability(enrichedPlaces, "meat_lovers");
  assert.strictEqual(r.state, "not_available");
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

// ──────────────────────────────────────────────────────────────────────────────
// S-22 NEW TESTS (SP-20260512-002)
// ──────────────────────────────────────────────────────────────────────────────

import {
  checkSideAvailability,
  checkDrinkAvailability,
} from "../src/lib/compatibility.js";

// Additional fixtures for brand-aware tests
const VLAD_WITH_DRINKS: Restaurant = {
  ...VLAD,
  id: "test_vlad",
  menu: {
    ...VLAD.menu,
    drinks: [
      {
        id: "coke_20oz",
        name: "Coca-Cola",
        brand: "Coca-Cola",
        sizes: [
          { id: "20oz", name: "20oz Bottle", price: 2.49 },
          { id: "2l", name: "2L Bottle", price: 3.99 },
        ],
      },
    ],
    sides: [
      { name: "Wings (8pc)", sizes: [{ name: "Regular", price: 8.99 }] },
      { name: "Cheesy Bread", sizes: [{ name: "Regular", price: 6.99 }] },
    ],
  },
};

const PEPSI_ONLY_SHOP: Restaurant = {
  id: "test_pepsi_shop",
  name: "Pepsi Pizza Co.",
  phone: "+14155559999",
  address: "San Francisco, CA",
  lat: 37.775,
  lng: -122.42,
  deliveryRadius: 10,
  estimatedDeliveryMinutes: 35,
  acceptsCash: true,
  serviceType: "delivery",
  menu: {
    pizzas: [
      { name: "Pepperoni", sizes: [{ name: 'Large 14"', price: 12.99 }] },
    ],
    sides: [{ name: "Wings", sizes: [{ name: "Regular", price: 7.99 }] }],
    drinks: [
      {
        id: "pepsi_20oz",
        name: "Pepsi",
        brand: "Pepsi",
        sizes: [{ id: "20oz", name: "20oz Bottle", price: 2.49 }],
      },
    ],
  },
  hours: "11:00 AM - 11:00 PM",
  isTest: true,
};

const DOMINOS_REAL: Restaurant = {
  ...DOMINOS_LATLNG_ZERO,
  id: "dominos_real",
  lat: 37.775,
  lng: -122.418,
  deliveryRadius: 5,
  menu: {
    pizzas: [{ name: "Pepperoni", sizes: [{ name: "Large", price: 13.99 }] }],
    sides: [{ name: "Wings", sizes: [{ name: "Regular", price: 8.99 }] }],
    drinks: [
      {
        id: "pepsi_real",
        name: "Pepsi",
        brand: "Pepsi",
        sizes: [
          { id: "20oz", name: "20oz", price: 2.49 },
          { id: "2l", name: "2L", price: 3.99 },
        ],
      },
    ],
  },
};

// S-22 test 1: side-only intent on real menu → available
test("S22-1: checkSideAvailability — test_vlad + 'wings' → available (real menu match)", () => {
  const r = checkSideAvailability(VLAD_WITH_DRINKS, { name: "wings" });
  assert.strictEqual(r.state, "available");
  assert.ok(r.confidence >= 0.8);
  assert.strictEqual(r.source, "menu_match");
});

// S-22 test 2: drink-only intent on real menu → available
test("S22-2: checkDrinkAvailability — test_vlad + Coke → available via portfolio match", () => {
  const r = checkDrinkAvailability(VLAD_WITH_DRINKS, { name: "Coke" });
  assert.strictEqual(r.state, "available");
  assert.ok(r.confidence >= 0.8);
  assert.strictEqual(r.source, "menu_match");
});

// S-22 test 3: drink with brand mismatch → requires_substitution
// Uses PEPSI_ONLY_SHOP: exact name "Pepsi" matches the drink, but the caller
// asks for brand "Coca-Cola" → name found, brand wrong → requires_substitution.
test("S22-3: checkDrinkAvailability — Pepsi shop has Pepsi; ask for Pepsi brand=Coca-Cola → requires_substitution", () => {
  const r = checkDrinkAvailability(PEPSI_ONLY_SHOP, {
    name: "Pepsi",
    brand: "Coca-Cola",
  });
  assert.strictEqual(r.state, "requires_substitution");
  assert.ok(r.confidence >= 0.7);
});

// S-22 test 4: drink with size mismatch → requires_substitution
test("S22-4: checkDrinkAvailability — test_vlad has 20oz+2L Coke; ask for gallon → requires_substitution", () => {
  const r = checkDrinkAvailability(VLAD_WITH_DRINKS, {
    name: "Coke",
    size: "gallon",
  });
  assert.strictEqual(r.state, "requires_substitution");
});

// S-22 test 5: multi-dimension rollup: one matched + one unknown → rollup is unknown
test("S22-5: assessCompatibility — pizza available + unknown drink → item rollup is unknown", () => {
  const r = assessCompatibility(
    VLAD_WITH_DRINKS,
    USER_NEAR_LAT,
    USER_NEAR_LNG,
    {
      pizza: { style: "Pepperoni" },
      drinks: [{ name: "XYZ NonExistent" }],
    },
  );
  // overall may be caution or no_go, item rollup is worst-evidence
  assert.notStrictEqual(r.item.state, "available");
  // pizza is available but XYZ is not_available (real menu miss) → rollup is not_available
  assert.strictEqual(r.item.state, "not_available");
  // item_map has pizza slot available
  assert.strictEqual(r.item_map["pizza"]?.state, "available");
});

// S-22 test 6: multi-dimension rollup with one not_available → rollup is not_available
test("S22-6: assessCompatibility — pizza+side available + drink not_available → rollup not_available", () => {
  const r = assessCompatibility(
    VLAD_WITH_DRINKS,
    USER_NEAR_LAT,
    USER_NEAR_LNG,
    {
      pizza: { style: "Pepperoni" },
      sides: [{ name: "Wings" }],
      drinks: [{ name: "Mountain Dew" }], // not on test_vlad
    },
  );
  assert.strictEqual(r.item.state, "not_available");
  assert.strictEqual(r.overall, "no_go");
});

// S-22 test 7: brand-aware ranking — Coca-Cola shop ranked above Pepsi-only shop for Coke intent
test("S22-7: brand-aware ranking — Coca-Cola shop has higher qualityScore than Pepsi shop for Coke ask", () => {
  const intentCoke = { drinks: [{ name: "Coke" }] };
  const cokeShop = assessCompatibility(
    VLAD_WITH_DRINKS,
    USER_NEAR_LAT,
    USER_NEAR_LNG,
    intentCoke,
  );
  const pepsiShop = assessCompatibility(
    PEPSI_ONLY_SHOP,
    USER_NEAR_LAT,
    USER_NEAR_LNG,
    intentCoke,
  );
  // Coke/Coca-Cola shop should get higher qualityScore for Coke intent
  assert.ok(
    cokeShop.qualityScore > pepsiShop.qualityScore,
    `Expected coca-cola shop qualityScore ${cokeShop.qualityScore} > pepsi shop ${pepsiShop.qualityScore}`,
  );
  // Coca-Cola shop should match (available), Pepsi-only shop should not_available
  assert.strictEqual(cokeShop.item.state, "available");
  assert.strictEqual(pepsiShop.item.state, "not_available");
});

// S-22 test 8: brand-aware ranking — Pepsi shop ranked above Coca-Cola shop for Pepsi intent
test("S22-8: brand-aware ranking — Pepsi shop has higher qualityScore than Coca-Cola shop for Pepsi ask", () => {
  const intentPepsi = { drinks: [{ name: "Pepsi" }] };
  const cokeShop = assessCompatibility(
    VLAD_WITH_DRINKS,
    USER_NEAR_LAT,
    USER_NEAR_LNG,
    intentPepsi,
  );
  const pepsiShop = assessCompatibility(
    PEPSI_ONLY_SHOP,
    USER_NEAR_LAT,
    USER_NEAR_LNG,
    intentPepsi,
  );
  // Pepsi-only shop should match; Coca-Cola shop should not have Pepsi
  assert.strictEqual(pepsiShop.item.state, "available");
  assert.strictEqual(cokeShop.item.state, "not_available");
  assert.ok(pepsiShop.qualityScore > cokeShop.qualityScore);
});

// S-22 test 9: places_generic per-slot returns state='unknown', source='places_generic_menu' for side
test("S22-9: checkSideAvailability — places_generic + 'wings' → state=unknown, source=places_generic_menu", () => {
  const r = checkSideAvailability(PLACES, { name: "wings" });
  assert.strictEqual(r.state, "unknown");
  assert.strictEqual(r.source, "places_generic_menu");
  assert.ok(r.confidence <= 0.5);
});

// S-22 test 10: places_generic per-slot returns state='unknown' for drink intent
test("S22-10: checkDrinkAvailability — places_generic + 'Coke' → state=unknown, source=places_generic_menu", () => {
  // PLACES has no drinks array but isPlacesGeneric is true → unknown
  const placesWithCoke: Restaurant = {
    ...PLACES,
    menu: {
      ...PLACES.menu,
      drinks: [
        {
          id: "coke_fake",
          name: "Coca-Cola",
          brand: "Coca-Cola",
          sizes: [{ id: "20oz", name: "20oz", price: 2.5 }],
        },
      ],
    },
  };
  const r = checkDrinkAvailability(placesWithCoke, { name: "Coke" });
  assert.strictEqual(r.state, "unknown");
  assert.strictEqual(r.source, "places_generic_menu");
});

// S-22 test 11: qualityScore formula — delivery 0.95, coverage 0.9, all available → 0.95
test("S22-11: qualityScore — delivery 0.95 + coverage 0.9 + items all available → qualityScore=0.95", () => {
  const r = assessCompatibility(
    VLAD_WITH_DRINKS,
    USER_NEAR_LAT,
    USER_NEAR_LNG,
    {
      pizza: { style: "Pepperoni" },
    },
  );
  // delivery confidence=0.95, coverage confidence=0.9, pizza available perItem=1.0
  // qualityScore = 0.4*0.95 + 0.3*0.9 + 0.3*1.0 = 0.38 + 0.27 + 0.30 = 0.95
  assert.ok(
    Math.abs(r.qualityScore - 0.95) < 0.001,
    `Expected qualityScore ≈ 0.95, got ${r.qualityScore}`,
  );
});

// S-22 test 12: qualityScore — drink not_available with pizza available → ~0.80
test("S22-12: qualityScore — pizza available + drink not_available → qualityScore≈0.80", () => {
  const r = assessCompatibility(
    VLAD_WITH_DRINKS,
    USER_NEAR_LAT,
    USER_NEAR_LNG,
    {
      pizza: { style: "Pepperoni" },
      drinks: [{ name: "XYZ NonExistentBeverage" }],
    },
  );
  // perItem = (1.0 + 0.0) / 2 = 0.5
  // qualityScore = 0.4*0.95 + 0.3*0.9 + 0.3*0.5 = 0.38 + 0.27 + 0.15 = 0.80
  assert.ok(
    Math.abs(r.qualityScore - 0.8) < 0.001,
    `Expected qualityScore ≈ 0.80, got ${r.qualityScore}`,
  );
});

// S-22 test 13: priceKnownCount tiebreaker — higher count → ranked first after sort
test("S22-13: priceKnownCount tiebreaker — restaurant with count=3 ranks above count=1 when qualityScore equal", () => {
  // VLAD_WITH_DRINKS has: pizza price=12.99 (>0), side price=8.99, drink price=2.49 → count=3
  const richIntent = {
    pizza: { style: "Pepperoni" },
    sides: [{ name: "Wings" }],
    drinks: [{ name: "Coke" }],
  };
  const vladResult = assessCompatibility(
    VLAD_WITH_DRINKS,
    USER_NEAR_LAT,
    USER_NEAR_LNG,
    richIntent,
  );
  // Create a version of VLAD with zero-price side and drink → priceKnownCount=1
  const zeropriceSide: Restaurant = {
    ...VLAD_WITH_DRINKS,
    id: "test_zeroprice",
    menu: {
      ...VLAD_WITH_DRINKS.menu,
      sides: [{ name: "Wings (8pc)", sizes: [{ name: "Regular", price: 0 }] }],
      drinks: [
        {
          id: "coke_free",
          name: "Coca-Cola",
          brand: "Coca-Cola",
          sizes: [{ id: "20oz", name: "20oz Bottle", price: 0 }],
        },
      ],
    },
  };
  const leanResult = assessCompatibility(
    zeropriceSide,
    USER_NEAR_LAT,
    USER_NEAR_LNG,
    richIntent,
  );
  assert.ok(
    vladResult.priceKnownCount > leanResult.priceKnownCount,
    `vlad priceKnownCount=${vladResult.priceKnownCount} should exceed lean=${leanResult.priceKnownCount}`,
  );
  // Both have same qualityScore (all items available, same delivery/coverage)
  assert.ok(
    Math.abs(vladResult.qualityScore - leanResult.qualityScore) < 0.001,
    `Expected same qualityScore: vlad=${vladResult.qualityScore}, lean=${leanResult.qualityScore}`,
  );
  // Sort verification: higher priceKnownCount comes first when qualityScore tied
  const VERDICT_ORDER: Record<string, number> = { go: 0, caution: 1, no_go: 2 };
  const sorted = [
    { id: "lean", r: leanResult },
    { id: "vlad", r: vladResult },
  ].sort((a, b) => {
    return (
      VERDICT_ORDER[a.r.overall] - VERDICT_ORDER[b.r.overall] ||
      b.r.qualityScore - a.r.qualityScore ||
      b.r.priceKnownCount - a.r.priceKnownCount
    );
  });
  assert.strictEqual(sorted[0].id, "vlad");
});

// S-22 test 14: back-compat — legacy string intent_style produces item_map with pizza key
test("S22-14: back-compat — assessCompatibility with legacy string intent_style has item_map.pizza", () => {
  const r = assessCompatibility(
    VLAD_WITH_DRINKS,
    USER_NEAR_LAT,
    USER_NEAR_LNG,
    "meat_lovers",
  );
  assert.ok("item_map" in r, "assessment must have item_map");
  assert.ok(
    "pizza" in r.item_map,
    "item_map must have pizza key for string intent",
  );
  assert.strictEqual(r.item_map["pizza"].state, "available");
  assert.strictEqual(r.overall, "go");
});

// S-22 test 15: empty intent_items → item state=unknown, item_map={}
test("S22-15: empty intent_items {} → item.state=unknown, item_map={}", () => {
  const r = assessCompatibility(
    VLAD_WITH_DRINKS,
    USER_NEAR_LAT,
    USER_NEAR_LNG,
    {},
  );
  assert.strictEqual(r.item.state, "unknown");
  assert.ok(r.item.confidence <= 0.5);
  assert.strictEqual(r.item.source, "none");
  assert.deepStrictEqual(r.item_map, {});
});

// S-22 test 16: drinks [matched, not_available] → rollup not_available
test("S22-16: intent_items.drinks=[matched, not_available] → rollup not_available", () => {
  const r = assessCompatibility(
    VLAD_WITH_DRINKS,
    USER_NEAR_LAT,
    USER_NEAR_LNG,
    {
      drinks: [
        { name: "Coke" }, // available via portfolio
        { name: "OrangeFizz999" }, // not on menu → not_available
      ],
    },
  );
  // Rollup picks worst: not_available wins over available
  assert.strictEqual(r.item.state, "not_available");
  assert.strictEqual(r.overall, "no_go");
});

// S-22 test 17: PIZZA_CUISINE_DEFAULTS on places_generic → slot stays unknown, not available
test("S22-17: places_generic with Coca-Cola in menu still returns unknown for drink slot (places_generic_menu overrides)", () => {
  // Even if the restaurant object has a Coke entry, isPlacesGeneric = true → unknown
  const placesGenericWithCoke: Restaurant = {
    ...PLACES,
    menu: {
      ...PLACES.menu,
      drinks: [
        {
          id: "coke_generic",
          name: "Coke",
          brand: "Coca-Cola",
          sizes: [{ id: "20oz", name: "20oz", price: 2.5 }],
        },
      ],
    },
  };
  const r = checkDrinkAvailability(placesGenericWithCoke, {
    name: "Coke",
    brand: "Coca-Cola",
  });
  // isPlacesGeneric fires first — generic template menu, not real evidence
  assert.strictEqual(r.state, "unknown");
  assert.strictEqual(r.source, "places_generic_menu");
  assert.notStrictEqual(r.state, "available");
});

// S-22 test 18: priceKnownCount — pizza with price=0 does NOT increment counter
test("S22-18: priceKnownCount — real menu pizza with price=0 does NOT count", () => {
  const zeroPizzaRestaurant: Restaurant = {
    ...VLAD,
    id: "test_zero_pizza",
    menu: {
      pizzas: [{ name: "Pepperoni", sizes: [{ name: "Large", price: 0 }] }],
      sides: [],
    },
  };
  const r = assessCompatibility(
    zeroPizzaRestaurant,
    USER_NEAR_LAT,
    USER_NEAR_LNG,
    {
      pizza: { style: "Pepperoni" },
    },
  );
  assert.strictEqual(
    r.priceKnownCount,
    0,
    "price=0 should NOT increment priceKnownCount",
  );
});
