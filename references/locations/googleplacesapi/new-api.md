# Google Places API (New) — v1 Overview

Source: https://developers.google.com/maps/documentation/places/web-service/op-overview
Last reviewed: knowledge cutoff Aug 2025

---

## What Is the New API

The Places API (New) is a redesigned version of the Places API, generally available since
November 2023. It uses a different base URL, REST conventions, and response schema from the
legacy API. Both APIs are live simultaneously; the legacy API is not deprecated as of mid-2025.

**Base URL:** `https://places.googleapis.com/v1/`

---

## Key Differences from Legacy

| Feature | Legacy API | New API (v1) |
|---|---|---|
| HTTP method | GET for all search/details | POST for search, GET for details |
| Auth | `?key=` query param | `X-Goog-Api-Key` header (preferred) |
| Field selection | `fields=` param (details only) | `X-Goog-FieldMask` header on ALL requests |
| Response wrapper | `result` / `results` object | `places` array / flat place object |
| Phone field name | `formatted_phone_number` | `nationalPhoneNumber` |
| Address field name | `formatted_address` | `formattedAddress` |
| Opening hours | `opening_hours` | `regularOpeningHours` + `currentOpeningHours` |
| Rating count | `user_ratings_total` | `userRatingCount` |
| Place ID ref | `place_id` | `id` |
| Types array | `types` | `types` + `primaryType` + `primaryTypeDisplayName` |
| Place name | `name` | `displayName.text` |
| Multiple type filter | Not supported | `includedTypes` array |
| Pagination token | `pagetoken` query param | `pageToken` in request body |
| Client libraries | Maps JS SDK, legacy libs | New client libs (Node, Python, Go, Java) |
| Billing | Per-call flat rate | Field-mask-based tiered billing |

---

## Endpoints

### Search Nearby
```
POST https://places.googleapis.com/v1/places:searchNearby
```
Find places within a circle defined by center + radius.

### Search Text
```
POST https://places.googleapis.com/v1/places:searchText
```
Find places matching a text query with optional location bias.

### Get Place (Place Details)
```
GET https://places.googleapis.com/v1/places/{place_id}
```
Full details for a specific place by ID.

### Autocomplete
```
POST https://places.googleapis.com/v1/places:autocomplete
```
Text autocomplete for place search inputs.

### Get Photo
```
GET https://places.googleapis.com/v1/{photo_name}/media
```
Retrieve a place photo. `photo_name` comes from the `photos[].name` field in place details.

---

## Field Masks — Complete Reference

The `X-Goog-FieldMask` header controls which fields are returned AND which billing tier applies.
This is the most important concept in the new API.

### Syntax
```
X-Goog-FieldMask: places.id,places.displayName,places.nationalPhoneNumber
```

For Place Details (GET), omit the `places.` prefix:
```
X-Goog-FieldMask: id,displayName,nationalPhoneNumber
```

### All Available Fields — Places (Search Responses)

#### Identity / Basic
```
places.id
places.name                     (resource name: "places/ChIJ...")
places.displayName              (object: {text, languageCode})
places.types                    (string array)
places.primaryType
places.primaryTypeDisplayName
places.businessStatus
```

#### Location / Address
```
places.location                 ({latitude, longitude})
places.viewport                 ({low, high} LatLng bounds)
places.formattedAddress
places.addressComponents        (array of components)
places.plusCode
places.shortFormattedAddress
```

#### Contact (Contact Data billing tier)
```
places.nationalPhoneNumber
places.internationalPhoneNumber
places.websiteUri
```

#### Hours
```
places.regularOpeningHours      (static hours from listing)
places.currentOpeningHours      (adjusted for exceptions/holidays)
places.regularSecondaryOpeningHours
places.currentSecondaryOpeningHours
places.utcOffsetMinutes
```

#### Rating / Reviews (Atmosphere billing tier)
```
places.rating
places.userRatingCount
places.reviews                  (array of review objects)
places.editorialSummary
places.priceLevel
```

#### Photos
```
places.photos                   (array of photo objects)
```

#### Dining Attributes (Atmosphere billing tier)
```
places.delivery
places.dineIn
places.takeout
places.reservable
places.servesBreakfast
places.servesBrunch
places.servesLunch
places.servesDinner
places.servesBeer
places.servesWine
places.servesVegetarianFood
places.servescocktails
places.servesDessert
places.servesCoffee
places.goodForChildren
places.goodForGroups
places.goodForWatchingSports
places.menuForChildren
places.outdoorSeating
places.liveMusic
places.paymentOptions
```

#### Accessibility
```
places.accessibilityOptions
```

#### EV / Fuel (not relevant for restaurants)
```
places.evChargeOptions
places.fuelOptions
```

#### Parking (Atmosphere tier)
```
places.parkingOptions
```

