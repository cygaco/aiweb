/**
 * Geocoding helper — extracted from places.ts so server.ts and the
 * compatibility layer can geocode user addresses without importing the full
 * Places connector.
 *
 * Returns null when the API key is missing OR the geocode lookup fails.
 * Callers fall back to coverage state `requires_address` when null.
 */

const GEOCODE_API_BASE = "https://maps.googleapis.com/maps/api/geocode/json";

export async function geocodeAddress(
  address: string,
  apiKey?: string,
): Promise<{ lat: number; lng: number } | null> {
  const key = apiKey ?? process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;

  const url = new URL(GEOCODE_API_BASE);
  url.searchParams.set("address", address);
  url.searchParams.set("key", key);

  try {
    const res = await fetch(url.toString());
    const data = (await res.json()) as {
      status: string;
      results: { geometry: { location: { lat: number; lng: number } } }[];
    };

    if (data.status !== "OK" || !data.results.length) return null;
    return data.results[0].geometry.location;
  } catch {
    return null;
  }
}
