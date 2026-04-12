# Google Places API — Autocomplete

Sources:
- Legacy: https://developers.google.com/maps/documentation/places/web-service/autocomplete
- New API: Autocomplete (v1)

---

## Overview

Autocomplete returns place predictions for a text prefix. Two types:
- **Place Autocomplete** — returns businesses and addresses
- **Query Autocomplete** — returns search query suggestions

For pizza ordering, autocomplete is useful for:
1. Address input — user types their delivery address, get formatted address suggestions
2. Restaurant search — user types "Joe's P..." → suggest "Joe's Pizza - 123 Main St"

---

## Billing Strategy: Always Use Sessions

Autocomplete billed per-request costs $0.00283/request (keystroke). With sessions,
all keystrokes + 1 Place Details call are bundled into one $0.017 charge.

**Always use session tokens.** Without them, a user typing 10 characters = $0.028 vs $0.017.

---

## Legacy Place Autocomplete

### Endpoint
```
GET https://maps.googleapis.com/maps/api/place/autocomplete/json
```

### Required Parameters

| Parameter | Type | Description |
|---|---|---|
| `key` | string | Your API key |
| `input` | string | Text to autocomplete |

### Optional Parameters

| Parameter | Type | Description |
|---|---|---|
| `sessiontoken` | string | UUID for session billing. Generate once per user search session. |
| `language` | string | BCP-47 language code |
| `location` | string | `lat,lng` bias center |
| `radius` | integer | Bias radius in meters |
| `strictbounds` | boolean | Hard-restrict to location+radius |
| `offset` | integer | Character offset in `input` where cursor is |
| `origin` | string | `lat,lng` origin for `distance_meters` in response |
| `types` | string | Pipe-separated type filter, up to 5 types. e.g. `establishment` |
| `components` | string | Country filter e.g. `country:us` |

### Types Filter Values (Autocomplete-specific)
```
geocode             — addresses only
address             — addresses only (deprecated alias)
establishment       — businesses only
(regions)           — geographic regions
(cities)            — cities only
```

For delivery address: `types=geocode` or `types=address`
For restaurant name: `types=establishment`

### Request Example — Address Autocomplete
```
GET https://maps.googleapis.com/maps/api/place/autocomplete/json
  ?input=123+Main+St
  &types=geocode
  &components=country:us
  &sessiontoken=1234-5678-9abc
  &key=YOUR_API_KEY
```

### Request Example — Restaurant Name Autocomplete
```
GET https://maps.googleapis.com/maps/api/place/autocomplete/json
  ?input=Joe%27s+Pizza
  &types=establishment
  &location=40.7128,-74.0060
  &radius=5000
  &sessiontoken=1234-5678-9abc
  &key=YOUR_API_KEY
```

### Response Structure
```json
{
  "status": "OK",
  "predictions": [
    {
      "description": "123 Main Street, New York, NY, USA",
      "place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
      "reference": "ChIJN1t_tDeuEmsRUsoyG83frY4",
      "structured_formatting": {
        "main_text": "123 Main Street",
        "main_text_matched_substrings": [{"length": 14, "offset": 0}],
        "secondary_text": "New York, NY, USA"
      },
      "terms": [
        {"offset": 0, "value": "123 Main Street"},
        {"offset": 17, "value": "New York"},
        {"offset": 27, "value": "NY"},
        {"offset": 31, "value": "USA"}
      ],
      "types": ["street_address", "geocode"],
      "matched_substrings": [{"length": 14, "offset": 0}],
      "distance_meters": 120
    }
  ],
  "html_attributions": []
}
```

---

## Legacy Query Autocomplete

### Endpoint
```
GET https://maps.googleapis.com/maps/api/place/queryautocomplete/json
```

Same parameters as Place Autocomplete except: no `types` filter, no `strictbounds`.
Returns query suggestions rather than specific places. Less useful for pizza ordering.

---

## New API — Autocomplete (v1)

