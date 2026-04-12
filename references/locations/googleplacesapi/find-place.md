# Google Places API — Find Place

Source: https://developers.google.com/maps/documentation/places/web-service/find-place

---

## Overview

Find Place takes a text input (business name, address, or phone number) and returns a single
place match. Unlike Text Search, it returns one result by design. Use it when you know the
specific place you're looking for.

**Use cases:**
- User types a specific restaurant name: "Joe's Pizza on Bleecker St"
- Looking up a known chain location by name + city
- Converting a business name to a Place ID

For pizza ordering: useful if the user already knows which restaurant they want.

---

## Legacy Find Place

### Endpoint
```
GET https://maps.googleapis.com/maps/api/place/findplacefromtext/json
```

### Required Parameters

| Parameter | Type | Description |
|---|---|---|
| `key` | string | Your API key |
| `input` | string | The text input — name, address, or phone number |
| `inputtype` | string | `textquery` or `phonenumber` |

### Optional Parameters

| Parameter | Type | Description |
|---|---|---|
| `fields` | string | Comma-separated fields to return (billing-tier-dependent) |
| `language` | string | BCP-47 language code |
| `locationbias` | string | Bias results toward location. See formats below |

### locationbias Formats

```
ipbias                                  — bias toward requester's IP
point:lat,lng                           — bias toward point
circle:radius@lat,lng                   — bias within circle (radius in meters)
rectangle:south,west|north,east        — bias within rectangle
```

### Request Example
```
GET https://maps.googleapis.com/maps/api/place/findplacefromtext/json
  ?input=Joe%27s+Pizza+New+York
  &inputtype=textquery
  &fields=name,formatted_phone_number,formatted_address,opening_hours,place_id,rating,business_status
  &locationbias=circle:3000@40.7128,-74.0060
  &key=YOUR_API_KEY
```

### Response Structure
```json
{
  "status": "OK",
  "candidates": [
    {
      "name": "Joe's Pizza",
      "place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
      "formatted_address": "123 Main St, New York, NY 10001, USA",
      "formatted_phone_number": "(212) 555-0100",
      "rating": 4.5,
      "business_status": "OPERATIONAL",
      "opening_hours": {
        "open_now": true
      }
    }
  ],
  "html_attributions": []
}
```

Note: `candidates` is an array but Find Place is designed to return a single best match.
Always take `candidates[0]`.

### Fields (same billing tiers as Place Details)

**Basic fields:**
```
business_status, formatted_address, geometry, icon, icon_background_color,
icon_mask_base_uri, name, permanently_closed, photos, place_id, plus_code, types
```

**Contact fields (Contact Data SKU):**
```
formatted_phone_number, international_phone_number, opening_hours, website
```

**Atmosphere fields (Atmosphere Data SKU):**
```
price_level, rating, user_ratings_total
```

### Pricing
Same as Place Details: depends on fields requested.
- Basic only: included in base cost (~$0.017/1,000)
- + Contact: +$3.00/1,000
- + Atmosphere: +$5.00/1,000

---

## New API Equivalent

The new API does not have a direct Find Place endpoint. Use Text Search instead:

```json
POST https://places.googleapis.com/v1/places:searchText
Headers:
  X-Goog-FieldMask: places.id,places.displayName,places.nationalPhoneNumber,places.formattedAddress,places.regularOpeningHours,places.businessStatus

Body:
{
  "textQuery": "Joe's Pizza New York",
  "maxResultCount": 1,
  "locationBias": {
    "circle": {
      "center": { "latitude": 40.7128, "longitude": -74.0060 },
      "radius": 3000.0
    }
  }
}
```

Take `places[0]` from the response.

---

## Pizza Ordering Use Case

Find Place is useful as a **fallback** when:
1. User explicitly names a restaurant: "Order from Domino's on 5th Ave"
2. Nearby Search didn't return the specific place they want
3. User wants to verify a specific location before ordering

```typescript
// Example: user says "order from [specific restaurant name]"
async function findSpecificRestaurant(
  restaurantName: string,
  lat: number,
  lng: number,
  apiKey: string
) {
  const url = new URL(
    'https://maps.googleapis.com/maps/api/place/findplacefromtext/json'
  );
  url.searchParams.set('input', restaurantName);
  url.searchParams.set('inputtype', 'textquery');
  url.searchParams.set(
    'fields',
    'name,place_id,formatted_phone_number,formatted_address,opening_hours,business_status,rating'
  );
  url.searchParams.set('locationbias', `circle:5000@${lat},${lng}`);
  url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString());
  const data = await res.json();
  return data.candidates?.[0] ?? null;
}
```
