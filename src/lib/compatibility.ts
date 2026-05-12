/**
 * Compatibility layer — three pre-call checks plus a combined verdict.
 *
 * Answers: can this restaurant deliver, can it deliver to the user, does it
 * carry what the user wants? Each check returns state + confidence + source +
 * reason + nextStep. The combiner produces an overall verdict
 * (`go` / `caution` / `no_go`) used by `start_pizza_order` to sort and by
 * `place_order` to block.
 *
 * Sources of truth: PRD.md (AC1–A12) and PRD-V2-DELTA.md (C-1, C-2, M-3, M-7).
 * Logging contract: COMPATIBILITY-MODEL.md ("Logging contract" section).
 *
 * SP-20260512-002 extension:
 *   - `checkItemAvailability` accepts an `intent_items` shape (pizza+sides+drinks)
 *     and returns a per-slot evidence map. The legacy `(restaurant, intentStyle)`
 *     signature is preserved as a thin wrapper for one cycle.
 *   - `assessCompatibility` emits `item_map`, `qualityScore`, and
 *     `priceKnownCount` alongside the legacy `item` rollup + `overall` verdict.
 *   - Sort by (verdict, qualityScore, priceKnownCount) — verdict remains the
 *     gate, qualityScore orders within tier, priceKnownCount tiebreaks.
 */

import type { Restaurant } from "../data/restaurants.js";
import type { Drink } from "./cart.js";
import { brandToPortfolio } from "./brand-portfolios.js";
import { logCompatibilityEvent } from "./event-log.js";

export type DeliveryAvailabilityState =
  | "available"
  | "pickup_only"
  | "third_party_only"
  | "unknown"
  | "no";

export type DeliveryCoverageState =
  | "in_range"
  | "out_of_range"
  | "unknown"
  | "requires_address";

export type ItemAvailabilityState =
  | "available"
  | "likely_available"
  | "not_available"
  | "unknown"
  | "requires_substitution";

export type OverallVerdict = "go" | "caution" | "no_go";

export interface CompatibilityCheckResult<S extends string> {
  state: S;
  confidence: number;
  source: string;
  reason: string;
  nextStep: string | null;
}

/**
 * Multi-dimensional intent — the user's pizza+sides+drinks ask in one
 * structured shape. All top-level keys optional; an empty object behaves
 * like `undefined` (no intent).
 */
export interface IntentItems {
  pizza?: { style: string; size?: string };
  sides?: { name: string }[];
  drinks?: { name: string; brand?: string; size?: string }[];
}

/**
 * Slot key in `item_map`. Stable, human-readable, lowercased:
 *   "pizza" | "side:<name>" | "drink:<name>[:<brand>][:<size>]"
 */
export type SlotKey = string;

export interface CompatibilityAssessment {
  delivery: CompatibilityCheckResult<DeliveryAvailabilityState>;
  coverage: CompatibilityCheckResult<DeliveryCoverageState>;
  /** Rollup of `item_map` — worst-evidence wins. */
  item: CompatibilityCheckResult<ItemAvailabilityState>;
  overall: OverallVerdict;
  nextStep: string | null;
  /** Per-slot evidence map — keyed by `SlotKey`. Empty when no intent_items. */
  item_map: Record<SlotKey, CompatibilityCheckResult<ItemAvailabilityState>>;
  /** Quality score ∈ [0,1]. See DD-2 (sprint SP-20260512-002). */
  qualityScore: number;
  /** Count of cart-eligible items with high-confidence pricing. Tiebreaker. */
  priceKnownCount: number;
}

const NO_GO_DELIVERY = new Set<DeliveryAvailabilityState>([
  "pickup_only",
  "third_party_only",
  "no",
]);
const NO_GO_COVERAGE = new Set<DeliveryCoverageState>(["out_of_range"]);
const NO_GO_ITEM = new Set<ItemAvailabilityState>(["not_available"]);

const CAUTION_DELIVERY = new Set<DeliveryAvailabilityState>(["unknown"]);
const CAUTION_COVERAGE = new Set<DeliveryCoverageState>([
  "unknown",
  "requires_address",
]);
const CAUTION_ITEM = new Set<ItemAvailabilityState>([
  "unknown",
  "likely_available",
  "requires_substitution",
]);

