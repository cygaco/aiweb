# Google Places API — Nearby Search

Sources:
- Legacy: https://developers.google.com/maps/documentation/places/web-service/nearby-search
- New API: https://developers.google.com/maps/documentation/places/web-service/search-nearby

---

## Overview

Nearby Search returns a list of places within a specified radius of a geographic coordinate.
It does NOT accept a text address — you must geocode the address first (Geocoding API) or
supply lat/lng directly.

Both legacy and new versions exist. Use the new API for new builds.

---

## Legacy Nearby Search

### Endpoint
```
GET https://maps.googleapis.com/maps/api/place/nearbysearch/json
```

### Required Parameters

| Parameter | Type | Description |
|---|---|---|
| `key` | string | Your API key |
| `location` | string | `lat,lng` of the center point — e.g. `37.7749,-122.4194` |
| `radius` | integer | Search radius in meters. Max **50,000**. Required unless `rankby=distance` |

### Optional Parameters

| Parameter | Type | Description |
|---|---|---|
| `keyword` | string | Term to match against all content (name, type, address, reviews). E.g. `pizza` |
| `language` | string | BCP-47 language code for results. E.g. `en` |
| `maxprice` | integer | 0–4. Filter by price level (0=free, 4=very expensive) |
| `minprice` | integer | 0–4. Filter by price level |
| `name` | string | (Deprecated) Match against place names only. Use `keyword` instead |
| `opennow` | boolean | Only return places open at request time |
| `pagetoken` | string | Token from previous response to get next 20 results |
| `rankby` | string | `prominence` (default) or `distance`. If `distance`, omit `radius`; one of `keyword`, `name`, or `type` required |
| `type` | string | Single place type filter — e.g. `restaurant`. Full list: see `place-types.md` |

> Note: `type` accepts only ONE value in the legacy API. Use `keyword=pizza` + `type=restaurant` for pizza restaurants.

### Request Example — Pizza Restaurants Near Address
```
GET https://maps.googleapis.com/maps/api/place/nearbysearch/json
  ?location=40.7128,-74.0060
  &radius=3000
  &type=restaurant
  &keyword=pizza
  &opennow=true
  &rankby=prominence
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
      "vicinity": "123 Main St, New York",
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
      "icon": "https://maps.gstatic.com/mapfiles/place_api/icons/v1/png_71/restaurant-71.png",
      "icon_background_color": "#FF9E67",
      "icon_mask_base_uri": "https://maps.gstatic.com/mapfiles/place_api/icons/v2/restaurant_pinlet",
      "business_status": "OPERATIONAL",
      "plus_code": { "compound_code": "...", "global_code": "..." },
      "reference": "ChIJN1t_tDeuEmsRUsoyG83frY4"
    }
  ],
  "html_attributions": []
}
```

### Important: What's NOT in Nearby Search Results (Legacy)

- `formatted_phone_number` — NOT available. Requires Place Details call.
- `international_phone_number` — NOT available. Requires Place Details call.
- `formatted_address` — NOT available. Only `vicinity` (shortened address).
- Full `opening_hours` with periods — NOT available. Only `open_now` boolean.
- `website` — NOT available.

**For pizza ordering:** Nearby Search gets you the list + Place IDs. Then call Place Details for phone numbers.

### Response Status Codes

| Status | Meaning |
|---|---|
| `OK` | Results found |
| `ZERO_RESULTS` | No results found |
| `INVALID_REQUEST` | Missing required parameter |
| `OVER_DAILY_LIMIT` | Key issue or billing disabled |
| `OVER_QUERY_LIMIT` | Quota exceeded |
| `REQUEST_DENIED` | Key not authorized |
| `UNKNOWN_ERROR` | Server error, retry |

### Pagination

Results return up to **20 places** per call. If more exist, `next_page_token` is present.
To get next page: add `pagetoken=<token>` to a new request. Wait ~2 seconds before fetching
(token takes time to activate). Maximum 3 pages = 60 results total.

