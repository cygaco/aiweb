# Google Places API — Place Photos

Source: https://developers.google.com/maps/documentation/places/web-service/place-photos

---

## Overview

Place Photos returns actual image data for a place. Photos are referenced by `photo_reference`
(legacy) or `photo.name` (new API) from search/details responses.

**Relevance for pizza ordering:** Low priority for Wave 00. Photos could be useful for
showing restaurant thumbnails in the results list, but not required for core ordering flow.

---

## Legacy Place Photos

### Endpoint
```
GET https://maps.googleapis.com/maps/api/place/photo
```

### Required Parameters

| Parameter | Type | Description |
|---|---|---|
| `key` | string | Your API key |
| `photoreference` | string | Photo reference from search/details response |
| `maxwidth` | integer | Max width in pixels (1–1600). Use this OR maxheight. |

### Optional Parameters

| Parameter | Type | Description |
|---|---|---|
| `maxheight` | integer | Max height in pixels (1–1600) |

### Request Example
```
GET https://maps.googleapis.com/maps/api/place/photo
  ?photoreference=AelY_CvB0GZ7VPCUcNFjCQ5XQSP...
  &maxwidth=400
  &key=YOUR_API_KEY
```

Returns: HTTP redirect to the actual image file (JPEG).
Or the image directly depending on client behavior.

### Getting Photo References
Photo references come from `photos[].photo_reference` in search/details responses:
```json
"photos": [
  {
    "photo_reference": "AelY_CvB0GZ7VPCUcNFjCQ...",
    "height": 400,
    "width": 600,
    "html_attributions": ["<a href='...'>Contributor Name</a>"]
  }
]
```

### Attribution Requirement
Always display `html_attributions` alongside the photo. Required by Google TOS.

### Pricing
$7.00 per 1,000 requests (Places - Photo SKU).

---

## New API — Place Photos

### Endpoint
```
GET https://places.googleapis.com/v1/{photo_name}/media
```

Where `{photo_name}` is the full resource name from `photos[].name` in a place response.

Format: `places/{place_id}/photos/{photo_id}`

### Query Parameters

| Parameter | Type | Description |
|---|---|---|
| `maxWidthPx` | integer | Max width in pixels (1–4800) |
| `maxHeightPx` | integer | Max height in pixels (1–4800) |
| `skipHttpRedirect` | boolean | If true, returns JSON with `photoUri` instead of redirect |

Either `maxWidthPx` or `maxHeightPx` is required.

### Request Example
```
GET https://places.googleapis.com/v1/places/ChIJN1t.../photos/AUc7tXkV.../media
  ?maxWidthPx=400
  &key=YOUR_API_KEY
```

### With skipHttpRedirect (get URL without following redirect)
```
GET https://places.googleapis.com/v1/places/ChIJN1t.../photos/AUc7tXkV.../media
  ?maxWidthPx=400
  &skipHttpRedirect=true
  &key=YOUR_API_KEY
```

Response:
```json
{
  "name": "places/ChIJN1t.../photos/AUc7tXkV...",
  "photoUri": "https://lh3.googleusercontent.com/places/..."
}
```

### Getting Photo Names (New API)
From a search or details response with `places.photos` in field mask:
```json
"photos": [
  {
    "name": "places/ChIJN1t_tDeuEmsRUsoyG83frY4/photos/AUc7tXkVn...",
    "widthPx": 600,
    "heightPx": 400,
    "authorAttributions": [
      {
        "displayName": "Contributor Name",
        "uri": "https://maps.google.com/maps/contrib/...",
        "photoUri": "https://lh3.googleusercontent.com/..."
      }
    ]
  }
]
```

---

## Pizza Ordering — Photo Strategy

Photos are not required for Wave 00. If implementing in a future wave:

1. Include `places.photos` in field mask during search.
2. Take `photos[0]` (first/primary photo).
3. Use `skipHttpRedirect=true` to get a stable URL you can embed.
4. Display with attribution.

Keep photo requests to 1 per restaurant shown, not bulk-fetching all.
