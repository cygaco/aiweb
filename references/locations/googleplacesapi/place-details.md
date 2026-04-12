# Google Places API — Place Details

Sources:
- Legacy: https://developers.google.com/maps/documentation/places/web-service/place-details
- New API: https://developers.google.com/maps/documentation/places/web-service/get-place
- Data fields: https://developers.google.com/maps/documentation/places/web-service/place-data-fields

---

## Overview

Place Details returns comprehensive information about a specific place, identified by its
Place ID. This is the primary way to get `formatted_phone_number` when using the legacy API,
since search endpoints don't return phone numbers.

With the new API, phone numbers can be included in search results via field masks, but
Place Details is still needed for full details (reviews, photos, website, etc.).

---

## Legacy Place Details

### Endpoint
```
GET https://maps.googleapis.com/maps/api/place/details/json
```

### Required Parameters

| Parameter | Type | Description |
|---|---|---|
| `key` | string | Your API key |
| `place_id` | string | The Place ID from a prior search result |

### Optional Parameters

| Parameter | Type | Description |
|---|---|---|
| `fields` | string | Comma-separated list of fields to return. **Use this to minimize cost.** |
| `language` | string | BCP-47 language code for response |
| `region` | string | CLDR region code (affects phone number format) |
| `reviews_no_translation` | boolean | Return reviews in original language |
| `sessiontoken` | string | Autocomplete session token (for billing consolidation) |

### Request Example — Phone Number Only (Cheapest)
```
GET https://maps.googleapis.com/maps/api/place/details/json
  ?place_id=ChIJN1t_tDeuEmsRUsoyG83frY4
  &fields=formatted_phone_number,opening_hours,business_status
  &key=YOUR_API_KEY
```

### Full Detail Request — All Relevant Fields for Pizza Ordering
```
GET https://maps.googleapis.com/maps/api/place/details/json
  ?place_id=ChIJN1t_tDeuEmsRUsoyG83frY4
  &fields=name,formatted_phone_number,international_phone_number,formatted_address,opening_hours,website,rating,user_ratings_total,price_level,business_status,types
  &key=YOUR_API_KEY
```

---

## Legacy Response Structure (Place Details)

```json
{
  "status": "OK",
  "result": {
    "place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
    "name": "Joe's Pizza",
    "formatted_address": "123 Main St, New York, NY 10001, USA",
    "formatted_phone_number": "(212) 555-0100",
    "international_phone_number": "+1 212-555-0100",
    "website": "https://www.joespizza.com",
    "url": "https://maps.google.com/?cid=...",
    "rating": 4.5,
    "user_ratings_total": 342,
    "price_level": 1,
    "business_status": "OPERATIONAL",
    "types": ["pizza_restaurant", "restaurant", "food", "point_of_interest", "establishment"],
    "opening_hours": {
      "open_now": true,
      "periods": [
        {
          "open":  { "day": 1, "time": "1100", "hours": 11, "minutes": 0 },
          "close": { "day": 1, "time": "2300", "hours": 23, "minutes": 0 }
        },
        {
          "open":  { "day": 2, "time": "1100" },
          "close": { "day": 2, "time": "2300" }
        }
      ],
      "weekday_text": [
        "Monday: 11:00 AM – 11:00 PM",
        "Tuesday: 11:00 AM – 11:00 PM",
        "Wednesday: 11:00 AM – 11:00 PM",
        "Thursday: 11:00 AM – 11:00 PM",
        "Friday: 11:00 AM – 12:00 AM",
        "Saturday: 11:00 AM – 12:00 AM",
        "Sunday: 11:00 AM – 10:00 PM"
      ]
    },
    "address_components": [
      { "long_name": "123",          "short_name": "123",      "types": ["street_number"] },
      { "long_name": "Main Street",  "short_name": "Main St",  "types": ["route"] },
      { "long_name": "New York",     "short_name": "New York", "types": ["locality", "political"] },
      { "long_name": "New York",     "short_name": "NY",       "types": ["administrative_area_level_1", "political"] },
      { "long_name": "United States","short_name": "US",       "types": ["country", "political"] },
      { "long_name": "10001",        "short_name": "10001",    "types": ["postal_code"] }
    ],
    "geometry": {
      "location": { "lat": 40.7130, "lng": -74.0055 },
      "viewport": { ... }
    },
    "vicinity": "123 Main St, New York",
    "plus_code": { "compound_code": "...", "global_code": "..." },
    "photos": [
      {
        "photo_reference": "...",
        "height": 400,
        "width": 600,
        "html_attributions": ["<a href='...'>Contributor</a>"]
      }
    ],
    "reviews": [
      {
        "author_name": "Jane Doe",
        "author_url": "https://www.google.com/maps/contrib/...",
        "language": "en",
        "profile_photo_url": "...",
        "rating": 5,
        "relative_time_description": "a week ago",
        "text": "Great pizza!",
        "time": 1617000000
      }
    ],
    "html_attributions": []
  }
}
```

