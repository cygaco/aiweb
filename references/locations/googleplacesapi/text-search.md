# Google Places API — Text Search

Sources:
- Legacy: https://developers.google.com/maps/documentation/places/web-service/text-search
- New API: https://developers.google.com/maps/documentation/places/web-service/text-search (v1)

---

## Overview

Text Search finds places matching a free-text query string, optionally biased toward a
location. Unlike Nearby Search (which requires coordinates + radius), Text Search can
accept a query like "pizza near 123 Main St New York" and handles the geo-parsing internally.

**Good for:** user-typed queries, address + intent combined, named restaurant lookup.
**Use instead of Nearby Search when:** the user types a search string rather than just
providing an address.

---

## Legacy Text Search

### Endpoint
```
GET https://maps.googleapis.com/maps/api/place/textsearch/json
```

### Required Parameters

| Parameter | Type | Description |
|---|---|---|
| `key` | string | Your API key |
| `query` | string | The search string — e.g. `pizza restaurants in New York` |

### Optional Parameters

| Parameter | Type | Description |
|---|---|---|
| `location` | string | `lat,lng` bias center — results biased toward this point |
| `radius` | integer | Bias radius in meters (max 50,000). Location must also be provided |
| `language` | string | BCP-47 language code |
| `maxprice` | integer | 0–4 max price level |
| `minprice` | integer | 0–4 min price level |
| `opennow` | boolean | Only return currently open places |
| `pagetoken` | string | Next-page token from prior response |
| `region` | string | CLDR region code bias (e.g. `us`) |
| `type` | string | Single type filter — e.g. `restaurant` |

> Note: `location` + `radius` in Text Search provides a **bias**, not a hard restriction.
> Results outside the radius can still appear if they match the query well.
> To hard-restrict to a region, use Nearby Search instead.

### Request Example — Pizza Near Address
```
GET https://maps.googleapis.com/maps/api/place/textsearch/json
  ?query=pizza+restaurants
  &location=40.7128,-74.0060
  &radius=3000
  &opennow=true
  &type=restaurant
  &key=YOUR_API_KEY
```

### Response Structure

```json
{
  "status": "OK",
  "next_page_token": "...",
  "results": [
    {
      "place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
      "name": "Joe's Pizza",
      "formatted_address": "123 Main St, New York, NY 10001, USA",
      "geometry": {
        "location": { "lat": 40.7130, "lng": -74.0055 },
        "viewport": { ... }
      },
      "types": ["pizza_restaurant", "restaurant", "food", "point_of_interest", "establishment"],
      "rating": 4.5,
      "user_ratings_total": 342,
      "price_level": 1,
      "opening_hours": {
        "open_now": true
      },
      "photos": [ { "photo_reference": "...", "height": 400, "width": 600 } ],
      "icon": "...",
      "business_status": "OPERATIONAL",
      "plus_code": { "compound_code": "...", "global_code": "..." }
    }
  ],
  "html_attributions": []
}
```

### Key Difference from Nearby Search (Legacy)
- Text Search returns `formatted_address` (full address). Nearby Search returns only `vicinity`.
- Text Search does NOT return `formatted_phone_number` either. Still requires Place Details.
- Pagination: same `pagetoken` mechanism, max 3 pages (60 results).

---

## New API — Text Search (v1)

### Endpoint
```
POST https://places.googleapis.com/v1/places:searchText
```

### Headers
```
Content-Type: application/json
X-Goog-Api-Key: YOUR_API_KEY
X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.regularOpeningHours,places.rating,places.types,places.businessStatus
```

### Request Body Parameters

| Field | Type | Required | Description |
|---|---|---|---|
| `textQuery` | string | Yes | The free-text search query |
| `languageCode` | string | No | BCP-47 language code |
| `regionCode` | string | No | CLDR region code |
| `rankPreference` | string | No | `RELEVANCE` (default) or `DISTANCE` |
| `includedType` | string | No | Single type filter — e.g. `restaurant` |
| `openNow` | boolean | No | Only return currently open places |
| `minRating` | float | No | Minimum rating 0.0–5.0 |
| `maxResultCount` | integer | No | Max results (default 20, max 20) |
| `priceLevels` | string[] | No | e.g. `["PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE"]` |
| `locationBias` | object | No | Bias results toward a circle or rectangle |
| `locationRestriction` | object | No | Hard-restrict results to rectangle |
| `strictTypeFiltering` | boolean | No | If true, only return places that strictly match `includedType` |
| `evOptions` | object | No | EV charging filter (irrelevant for restaurants) |