### Recommended Field Mask for Pizza Ordering
```
places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.regularOpeningHours,places.rating,places.userRatingCount,places.businessStatus,places.types,places.primaryType,places.delivery,places.takeout
```

This covers everything needed to:
1. Display restaurant options to user
2. Confirm it's open
3. Get the phone number to pass to Bland.ai
4. Show delivery/takeout availability

---

## Authentication

### Recommended: API Key in Header
```http
X-Goog-Api-Key: YOUR_API_KEY
```

### Also Supported: Query Parameter
```
?key=YOUR_API_KEY
```

### OAuth 2.0 (for user-context features)
Required if accessing user-specific data (like user's saved places). Not needed for
restaurant search.

---

## Pagination

Search responses return up to 20 results. To get more:

1. Check for `nextPageToken` in response body.
2. Include `"pageToken": "<token>"` in the next request body.
3. Maximum results: implementation-defined (typically 60 total across 3 pages).

```json
// Request page 2:
{
  "pageToken": "eyJlbmMiOiJBMTI...",
  "locationRestriction": { ... }
}
```

---

## Error Handling

New API uses standard HTTP status codes + Google's error format:

```json
{
  "error": {
    "code": 400,
    "message": "Request contains an invalid argument.",
    "status": "INVALID_ARGUMENT",
    "details": [
      {
        "@type": "type.googleapis.com/google.rpc.BadRequest",
        "fieldViolations": [
          {
            "field": "location_restriction.circle.radius",
            "description": "Radius must be between 0 and 50000 meters."
          }
        ]
      }
    ]
  }
}
```

### Common Error Codes

| HTTP Status | gRPC Status | Meaning |
|---|---|---|
| 400 | INVALID_ARGUMENT | Bad request parameters |
| 401 | UNAUTHENTICATED | Missing or invalid API key |
| 403 | PERMISSION_DENIED | API not enabled or key restricted |
| 404 | NOT_FOUND | Place ID not found |
| 429 | RESOURCE_EXHAUSTED | Quota exceeded |
| 500 | INTERNAL | Server error — retry |
| 503 | UNAVAILABLE | Service unavailable — retry with backoff |

---

## Migration from Legacy to New API

### Field Name Mapping

| Legacy Field | New API Field |
|---|---|
| `place_id` | `id` |
| `name` | `displayName.text` |
| `formatted_address` | `formattedAddress` |
| `vicinity` | `shortFormattedAddress` |
| `formatted_phone_number` | `nationalPhoneNumber` |
| `international_phone_number` | `internationalPhoneNumber` |
| `opening_hours` | `regularOpeningHours` |
| `opening_hours.open_now` | `regularOpeningHours.openNow` |
| `opening_hours.weekday_text` | `regularOpeningHours.weekdayDescriptions` |
| `opening_hours.periods` | `regularOpeningHours.periods` |
| `rating` | `rating` |
| `user_ratings_total` | `userRatingCount` |
| `price_level` (integer 0-4) | `priceLevel` (enum string) |
| `business_status` | `businessStatus` |
| `types` | `types` + `primaryType` |
| `website` | `websiteUri` |
| `photos[].photo_reference` | `photos[].name` (resource name) |

### Endpoint Mapping

| Legacy Endpoint | New API Endpoint |
|---|---|
| `GET /nearbysearch/json` | `POST /places:searchNearby` |
| `GET /textsearch/json` | `POST /places:searchText` |
| `GET /details/json?place_id=X` | `GET /places/{X}` |
| `GET /findplacefromtext/json` | `POST /places:searchText` (simpler) |
| `GET /autocomplete/json` | `POST /places:autocomplete` |
| `GET /photo?photoreference=X` | `GET /places/{id}/photos/{ref}/media` |

---

## New API Client Libraries

Official client libraries (install separately):

```bash
# Node.js
npm install @googlemaps/places

# Or use the broader maps SDK
npm install @googlemaps/google-maps-services-js
```

For direct REST calls (no library), the `axios` or `node-fetch` approach is simpler and
has no external dependency. Recommended for Wave 00 (keep deps minimal).

---

## Complete Example: Find Pizza + Phone in One Call

```typescript
const response = await fetch(
  'https://places.googleapis.com/v1/places:searchNearby',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY!,
      'X-Goog-FieldMask': [
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
      ].join(','),
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

const data = await response.json();
const places = data.places ?? [];

// Filter to operational + open + has phone
const candidates = places.filter(p =>
  p.businessStatus === 'OPERATIONAL' &&
  p.regularOpeningHours?.openNow === true &&
  p.nationalPhoneNumber
);
```

---

## Enabling the New API

In Google Cloud Console:
1. Go to APIs & Services > Library
2. Search for "Places API (New)"
3. Enable it
4. Also enable "Places API" if using legacy endpoints

Note: These are **separate APIs** — you must enable both if using both.
Your existing API key works for both once both are enabled.