function sourceTagFor(restaurantId: string): string {
  if (restaurantId.startsWith("dominos_")) return "dominos_api";
  if (restaurantId.startsWith("places_")) return "places_api";
  if (restaurantId.startsWith("test_")) return "test_fixture";
  return "restaurant.fields";
}

function normalize(s: string): string {
  // Underscores become spaces so the snake_case intent_style format the
  // server schema documents (e.g. "meat_lovers") matches menu names like
  // "Meat Lovers". Without this, fuzzy match silently returns not_available.
  return s.toLowerCase().trim().replace(/_+/g, " ");
}

// Haversine distance in miles. Inlined to avoid a dependency on places.ts.
function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isPlacesGeneric(restaurant: Restaurant): boolean {
  return (
    restaurant.id.startsWith("places_") &&
    restaurant.menuSource !== "restaurant_website"
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Check 1 — Delivery Availability
// ────────────────────────────────────────────────────────────────────────────

export function checkDeliveryAvailability(
  restaurant: Restaurant,
): CompatibilityCheckResult<DeliveryAvailabilityState> {
  const src = sourceTagFor(restaurant.id);
  switch (restaurant.serviceType) {
    case "delivery":
      return {
        state: "available",
        confidence: 0.95,
        source:
          src === "test_fixture"
            ? "test_fixture"
            : restaurant.serviceType
              ? "restaurant.fields"
              : src,
        reason: `${restaurant.name} reports delivery service.`,
        nextStep: null,
      };
    case "pickup_only":
      return {
        state: "pickup_only",
        confidence: 0.95,
        source: "restaurant.fields",
        reason: `${restaurant.name} is pickup-only — no delivery offered.`,
        nextStep: "Offer pickup, or pick a different restaurant.",
      };
    case "third_party_only":
      return {
        state: "third_party_only",
        confidence: 0.95,
        source: "restaurant.fields",
        reason: `${restaurant.name} only delivers via third-party services.`,
        nextStep:
          "Order via the restaurant's third-party app, or pick a different restaurant.",
      };
    case "unknown":
    case undefined:
    default:
      return {
        state: "unknown",
        confidence: 0.4,
        source: src,
        reason: `${restaurant.name} did not report delivery capability — source ${src} doesn't expose it.`,
        nextStep: "Ask user about pickup, or call to confirm.",
      };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Check 2 — Delivery Coverage
// ────────────────────────────────────────────────────────────────────────────

export function checkDeliveryCoverage(
  restaurant: Restaurant,
  userLat: number | undefined,
  userLng: number | undefined,
): CompatibilityCheckResult<DeliveryCoverageState> {
  if (userLat === undefined || userLng === undefined) {
    return {
      state: "requires_address",
      confidence: 0.3,
      source: "none",
      reason: "No user latitude/longitude provided.",
      nextStep: "Confirm user delivery address.",
    };
  }

  // C-1 (PRD-V2-DELTA): Domino's locator API does not expose coordinates,
  // so dominos.ts hardcodes lat=0/lng=0. Detect that explicitly and emit
  // unknown — never an out_of_range computed against (0,0).
  if (
    restaurant.id.startsWith("dominos_") &&
    restaurant.lat === 0 &&
    restaurant.lng === 0
  ) {
    return {
      state: "unknown",
      confidence: 0.4,
      source: "dominos_api_coords_missing",
      reason:
        "Domino's API did not return store coordinates — cannot compute distance.",
      nextStep:
        "Confirm coverage on call (Domino's API didn't return store coordinates).",
    };
  }

  // C-2 (PRD-V2-DELTA): single rule for null radius. The id-prefix branch
  // is dead code once places.ts emits null, but the source tag still tracks
  // origin for diagnostics.
  if (restaurant.deliveryRadius == null) {
    return {
      state: "unknown",
      confidence: 0.4,
      source: sourceTagFor(restaurant.id),
      reason:
        "Delivery radius not reported by source — cannot determine coverage.",
      nextStep: "Confirm coverage on call.",
    };
  }

  const distance = haversineMiles(
    userLat,
    userLng,
    restaurant.lat,
    restaurant.lng,
  );
  const within = distance <= restaurant.deliveryRadius;
  const src = sourceTagFor(restaurant.id);

  return {
    state: within ? "in_range" : "out_of_range",
    confidence: 0.9,
    source: src,
    reason: within
      ? `${distance.toFixed(1)} mi <= ${restaurant.deliveryRadius} mi radius.`
      : `${distance.toFixed(1)} mi > ${restaurant.deliveryRadius} mi radius.`,
    nextStep: within ? null : "Find a closer restaurant.",
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Per-item match helpers — pizza, side, drink
// ────────────────────────────────────────────────────────────────────────────

function findPizzaMatch(
  restaurant: Restaurant,
  intentStyle: string,
): { exact: boolean; matched: string } | null {
  const target = normalize(intentStyle);
  const exact = restaurant.menu.pizzas.find(
    (p) => normalize(p.name) === target,
  );
  if (exact) return { exact: true, matched: exact.name };
  const fuzzy = restaurant.menu.pizzas.find((p) => {
    const n = normalize(p.name);
    return n.includes(target) || target.includes(n);
  });
  if (fuzzy) return { exact: false, matched: fuzzy.name };
  return null;
}

/**
 * Find a side on the restaurant's real menu by case-insensitive
 * substring/fuzzy match. Mirrors `findPizzaMatch` for sides.
 */
export function findSideMatch(
  restaurant: Restaurant,
  sideName: string,
): { exact: boolean; matched: string } | null {
  const target = normalize(sideName);
  if (!target) return null;
  const exact = restaurant.menu.sides.find((s) => normalize(s.name) === target);
  if (exact) return { exact: true, matched: exact.name };
  const fuzzy = restaurant.menu.sides.find((s) => {
    const n = normalize(s.name);
    return n.includes(target) || target.includes(n);
  });
  if (fuzzy) return { exact: false, matched: fuzzy.name };
  return null;
}

/**
 * Find a drink on the restaurant's real menu. Name-first, brand-secondary,
 * size-tertiary. Returns the matched Drink plus exactness flags.
 *
 * `exact: true` means name and (when specified) brand and size all matched
 * cleanly. `exact: false` means a softer match (fuzzy name, brand mismatch,
 * or size mismatch); callers may downgrade availability accordingly.
 */
export function findDrinkMatch(
  restaurant: Restaurant,
  query: { name: string; brand?: string; size?: string },
): {
  exact: boolean;
  matched: Drink;
  brandMatched: boolean;
  sizeMatched: boolean;
} | null {
  const drinks = restaurant.menu.drinks ?? [];
  if (drinks.length === 0) return null;
  const targetName = normalize(query.name);
  if (!targetName) return null;

  // 1. Exact-name match wins outright.
  let drink = drinks.find((d) => normalize(d.name) === targetName);

  // 2. Substring fuzzy name match (either direction).
  if (!drink) {
    drink = drinks.find((d) => {
      const n = normalize(d.name);
      return n.includes(targetName) || targetName.includes(n);
    });
  }

  // 3. Brand-portfolio match — handles "Coke" → "Coca-Cola" etc.
  // Use query.brand if provided, else the name itself as a brand hint.
  if (!drink) {
    const queryPortfolio = brandToPortfolio(query.brand ?? query.name);
    if (queryPortfolio !== "unknown") {
      drink = drinks.find((d) => brandToPortfolio(d.brand) === queryPortfolio);
    }
  }

  if (!drink) return null;

  const exactName = normalize(drink.name) === targetName;
  const brandMatched = query.brand
    ? brandToPortfolio(drink.brand) === brandToPortfolio(query.brand)
    : true;
  const sizeMatched = query.size
    ? drink.sizes.some((s) =>
        s.name.toLowerCase().includes(query.size!.toLowerCase()),
      )
    : true;

  return {
    exact: exactName && brandMatched && sizeMatched,
    matched: drink,
    brandMatched,
    sizeMatched,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Check 3 — Item Availability (pizza, side, drink)
// ────────────────────────────────────────────────────────────────────────────

function buildPizzaCheck(
  restaurant: Restaurant,
  intentStyle: string,
): CompatibilityCheckResult<ItemAvailabilityState> {
  if (isPlacesGeneric(restaurant)) {
    const match = findPizzaMatch(restaurant, intentStyle);
    return {
      state: "unknown",
      confidence: 0.4,
      source: "places_generic_menu",
      reason: match
        ? `Generic Places menu template matched "${match.matched}" — not real evidence; real menu unknown.`
        : `"${intentStyle}" not in generic 3-item template; real menu unknown.`,
      nextStep: `Run menu discovery, or confirm on call: 'Do you carry ${intentStyle}?'`,
    };
  }

  const match = findPizzaMatch(restaurant, intentStyle);
  if (match) {
    return {
      state: "available",
      confidence: match.exact ? 0.95 : 0.8,
      source: "menu_match",
      reason: match.exact
        ? `${match.matched} is on ${restaurant.name}'s menu.`
        : `Fuzzy match: "${intentStyle}" → ${match.matched}.`,
      nextStep: null,
    };
  }
  return {
    state: "not_available",
    confidence: 0.85,
    source: "menu_match",
    reason: `${restaurant.name} does not carry "${intentStyle}".`,
    nextStep: "Suggest a substitute or alternative restaurant.",
  };
}

/**
 * Per-side availability check. Mirrors the pizza pattern:
 * `places_generic` template → `unknown`/low; real-menu match → `available`/high;
 * real-menu no-match → `not_available`/high.
 */
export function checkSideAvailability(
  restaurant: Restaurant,
  query: { name: string },
): CompatibilityCheckResult<ItemAvailabilityState> {
  if (!query.name || !query.name.trim()) {
    return {
      state: "unknown",
      confidence: 0.5,
      source: "none",
      reason: "No side name provided.",
      nextStep: "Ask user what they want.",
    };
  }
  if (isPlacesGeneric(restaurant)) {
    return {
      state: "unknown",
      confidence: 0.4,
      source: "places_generic_menu",
      reason: `Generic Places template — real side menu unknown for "${query.name}".`,
      nextStep: `Confirm on call: 'Do you carry ${query.name}?'`,
    };
  }
  const match = findSideMatch(restaurant, query.name);
  if (match) {
    return {
      state: "available",
      confidence: match.exact ? 0.95 : 0.8,
      source: "menu_match",
      reason: match.exact
        ? `${match.matched} is on ${restaurant.name}'s menu.`
        : `Fuzzy match: "${query.name}" → ${match.matched}.`,
      nextStep: null,
    };
  }
  return {
    state: "not_available",
    confidence: 0.85,
    source: "menu_match",
    reason: `${restaurant.name} does not carry side "${query.name}".`,
    nextStep: "Suggest a substitute or alternative restaurant.",
  };
}

/**
 * Per-drink availability check. Drink matching is name-first, brand-secondary,
 * size-tertiary. Brand mismatch on an otherwise-matched name downgrades to
 * `requires_substitution`.
 */
export function checkDrinkAvailability(
  restaurant: Restaurant,
  query: { name: string; brand?: string; size?: string },
): CompatibilityCheckResult<ItemAvailabilityState> {
  if (!query.name || !query.name.trim()) {
    return {
      state: "unknown",
      confidence: 0.5,
      source: "none",
      reason: "No drink name provided.",
      nextStep: "Ask user what they want.",
    };
  }
  if (isPlacesGeneric(restaurant)) {
    return {
      state: "unknown",
      confidence: 0.4,
      source: "places_generic_menu",
      reason: `Generic Places template — real drink menu unknown for "${query.name}".`,
      nextStep: `Confirm on call: 'Do you carry ${query.name}?'`,
    };
  }
  const match = findDrinkMatch(restaurant, query);
  if (!match) {
    return {
      state: "not_available",
      confidence: 0.85,
      source: "menu_match",
      reason: `${restaurant.name} does not carry "${query.name}"${query.brand ? ` (${query.brand})` : ""}.`,
      nextStep: "Suggest a substitute or alternative restaurant.",
    };
  }
  // Name matched. Brand or size mismatch → requires_substitution.
  if (!match.brandMatched) {
    return {
      state: "requires_substitution",
      confidence: 0.8,
      source: "menu_match",
      reason: `${restaurant.name} carries "${match.matched.name}" but at a different brand than requested (${query.brand}).`,
      nextStep: `Confirm on call whether ${query.brand} or the alternate brand is acceptable.`,
    };
  }
  if (!match.sizeMatched) {
    return {
      state: "requires_substitution",
      confidence: 0.85,
      source: "menu_match",
      reason: `${restaurant.name} carries "${match.matched.name}" but not in requested size "${query.size}".`,
      nextStep: `Confirm on call whether a different size is acceptable.`,
    };
  }
  return {
    state: "available",
    confidence: match.exact ? 0.95 : 0.8,
    source: "menu_match",
    reason: match.exact
      ? `${match.matched.name} is on ${restaurant.name}'s menu.`
      : `Match: "${query.name}" → ${match.matched.name}.`,
    nextStep: null,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Slot keys + rollup
// ────────────────────────────────────────────────────────────────────────────

function slotKeyForSide(name: string): SlotKey {
  return `side:${name.toLowerCase().trim()}`;
}

function slotKeyForDrink(d: {
  name: string;
  brand?: string;
  size?: string;
}): SlotKey {
  const parts = ["drink", d.name.toLowerCase().trim()];
  if (d.brand) parts.push(d.brand.toLowerCase().trim());
  if (d.size) parts.push(d.size.toLowerCase().trim());
  return parts.join(":");
}

const ITEM_STATE_PRIORITY: Record<ItemAvailabilityState, number> = {
  not_available: 0,
  unknown: 1,
  requires_substitution: 2,
  likely_available: 3,
  available: 4,
};

/**
 * Rollup `item_map` to a single `CompatibilityCheckResult` — worst-evidence
 * wins. Picks the lowest-priority state across slots; ties broken by lowest
 * confidence. Used to drive the legacy `assessment.item` rollup that
 * existing consumers + verdict logic depend on.
 */
function rollupItemMap(
  itemMap: Record<SlotKey, CompatibilityCheckResult<ItemAvailabilityState>>,
): CompatibilityCheckResult<ItemAvailabilityState> {
  const entries = Object.values(itemMap);
  if (entries.length === 0) {
    return {
      state: "unknown",
      confidence: 0.5,
      source: "none",
      reason: "No intent provided.",
      nextStep: "Ask user what they want.",
    };
  }
  // Sort by ascending state priority; tiebreak by ascending confidence.
  const sorted = [...entries].sort((a, b) => {
    const pa = ITEM_STATE_PRIORITY[a.state];
    const pb = ITEM_STATE_PRIORITY[b.state];
    if (pa !== pb) return pa - pb;
    return a.confidence - b.confidence;
  });
  return sorted[0];
}

// ────────────────────────────────────────────────────────────────────────────
// checkItemAvailability — overloaded
//
// Legacy:  (restaurant, intentStyle: string | undefined) → CheckResult (rollup)
// Modern:  (restaurant, intent_items: IntentItems)       → { item, item_map }
// ────────────────────────────────────────────────────────────────────────────

export interface ItemAvailabilityBundle {
  /** Worst-evidence rollup across all slots. */
  item: CompatibilityCheckResult<ItemAvailabilityState>;
  /** Per-slot evidence map. */
  item_map: Record<SlotKey, CompatibilityCheckResult<ItemAvailabilityState>>;
}

export function checkItemAvailability(
  restaurant: Restaurant,
  intent: string | undefined,
): CompatibilityCheckResult<ItemAvailabilityState>;
export function checkItemAvailability(
  restaurant: Restaurant,
  intent: IntentItems,
): ItemAvailabilityBundle;
export function checkItemAvailability(
  restaurant: Restaurant,
  intent: string | IntentItems | undefined,
): CompatibilityCheckResult<ItemAvailabilityState> | ItemAvailabilityBundle {
  // Legacy path — string or undefined. Preserves the prior return shape so
  // existing callers and tests keep working unchanged.
  if (typeof intent === "string" || intent === undefined) {
    return legacyCheckItemAvailability(restaurant, intent);
  }
  // Modern path — IntentItems shape.
  return computeItemMap(restaurant, intent);
}

function legacyCheckItemAvailability(
  restaurant: Restaurant,
  intentStyle: string | undefined,
): CompatibilityCheckResult<ItemAvailabilityState> {
  if (!intentStyle || !intentStyle.trim()) {
    return {
      state: "unknown",
      confidence: 0.5,
      source: "none",
      reason: "No intent_style provided.",
      nextStep: "Ask user what they want.",
    };
  }
  return buildPizzaCheck(restaurant, intentStyle);
}

function computeItemMap(
  restaurant: Restaurant,
  intent: IntentItems,
): ItemAvailabilityBundle {
  const item_map: Record<
    SlotKey,
    CompatibilityCheckResult<ItemAvailabilityState>
  > = {};

  if (intent.pizza?.style && intent.pizza.style.trim()) {
    item_map["pizza"] = buildPizzaCheck(restaurant, intent.pizza.style);
  }
  for (const side of intent.sides ?? []) {
    if (!side.name?.trim()) continue;
    item_map[slotKeyForSide(side.name)] = checkSideAvailability(
      restaurant,
      side,
    );
  }
  for (const drink of intent.drinks ?? []) {
    if (!drink.name?.trim()) continue;
    item_map[slotKeyForDrink(drink)] = checkDrinkAvailability(
      restaurant,
      drink,
    );
  }

  const item = rollupItemMap(item_map);
  return { item, item_map };
}

// ────────────────────────────────────────────────────────────────────────────
// Quality score + priceKnownCount
// ────────────────────────────────────────────────────────────────────────────

const PER_ITEM_SCORE: Record<ItemAvailabilityState, number> = {
  available: 1.0,
  likely_available: 0.7,
  requires_substitution: 0.5,
  unknown: 0.3,
  not_available: 0.0,
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function computeQualityScore(
  delivery: CompatibilityCheckResult<DeliveryAvailabilityState>,
  coverage: CompatibilityCheckResult<DeliveryCoverageState>,
  item_map: Record<SlotKey, CompatibilityCheckResult<ItemAvailabilityState>>,
  itemFallback: CompatibilityCheckResult<ItemAvailabilityState>,
): number {
  const slotResults = Object.values(item_map);
  // When item_map is empty (legacy string path or no intent), fall back to
  // the rollup `item` so the score stays comparable across paths.
  const effective = slotResults.length > 0 ? slotResults : [itemFallback];
  const perItem =
    effective.reduce((sum, r) => sum + (PER_ITEM_SCORE[r.state] ?? 0), 0) /
    effective.length;
  const raw =
    0.4 * delivery.confidence + 0.3 * coverage.confidence + 0.3 * perItem;
  return clamp01(raw);
}

function priceForPizzaMatch(
  restaurant: Restaurant,
  intentStyle: string,
): number {
  const target = normalize(intentStyle);
  const pizza =
    restaurant.menu.pizzas.find((p) => normalize(p.name) === target) ??
    restaurant.menu.pizzas.find((p) => {
      const n = normalize(p.name);
      return n.includes(target) || target.includes(n);
    });
  if (!pizza) return 0;
  return pizza.sizes[0]?.price ?? 0;
}

function priceForSideMatch(restaurant: Restaurant, sideName: string): number {
  const target = normalize(sideName);
  const side =
    restaurant.menu.sides.find((s) => normalize(s.name) === target) ??
    restaurant.menu.sides.find((s) => {
      const n = normalize(s.name);
      return n.includes(target) || target.includes(n);
    });
  if (!side) return 0;
  return side.sizes[0]?.price ?? 0;
}

function priceForDrinkMatch(
  restaurant: Restaurant,
  query: { name: string; brand?: string; size?: string },
): number {
  const match = findDrinkMatch(restaurant, query);
  if (!match) return 0;
  return match.matched.sizes[0]?.price ?? 0;
}

/**
 * Count the number of cart-eligible items where the matched menu line has
 * high-confidence pricing (`price > 0` on a real-menu entry). The
 * `places_generic` source never contributes — its prices, if any, are
 * generic-template noise.
 */
function computePriceKnownCount(
  restaurant: Restaurant,
  intent: IntentItems | undefined,
): number {
  if (!intent || isPlacesGeneric(restaurant)) return 0;
  let count = 0;
  if (intent.pizza?.style?.trim()) {
    if (priceForPizzaMatch(restaurant, intent.pizza.style) > 0) count++;
  }
  for (const side of intent.sides ?? []) {
    if (!side.name?.trim()) continue;
    if (priceForSideMatch(restaurant, side.name) > 0) count++;
  }
  for (const drink of intent.drinks ?? []) {
    if (!drink.name?.trim()) continue;
    if (priceForDrinkMatch(restaurant, drink) > 0) count++;
  }
  return count;
}

// ────────────────────────────────────────────────────────────────────────────
// Combiner
// ────────────────────────────────────────────────────────────────────────────

function isNoGo<S extends string>(
  result: CompatibilityCheckResult<S>,
  bucket: Set<string>,
): boolean {
  return bucket.has(result.state);
}

/**
 * Normalize an intent argument (legacy string or modern IntentItems) into
 * an IntentItems shape for unified processing. Empty/undefined intent
 * returns undefined.
 */
function normalizeIntent(
  intent: string | IntentItems | undefined,
): IntentItems | undefined {
  if (intent === undefined) return undefined;
  if (typeof intent === "string") {
    const trimmed = intent.trim();
    if (!trimmed) return undefined;
    return { pizza: { style: trimmed } };
  }
  // Empty object — no pizza, no sides, no drinks → treat as undefined.
  const hasPizza = !!intent.pizza?.style?.trim();
  const hasSides = (intent.sides ?? []).some((s) => s.name?.trim());
  const hasDrinks = (intent.drinks ?? []).some((d) => d.name?.trim());
  if (!hasPizza && !hasSides && !hasDrinks) return undefined;
  return intent;
}

export function assessCompatibility(
  restaurant: Restaurant,
  userLat: number | undefined,
  userLng: number | undefined,
  intent: string | IntentItems | undefined,
): CompatibilityAssessment {
  const delivery = checkDeliveryAvailability(restaurant);
  const coverage = checkDeliveryCoverage(restaurant, userLat, userLng);

  const normalizedIntent = normalizeIntent(intent);

  let item: CompatibilityCheckResult<ItemAvailabilityState>;
  let item_map: Record<
    SlotKey,
    CompatibilityCheckResult<ItemAvailabilityState>
  >;

  if (!normalizedIntent) {
    item = {
      state: "unknown",
      confidence: 0.5,
      source: "none",
      reason: "No intent provided.",
      nextStep: "Ask user what they want.",
    };
    item_map = {};
  } else {
    const bundle = computeItemMap(restaurant, normalizedIntent);
    item = bundle.item;
    item_map = bundle.item_map;
  }

  const ordered = [
    { check: delivery, noGo: NO_GO_DELIVERY, caution: CAUTION_DELIVERY },
    { check: coverage, noGo: NO_GO_COVERAGE, caution: CAUTION_COVERAGE },
    { check: item, noGo: NO_GO_ITEM, caution: CAUTION_ITEM },
  ] as const;

  const failing = ordered.find((o) => isNoGo(o.check, o.noGo as Set<string>));

  let overall: OverallVerdict;
  let nextStep: string | null;

  if (failing) {
    overall = "no_go";
    nextStep = failing.check.nextStep ?? "Pick a different restaurant.";
  } else {
    const cautionList = ordered.filter((o) =>
      (o.caution as Set<string>).has(o.check.state),
    );
    if (cautionList.length > 0) {
      overall = "caution";
      const lowest = cautionList.reduce((a, b) =>
        a.check.confidence <= b.check.confidence ? a : b,
      );
      nextStep = lowest.check.nextStep;
    } else {
      overall = "go";
      nextStep = null;
    }
  }

  const qualityScore = computeQualityScore(delivery, coverage, item_map, item);
  const priceKnownCount = computePriceKnownCount(restaurant, normalizedIntent);

  const assessment: CompatibilityAssessment = {
    delivery,
    coverage,
    item,
    overall,
    nextStep,
    item_map,
    qualityScore,
    priceKnownCount,
  };

  // Logging — fail-open inside event-log.ts; never break order flow.
  // Legacy field `intent_style` retained for back-compat with prior
  // consumers (test `assert.strictEqual(last.data.overall, "go")` and the
  // dashboard query). New fields are additive.
  const intentStyleLegacy =
    typeof intent === "string"
      ? intent
      : (normalizedIntent?.pizza?.style ?? null);
  logCompatibilityEvent({
    restaurant_id: restaurant.id,
    intent_style: intentStyleLegacy,
    intent_items_count: {
      pizza: normalizedIntent?.pizza ? 1 : 0,
      sides: normalizedIntent?.sides?.length ?? 0,
      drinks: normalizedIntent?.drinks?.length ?? 0,
    },
    delivery: {
      state: delivery.state,
      confidence: delivery.confidence,
      source: delivery.source,
    },
    coverage: {
      state: coverage.state,
      confidence: coverage.confidence,
      source: coverage.source,
    },
    item: {
      state: item.state,
      confidence: item.confidence,
      source: item.source,
    },
    item_map_summary: {
      pizza: item_map["pizza"]?.state ?? null,
      side_count_by_state: countByState(item_map, "side:"),
      drink_count_by_state: countByState(item_map, "drink:"),
    },
    qualityScore,
    priceKnownCount,
    overall,
  });

  return assessment;
}

function countByState(
  itemMap: Record<SlotKey, CompatibilityCheckResult<ItemAvailabilityState>>,
  prefix: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, result] of Object.entries(itemMap)) {
    if (!key.startsWith(prefix)) continue;
    out[result.state] = (out[result.state] ?? 0) + 1;
  }
  return out;
}