#### locationBias (circle)
```json
"locationBias": {
  "circle": {
    "center": { "latitude": 40.7128, "longitude": -74.0060 },
    "radius": 3000.0
  }
}
```

#### locationBias (rectangle)
```json
"locationBias": {
  "rectangle": {
    "low":  { "latitude": 40.70, "longitude": -74.02 },
    "high": { "latitude": 40.73, "longitude": -73.99 }
  }
}
```

#### locationRestriction (hard boundary, rectangle only)
```json
"locationRestriction": {
  "rectangle": {
    "low":  { "latitude": 40.70, "longitude": -74.02 },
    "high": { "latitude": 40.73, "longitude": -73.99 }
  }
}
```

### New API Request Example — Pizza Near Address
```json
POST https://places.googleapis.com/v1/places:searchText
Headers:
  X-Goog-Api-Key: YOUR_API_KEY
  X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.regularOpeningHours,places.rating,places.businessStatus,places.types

Body:
{
  "textQuery": "pizza restaurants",
  "includedType": "restaurant",
  "openNow": true,
  "maxResultCount": 20,
  "rankPreference": "RELEVANCE",
  "locationBias": {
    "circle": {
      "center": {
        "latitude": 40.7128,
        "longitude": -74.0060
      },
      "radius": 3000.0
    }
  }
}
```

### New API Response Structure

```json
{
  "places": [
    {
      "id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
      "displayName": {
        "text": "Joe's Pizza",
        "languageCode": "en"
      },
      "formattedAddress": "123 Main St, New York, NY 10001, USA",
      "nationalPhoneNumber": "(212) 555-0100",
      "regularOpeningHours": {
        "openNow": true,
        "periods": [
          {
            "open": { "day": 1, "hour": 11, "minute": 0 },
            "close": { "day": 1, "hour": 23, "minute": 0 }
          }
        ],
        "weekdayDescriptions": [
          "Monday: 11:00 AM – 11:00 PM",
          ...
        ]
      },
      "rating": 4.5,
      "types": ["pizza_restaurant", "restaurant", "food", "point_of_interest", "establishment"],
      "businessStatus": "OPERATIONAL"
    }
  ],
  "nextPageToken": "..."
}
```

### Price Level Values (New API)

| Value | Meaning |
|---|---|
| `PRICE_LEVEL_FREE` | Free |
| `PRICE_LEVEL_INEXPENSIVE` | $ |
| `PRICE_LEVEL_MODERATE` | $$ |
| `PRICE_LEVEL_EXPENSIVE` | $$$ |
| `PRICE_LEVEL_VERY_EXPENSIVE` | $$$$ |

---

## Text Search vs. Nearby Search — When to Use Which

| Situation | Use |
|---|---|
| User provides only an address, you want pizza near it | Nearby Search |
| User types "pizza near downtown" or "best pizza place" | Text Search |
| You want to find a specific named restaurant | Text Search or Find Place |
| You need hard radius enforcement | Nearby Search |
| You're geocoding first and searching after | Nearby Search |

---

## Pizza Ordering Strategy

For our use case, the recommended flow is:

1. **Geocode** the user's delivery address → lat/lng (Geocoding API, not covered here).
2. **Nearby Search** (new API) with `includedTypes: ["pizza_restaurant"]` + field mask
   including `nationalPhoneNumber` → returns up to 20 results with phone numbers in one call.
3. Filter by `businessStatus == "OPERATIONAL"` and `regularOpeningHours.openNow == true`.
4. If Nearby Search returns 0 results (very rural), fall back to Text Search with
   `textQuery: "pizza delivery"` + `locationBias`.

### Handling Missing Phone Numbers
Some places don't have phone numbers listed in Google. Strategy:
- Check `nationalPhoneNumber` — if null/missing, skip or flag to user.
- Do NOT call Place Details for the phone number speculatively for all results — costs $0.017 each.
- Only call Place Details for the top 3–5 candidates.