---

## Legacy Field Categories and Billing

Fields are grouped into billing tiers. Only request what you need.

### Basic Fields (cheapest — included in search price)
```
address_component, adr_address, business_status, formatted_address,
geometry, icon, icon_background_color, icon_mask_base_uri, name,
permanently_closed (deprecated), photo, place_id, plus_code, type,
url, utc_offset, vicinity, wheelchair_accessible_entrance
```

### Contact Fields (billed at Contact Data SKU — ~$0.003 per call extra)
```
formatted_phone_number, international_phone_number, opening_hours, website
```

### Atmosphere Fields (billed at Atmosphere Data SKU — ~$0.005 per call extra)
```
curbside_pickup, delivery, dine_in, editorial_summary, price_level,
rating, reservable, reviews, serves_beer, serves_breakfast,
serves_brunch, serves_dinner, serves_lunch, serves_vegetarian_food,
serves_wine, takeout, user_ratings_total
```

**For pizza ordering — minimum fields:**
```
fields=formatted_phone_number,opening_hours,business_status,name,formatted_address
```
This hits Contact Fields tier. See `pricing.md` for exact costs.

---

## New API — Place Details (Get Place)

### Endpoint
```
GET https://places.googleapis.com/v1/places/{PLACE_ID}
```

### Headers
```
Content-Type: application/json
X-Goog-Api-Key: YOUR_API_KEY
X-Goog-FieldMask: id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,regularOpeningHours,currentOpeningHours,rating,userRatingCount,priceLevel,businessStatus,types,websiteUri
```

### Query Parameters

| Parameter | Type | Description |
|---|---|---|
| `languageCode` | string | BCP-47 language code |
| `regionCode` | string | CLDR region code (affects phone format) |
| `sessionToken` | string | Autocomplete session token |

### Request Example
```
GET https://places.googleapis.com/v1/places/ChIJN1t_tDeuEmsRUsoyG83frY4
  ?languageCode=en
Headers:
  X-Goog-Api-Key: YOUR_API_KEY
  X-Goog-FieldMask: id,displayName,nationalPhoneNumber,regularOpeningHours,businessStatus,rating,formattedAddress
```

### New API Response Structure