---

## New API — Nearby Search (v1)

### Endpoint
```
POST https://places.googleapis.com/v1/places:searchNearby
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
| `locationRestriction` | object | Yes | Geographic constraint (circle) |
| `locationRestriction.circle.center` | LatLng | Yes | `{"latitude": 40.71, "longitude": -74.00}` |
| `locationRestriction.circle.radius` | float | Yes | Radius in meters. Max **50,000** |
| `includedTypes` | string[] | No | Place types to include — e.g. `["pizza_restaurant", "restaurant"]` |
| `excludedTypes` | string[] | No | Place types to exclude |
| `includedPrimaryTypes` | string[] | No | Match only against primary type |
| `excludedPrimaryTypes` | string[] | No | Exclude primary type |
| `maxResultCount` | integer | No | Max results. Default 20, max **20** |
| `languageCode` | string | No | BCP-47 language code |
| `regionCode` | string | No | CLDR region code for result formatting |
| `rankPreference` | string | No | `POPULARITY` (default) or `DISTANCE` |

### New API Request Example — Pizza Restaurants
```json
POST https://places.googleapis.com/v1/places:searchNearby
Headers:
  X-Goog-Api-Key: YOUR_API_KEY
  X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.regularOpeningHours,places.rating,places.types,places.businessStatus

Body:
{
  "includedTypes": ["pizza_restaurant", "restaurant"],
  "maxResultCount": 20,
  "locationRestriction": {
    "circle": {
      "center": {
        "latitude": 40.7128,
        "longitude": -74.0060
      },
      "radius": 3000.0
    }
  },
  "rankPreference": "POPULARITY"
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
          "Tuesday: 11:00 AM – 11:00 PM",
          "Wednesday: 11:00 AM – 11:00 PM",
          "Thursday: 11:00 AM – 11:00 PM",
          "Friday: 11:00 AM – 12:00 AM",
          "Saturday: 11:00 AM – 12:00 AM",
          "Sunday: 11:00 AM – 10:00 PM"
        ]
      },
      "rating": 4.5,
      "types": ["pizza_restaurant", "restaurant", "food", "point_of_interest", "establishment"],
      "businessStatus": "OPERATIONAL"
    }
  ]
}
```

### Key Difference from Legacy

- `nationalPhoneNumber` IS available in new API Nearby Search if included in field mask.
- `formattedAddress` IS available (not just `vicinity`).
- Full `regularOpeningHours` with periods IS available.
- You can include multiple types in `includedTypes` array.
- No separate Place Details call needed for phone number if field mask includes it.

### Pagination (New API)

Response includes `nextPageToken` string at the top level. Pass as `pageToken` in next request body.

---

## Pizza Ordering Strategy

### Option A: New API (Recommended)
Single `searchNearby` call with field mask that includes `nationalPhoneNumber` returns everything
needed in one round trip. No Place Details call required.

```
Field mask: places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.regularOpeningHours,places.rating,places.businessStatus,places.types
```

Estimated cost: ~$0.017 per call (Nearby Search Basic + contact data fields).
See `pricing.md` for breakdown.

### Option B: Legacy API
1. `nearbysearch` with `type=restaurant&keyword=pizza` — get place IDs.
2. Filter to `OPERATIONAL` businesses.
3. For each candidate, call Place Details with `fields=formatted_phone_number,opening_hours`.
4. Cost: $0.017 (search) + $0.017 per details call (contact data SKU).

### Recommended Radius for Pizza Delivery
- Urban: 2,000–3,000 m
- Suburban: 5,000–8,000 m
- Rural: 10,000–15,000 m

### Filtering for Open Restaurants
- Legacy: `opennow=true` parameter
- New API: `regularOpeningHours.openNow` in field mask + filter client-side, OR use no server-side filter and check `openNow` in response