### Endpoint
```
POST https://places.googleapis.com/v1/places:autocomplete
```

### Request Body Parameters

| Field | Type | Required | Description |
|---|---|---|---|
| `input` | string | Yes | Text prefix to autocomplete |
| `sessionToken` | string | No | Session token for billing. Use a UUID. |
| `locationBias` | object | No | Bias toward circle or rectangle |
| `locationRestriction` | object | No | Hard-restrict to rectangle |
| `includedPrimaryTypes` | string[] | No | Type filter e.g. `["restaurant"]` |
| `includedRegionCodes` | string[] | No | CLDR codes e.g. `["us"]` |
| `languageCode` | string | No | BCP-47 language code |
| `regionCode` | string | No | CLDR region code |
| `origin` | LatLng | No | Origin for `distanceMeters` in response |
| `inputOffset` | integer | No | Cursor position in input string |
| `includeQueryPredictions` | boolean | No | Also return query suggestions |

### New API Request Example — Address
```json
POST https://places.googleapis.com/v1/places:autocomplete
Headers:
  X-Goog-Api-Key: YOUR_API_KEY

Body:
{
  "input": "123 Main St",
  "sessionToken": "550e8400-e29b-41d4-a716-446655440000",
  "includedPrimaryTypes": ["geocode"],
  "includedRegionCodes": ["us"],
  "locationBias": {
    "circle": {
      "center": { "latitude": 40.7128, "longitude": -74.0060 },
      "radius": 50000.0
    }
  }
}
```

### New API Response Structure
```json
{
  "suggestions": [
    {
      "placePrediction": {
        "place": "places/ChIJN1t_tDeuEmsRUsoyG83frY4",
        "placeId": "ChIJN1t_tDeuEmsRUsoyG83frY4",
        "text": {
          "text": "123 Main Street, New York, NY, USA",
          "matches": [{ "startOffset": 0, "endOffset": 14 }]
        },
        "structuredFormat": {
          "mainText": {
            "text": "123 Main Street",
            "matches": [{ "startOffset": 0, "endOffset": 14 }]
          },
          "secondaryText": { "text": "New York, NY, USA" }
        },
        "types": ["street_address", "geocode"],
        "distanceMeters": 120
      }
    },
    {
      "queryPrediction": {   // only if includeQueryPredictions: true
        "text": { "text": "123 Main Street restaurants" },
        "framing": { ... }
      }
    }
  ]
}
```

---

## Session Token Management

Generate one UUID per user search session. Reuse across all keystrokes in that session.
After user selects a prediction and you call Place Details, the session ends — generate a new
token for the next search.

```typescript
import { randomUUID } from 'crypto';

class AutocompleteSession {
  private token: string;

  constructor() {
    this.token = randomUUID();
  }

  getToken(): string {
    return this.token;
  }

  // Call after user selects a result and you've fetched Place Details
  reset(): void {
    this.token = randomUUID();
  }
}
```

---

## Pizza Ordering Use Case

Autocomplete is most useful for:

1. **Delivery address input** — user types their address, you suggest and validate it.
   After selection, use Place Details or Geocoding to get lat/lng.

2. **Restaurant name search** — user types a restaurant name, you suggest matching
   establishments near them.

For Wave 00 (MVP), autocomplete may be overkill — the agent handles address parsing.
But for a UI where users type their address, it significantly improves UX.

### Recommended: Skip Autocomplete for Wave 00

For agent-driven ordering (the current architecture), you receive the full address string
from the user's message. Run it through the **Geocoding API** directly rather than
Autocomplete. Autocomplete is designed for search-as-you-type UIs.

Geocoding API endpoint (not in this reference set but needed):
```
GET https://maps.googleapis.com/maps/api/geocode/json
  ?address=123+Main+St+New+York+NY
  &key=YOUR_API_KEY
```
Returns `geometry.location.lat` + `geometry.location.lng`.