```json
{
  "id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
  "displayName": {
    "text": "Joe's Pizza",
    "languageCode": "en"
  },
  "formattedAddress": "123 Main St, New York, NY 10001, USA",
  "nationalPhoneNumber": "(212) 555-0100",
  "internationalPhoneNumber": "+1 212-555-0100",
  "websiteUri": "https://www.joespizza.com",
  "rating": 4.5,
  "userRatingCount": 342,
  "priceLevel": "PRICE_LEVEL_INEXPENSIVE",
  "businessStatus": "OPERATIONAL",
  "types": ["pizza_restaurant", "restaurant", "food", "point_of_interest", "establishment"],
  "primaryType": "pizza_restaurant",
  "primaryTypeDisplayName": {
    "text": "Pizza restaurant",
    "languageCode": "en"
  },
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
  "currentOpeningHours": {
    "openNow": true,
    "periods": [ ... ],
    "weekdayDescriptions": [ ... ]
  },
  "addressComponents": [
    { "longText": "123", "shortText": "123", "types": ["street_number"], "languageCode": "en" },
    { "longText": "Main Street", "shortText": "Main St", "types": ["route"], "languageCode": "en" },
    ...
  ],
  "plusCode": { "globalCode": "...", "compoundCode": "..." },
  "location": { "latitude": 40.7130, "longitude": -74.0055 },
  "viewport": { "low": {...}, "high": {...} },
  "photos": [
    {
      "name": "places/ChIJN1t.../photos/...",
      "widthPx": 600,
      "heightPx": 400,
      "authorAttributions": [{ "displayName": "...", "uri": "...", "photoUri": "..." }]
    }
  ],
  "reviews": [
    {
      "name": "places/ChIJN1t.../reviews/...",
      "relativePublishTimeDescription": "a week ago",
      "rating": 5,
      "text": { "text": "Great pizza!", "languageCode": "en" },
      "originalText": { "text": "Great pizza!", "languageCode": "en" },
      "authorAttribution": { "displayName": "Jane Doe", "uri": "...", "photoUri": "..." },
      "publishTime": "2024-01-15T10:00:00Z"
    }
  ],
  "accessibilityOptions": {
    "wheelchairAccessibleEntrance": true,
    "wheelchairAccessibleParking": true,
    "wheelchairAccessibleRestroom": true,
    "wheelchairAccessibleSeating": true
  },
  "delivery": true,
  "dineIn": true,
  "takeout": true,
  "reservable": false,
  "servesBeer": false,
  "servesBreakfast": false,
  "servesBrunch": false,
  "servesDinner": true,
  "servesLunch": true,
  "servesVegetarianFood": true
}
```

---

## New API Field Billing Tiers

| Field Mask Prefix | SKU | Approx. Cost per Call |
|---|---|---|
| `id`, `displayName`, `photos` | Places - Basic | ~$0.005 |
| `formattedAddress`, `addressComponents`, `location`, `types`, `businessStatus`, `plusCode`, `viewport`, `rating`, `userRatingCount`, `priceLevel`, `regularOpeningHours`, `primaryType` | Places - Basic | ~$0.005 |
| `nationalPhoneNumber`, `internationalPhoneNumber`, `websiteUri` | Places - Contact | +~$0.003 |
| `reviews`, `editorialSummary` | Places - Atmosphere | +~$0.005 |

---

## Phone Number Fields — Both APIs

### Legacy
- `formatted_phone_number` — local format, e.g. `(212) 555-0100`
- `international_phone_number` — E.164-ish, e.g. `+1 212-555-0100`

### New API
- `nationalPhoneNumber` — local format, e.g. `(212) 555-0100`
- `internationalPhoneNumber` — e.g. `+1 212-555-0100`

**For Bland.ai calls:** Use `nationalPhoneNumber` / `formatted_phone_number`.
Bland.ai expects the phone number of the restaurant to dial — local format works fine.
The `internationalPhoneNumber` is safer for non-US restaurants.

---

## Business Status Values

| Value | Meaning |
|---|---|
| `OPERATIONAL` | Open and operating normally |
| `CLOSED_TEMPORARILY` | Closed temporarily |
| `CLOSED_PERMANENTLY` | Permanently closed |

Always filter to `OPERATIONAL` before passing to Bland.ai.

---

## Opening Hours — Day of Week Mapping

`periods[].open.day` / `periods[].close.day`:
```
0 = Sunday
1 = Monday
2 = Tuesday
3 = Wednesday
4 = Thursday
5 = Friday
6 = Saturday
```

If a place is open 24 hours, periods contains a single entry with open day 0 time 0000 and no close.
