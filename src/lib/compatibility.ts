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
 */

import type { Restaurant } from "../data/restaurants.js";
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

export interface CompatibilityAssessment {
  delivery: CompatibilityCheckResult<DeliveryAvailabilityState>;
  coverage: CompatibilityCheckResult<DeliveryCoverageState>;
  item: CompatibilityCheckResult<ItemAvailabilityState>;
  overall: OverallVerdict;
  nextStep: string | null;
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
// Check 3 — Item Availability
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

export function checkItemAvailability(
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

  // isPlaces is true for places_* ids, BUT enriched restaurants retain their
  // places_ id with a real menu. menuSource='restaurant_website' means the menu
  // is real evidence — treat it like a real menu, not the generic template.
  const isPlaces =
    restaurant.id.startsWith("places_") &&
    restaurant.menuSource !== "restaurant_website";
  const match = findPizzaMatch(restaurant, intentStyle);

  if (isPlaces) {
    // Generic template is not evidence — never produce likely_available from it.
    // Both match and no-match land at unknown; enrichment may upgrade this later.
    return {
      state: "unknown",
      confidence: 0.4,
      source: "places_generic_menu",
      reason: match
        ? `Generic Places menu template matched "${match.matched}" — not real evidence; real menu unknown.`
        : `"${intentStyle}" not in generic 3-item template; real menu unknown.`,
      nextStep: `Confirm on call: 'Do you carry ${intentStyle}?'`,
    };
  }

  // Real menu (test_* or dominos_*)
  if (match) {
    if (match.exact) {
      return {
        state: "available",
        confidence: 0.95,
        source: "menu_match",
        reason: `${match.matched} is on ${restaurant.name}'s menu.`,
        nextStep: null,
      };
    }
    return {
      state: "available",
      confidence: 0.8,
      source: "menu_match",
      reason: `Fuzzy match: "${intentStyle}" → ${match.matched}.`,
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

// ────────────────────────────────────────────────────────────────────────────
// Combiner
// ────────────────────────────────────────────────────────────────────────────

function isNoGo<S extends string>(
  result: CompatibilityCheckResult<S>,
  bucket: Set<string>,
): boolean {
  return bucket.has(result.state);
}

export function assessCompatibility(
  restaurant: Restaurant,
  userLat: number | undefined,
  userLng: number | undefined,
  intentStyle: string | undefined,
): CompatibilityAssessment {
  const delivery = checkDeliveryAvailability(restaurant);
  const coverage = checkDeliveryCoverage(restaurant, userLat, userLng);
  const item = checkItemAvailability(restaurant, intentStyle);

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
      // lowest confidence drives nextStep
      const lowest = cautionList.reduce((a, b) =>
        a.check.confidence <= b.check.confidence ? a : b,
      );
      nextStep = lowest.check.nextStep;
    } else {
      overall = "go";
      nextStep = null;
    }
  }

  const assessment: CompatibilityAssessment = {
    delivery,
    coverage,
    item,
    overall,
    nextStep,
  };

  // Logging — fail-open inside event-log.ts; never break order flow.
  logCompatibilityEvent({
    restaurant_id: restaurant.id,
    intent_style: intentStyle ?? null,
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
    overall,
  });

  return assessment;
}
