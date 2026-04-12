# Google Places API — Connector Quick Reference

This file is the implementation guide for `src/connectors/places.ts` in the AI Web project.
It consolidates the key patterns from all other reference files into a single actionable guide.

---

## Decision: New API (v1) — Recommended

Use the new Places API for all new development:
- Single call returns phone number (no separate Place Details needed)
- Field masks control cost precisely
- Better type filtering with `includedTypes` array
- Modern REST conventions

---

## Environment Variables Required

```bash
GOOGLE_PLACES_API_KEY=your_key_here
```

Add to `.env` and `.env.example`.

---

## Step 1: Geocode the Delivery Address

Before searching for restaurants, convert the user's text address to lat/lng.
The Places API Nearby Search requires coordinates, not text addresses.

Use the **Geocoding API** (separate from Places API, but same API key):

```typescript
async function geocodeAddress(address: string, apiKey: string): Promise<{lat: number, lng: number}> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString());
  const data = await res.json();

  if (data.status !== 'OK' || !data.results.length) {
    throw new Error(`Geocoding failed: ${data.status}`);
  }

  const { lat, lng } = data.results[0].geometry.location;
  return { lat, lng };
}
```

Geocoding API pricing: $5.00 per 1,000 requests ($200 free tier covers ~40,000/month).

---

## Step 2: Search for Pizza Restaurants (New API)

```typescript
interface PlacesResult {
  id: string;
  name: string;
  formattedAddress: string;
  phone: string | null;
  isOpen: boolean | null;
  openingHours: string[] | null;  // weekday descriptions
  rating: number | null;
  ratingCount: number | null;
  businessStatus: string;
  types: string[];
  hasDelivery: boolean | null;
  hasTakeout: boolean | null;
}

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.regularOpeningHours',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
  'places.types',
  'places.primaryType',
  'places.delivery',
  'places.takeout',
].join(',');

async function findPizzaRestaurants(
  lat: number,
  lng: number,
  radiusMeters: number = 3000,
  apiKey: string
): Promise<PlacesResult[]> {
  const res = await fetch(
    'https://places.googleapis.com/v1/places:searchNearby',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({
        includedTypes: ['pizza_restaurant', 'restaurant'],
        maxResultCount: 20,
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: radiusMeters,
          },
        },
        rankPreference: 'POPULARITY',
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Places API error ${res.status}: ${err.error?.message}`);
  }

  const data = await res.json();
  const places = data.places ?? [];

  return places.map((p: any): PlacesResult => ({
    id: p.id,
    name: p.displayName?.text ?? 'Unknown',
    formattedAddress: p.formattedAddress ?? '',
    phone: p.nationalPhoneNumber ?? null,
    isOpen: p.regularOpeningHours?.openNow ?? null,
    openingHours: p.regularOpeningHours?.weekdayDescriptions ?? null,
    rating: p.rating ?? null,
    ratingCount: p.userRatingCount ?? null,
    businessStatus: p.businessStatus ?? 'UNKNOWN',
    types: p.types ?? [],
    hasDelivery: p.delivery ?? null,
    hasTakeout: p.takeout ?? null,
  }));
}
```

---

## Step 3: Filter Results

```typescript
function filterPizzaCandidates(places: PlacesResult[]): PlacesResult[] {
  return places.filter(p => {
    // Must be operational
    if (p.businessStatus !== 'OPERATIONAL') return false;

    // Must have a phone number (required for Bland.ai)
    if (!p.phone) return false;

    // Prefer pizza-relevant places
    const isPizza =
      p.types.includes('pizza_restaurant') ||
      p.name.toLowerCase().includes('pizza') ||
      p.types.includes('italian_restaurant');

    return isPizza;
  });
}
```

---

## Step 4: Get Phone Number via Place Details (Legacy API Fallback)

Only needed if using the legacy API or if new API didn't return the phone number.

```typescript
async function getPhoneNumber(placeId: string, apiKey: string): Promise<string | null> {
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('fields', 'formatted_phone_number,opening_hours,business_status');
  url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString());
  const data = await res.json();

  if (data.status !== 'OK') return null;
  return data.result?.formatted_phone_number ?? null;
}
```

---

## Recommended Radius by Location Type

```typescript
function getSearchRadius(locationType: 'urban' | 'suburban' | 'rural'): number {
  return {
    urban: 2500,     // meters — dense city
    suburban: 6000,  // meters — suburbs
    rural: 15000,    // meters — rural
  }[locationType];
}
```

Default: 3000 m (covers most urban/suburban cases).

---

## Error Handling Patterns

```typescript
async function searchWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      if (err.message?.includes('429') && i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries exceeded');
}
```

---

## API Key Setup Checklist

- [ ] Create Google Cloud project
- [ ] Enable billing
- [ ] Enable "Places API (New)" in API Library
- [ ] Enable "Geocoding API" in API Library
- [ ] Create API key under Credentials
- [ ] Restrict key: Application restrictions → IP addresses (add server IP)
- [ ] Restrict key: API restrictions → Places API (New), Geocoding API
- [ ] Set budget alert at $50 and $200
- [ ] Add `GOOGLE_PLACES_API_KEY` to `.env`

---

## Cost Estimate for Pizza Ordering

Per user order attempt:
- 1 geocode call: $0.005
- 1 nearby search (with phone in field mask): $0.020
- Total per attempt: **$0.025**

At $200/month free tier: **~8,000 free order attempts/month**

---

## Key Fields for Bland.ai Integration

When passing a restaurant to Bland.ai for the voice call:

```typescript
interface RestaurantForBland {
  name: string;              // from displayName.text
  phone: string;             // from nationalPhoneNumber — THIS is what Bland dials
  address: string;           // from formattedAddress — for confirmation
  isOpen: boolean;           // from regularOpeningHours.openNow — gate before calling
}
```

Always confirm `isOpen === true` before placing the Bland.ai call.
If `isOpen === null` (unknown), include a disclaimer to the user.
