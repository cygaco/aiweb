/**
 * Google Places API connector — restaurant discovery.
 * Uses Places API (New) v1. Progressive radius expansion in miles.
 */

import type { Restaurant } from "../data/restaurants.js";
import { geocodeAddress } from "../lib/geo.js";

const PLACES_API_BASE = "https://places.googleapis.com/v1";
const MILES_TO_METERS = 1609.34;

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.nationalPhoneNumber",
  "places.regularOpeningHours",
  "places.businessStatus",
  "places.types",
  "places.websiteUri",
  // R-5 / S-9 (SP-20260517-005). googleMapsUri is the URL of the
  // place's rich card on Google Maps. Used by menu-discovery as a
  // fallback when restaurant.website is missing or path-1
  // enrichment returns unchanged — the Maps page sometimes exposes a
  // "Menu" link that resolves to a parseable source.
  "places.googleMapsUri",
].join(",");

// Generic menu — Bland confirms actual offerings on the call.
const GENERIC_PIZZA_MENU: Restaurant["menu"] = {
  pizzas: [
    {
      name: "Pepperoni",
      description: "Classic pepperoni",
      sizes: [
        { name: "Small", price: 10.99 },
        { name: "Medium", price: 13.99 },
        { name: "Large", price: 16.99 },
      ],
    },
    {
      name: "Cheese",
      sizes: [
        { name: "Small", price: 9.99 },
        { name: "Medium", price: 12.99 },
        { name: "Large", price: 15.99 },
      ],
    },
    {
      name: "Specialty",
      description: "Ask about today's specialties",
      sizes: [
        { name: "Small", price: 12.99 },
        { name: "Medium", price: 15.99 },
        { name: "Large", price: 18.99 },
      ],
    },
  ],
  sides: [
    {
      name: "Sides available — ask on call",
      sizes: [{ name: "Regular", price: 0 }],
    },
  ],
};

type RawPlace = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  nationalPhoneNumber?: string;
  regularOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
  businessStatus?: string;
  websiteUri?: string;
  googleMapsUri?: string;
};

// Haversine distance in miles
function distanceMiles(
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

// ~25 mph mixed driving, minimum 20 min
function estimateDeliveryMinutes(miles: number): number {
  return Math.max(20, Math.round((miles / 25) * 60));
}

function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

function mapToRestaurant(
  place: RawPlace,
  searchLat: number,
  searchLng: number,
): Restaurant {
  const placeLat = place.location?.latitude ?? searchLat;
  const placeLng = place.location?.longitude ?? searchLng;
  const distMi = distanceMiles(searchLat, searchLng, placeLat, placeLng);
  const hours =
    place.regularOpeningHours?.weekdayDescriptions?.join(" | ") ??
    "Call to confirm hours";

  return {
    id: `places_${place.id}`,
    name: place.displayName?.text ?? "Pizza Restaurant",
    phone: toE164(place.nationalPhoneNumber!),
    address: place.formattedAddress ?? "",
    lat: placeLat,
    lng: placeLng,
    // Places API doesn't tell us the restaurant's true delivery radius.
    // Stop fabricating one — emit null and let the compatibility layer mark
    // coverage UNKNOWN. (PRD §6.4 / S-4.)
    deliveryRadius: null,
    estimatedDeliveryMinutes: estimateDeliveryMinutes(distMi),
    acceptsCash: true,
    serviceType: "unknown",
    menu: GENERIC_PIZZA_MENU,
    hours,
    ...(place.websiteUri ? { website: place.websiteUri } : {}),
    ...(place.googleMapsUri ? { googleMapsUri: place.googleMapsUri } : {}),
  };
}

async function searchPlaces(
  lat: number,
  lng: number,
  radiusMiles: number,
  apiKey: string,
  includedTypes: string[],
  nameFilter?: (name: string) => boolean,
): Promise<RawPlace[]> {
  const res = await fetch(`${PLACES_API_BASE}/places:searchNearby`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes,
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: radiusMiles * MILES_TO_METERS,
        },
      },
      rankPreference: "POPULARITY",
    }),
  });

  if (!res.ok) {
    const err = (await res.json()) as { error?: { message: string } };
    throw new Error(`Places API ${res.status}: ${err.error?.message}`);
  }

  const data = (await res.json()) as { places?: RawPlace[] };
  return (data.places ?? []).filter((p) => {
    if (p.businessStatus !== "OPERATIONAL") return false;
    if (!p.nationalPhoneNumber) return false;
    if (nameFilter) {
      const name = p.displayName?.text?.toLowerCase() ?? "";
      if (!nameFilter(name)) return false;
    }
    return true;
  });
}

const isPizzaName = (name: string) =>
  name.includes("pizza") ||
  name.includes("pizzeria") ||
  name.includes("pizz") ||
  name.includes("pie");

/**
 * Find pizza restaurants near an address.
 * Progressive radius: 5mi → 15mi → 30mi.
 * Per radius: pizza_restaurant type first, then restaurant+name filter.
 * Returns empty array if GOOGLE_PLACES_API_KEY is not set.
 */
export async function findNearbyPizzaPlaces(
  address: string,
): Promise<Restaurant[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return [];

  try {
    const geo = await geocodeAddress(address, apiKey);
    if (!geo) return [];
    const { lat, lng } = geo;

    for (const radiusMiles of [5, 15, 30]) {
      // Pass 1: dedicated pizza restaurant type
      let raw = await searchPlaces(lat, lng, radiusMiles, apiKey, [
        "pizza_restaurant",
      ]);

      // Pass 2: any restaurant/delivery with "pizza" in the name
      if (raw.length === 0) {
        raw = await searchPlaces(
          lat,
          lng,
          radiusMiles,
          apiKey,
          ["restaurant", "meal_delivery", "meal_takeaway"],
          isPizzaName,
        );
      }

      if (raw.length > 0) {
        return raw.map((p) => mapToRestaurant(p, lat, lng));
      }
    }

    return [];
  } catch (err) {
    console.error("[places] discovery failed:", err);
    return [];
  }
}
