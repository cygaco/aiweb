# Google Places API — Overview

Source: https://developers.google.com/maps/documentation/places/web-service/overview
Last reviewed: 2025 (knowledge cutoff Aug 2025)

---

## Two Parallel APIs

Google currently maintains **two versions** of the Places API. Both are live. The legacy API
is not deprecated as of mid-2025 but Google strongly recommends migrating to the new API for
new projects.

| | Legacy Places API | Places API (New) |
|---|---|---|
| Base URL | `https://maps.googleapis.com/maps/api/place/` | `https://places.googleapis.com/v1/` |
| Auth | `?key=API_KEY` query param | `X-Goog-Api-Key` header (preferred) or query param |
| Response format | JSON (legacy schema) | JSON (new schema, proto3-aligned) |
| Field selection | `fields` param (Place Details only) | `X-Goog-FieldMask` header on ALL requests |
| Pagination | `pagetoken` | `pageToken` in response body |
| SDK support | Maps JavaScript SDK, legacy client libs | New client libs (Node, Python, Go, Java, etc.) |
| Pricing model | Per-call SKUs | Per-call SKUs, field-mask-based billing |
| GA status | Generally Available | Generally Available (since Nov 2023) |

**For new builds: use the new API.** Field masks on every call mean you only pay for what you
request. This is especially important for high-volume use cases.

---

## Authentication

### API Key (both versions)

1. Create a project in Google Cloud Console.
2. Enable the **Places API** (legacy) and/or **Places API (New)**.
3. Create an API key under APIs & Services > Credentials.
4. Restrict the key: HTTP referrers or IP addresses, and restrict to the Places API.

**Legacy — query param:**
```
GET https://maps.googleapis.com/maps/api/place/nearbysearch/json
  ?location=37.7749,-122.4194
  &radius=1500
  &type=restaurant
  &key=YOUR_API_KEY
```

**New API — header (preferred):**
```
POST https://places.googleapis.com/v1/places:searchNearby
Headers:
  Content-Type: application/json
  X-Goog-Api-Key: YOUR_API_KEY
  X-Goog-FieldMask: places.displayName,places.formattedAddress,places.nationalPhoneNumber
```

---

## Key Concepts

### Place ID
A stable, unique textual identifier for a place. Use it to retrieve full details.
Format: `ChIJN1t_tDeuEmsRUsoyG83frY4`
Place IDs can change rarely. Refresh them periodically for stored data.

### Field Masks (New API)
Every request to the new API requires an `X-Goog-FieldMask` header specifying which fields
to return. This controls both cost and bandwidth.
- Wildcard `*` returns all fields but bills at the highest tier.
- For pizza ordering: `places.displayName,places.nationalPhoneNumber,places.formattedAddress,places.regularOpeningHours,places.rating,places.types,places.id`

### Sessions (Autocomplete)
Autocomplete requests use session tokens to bundle keystrokes + one Place Details call
into a single billed session. Critical for cost control if building search-as-you-type.

---

## Endpoints Summary

### Legacy API

| Endpoint | Method | Purpose |
|---|---|---|
| `/nearbysearch/json` | GET | Find places within a radius of a location |
| `/textsearch/json` | GET | Find places matching a text query |
| `/findplacefromtext/json` | GET | Find a single place from a text input |
| `/details/json` | GET | Full details for a Place ID |
| `/autocomplete/json` | GET | Autocomplete text input |
| `/queryautocomplete/json` | GET | Autocomplete for arbitrary queries |
| `/photo` | GET | Retrieve a place photo |

### New API (v1)

| Endpoint | Method | Purpose |
|---|---|---|
| `/places:searchNearby` | POST | Find places within a radius |
| `/places:searchText` | POST | Find places matching text query |
| `/places/{place_id}` | GET | Full details for a place |
| `/places:autocomplete` | POST | Autocomplete text input |
| `/places/{place_id}/photos/{photo_ref}/media` | GET | Retrieve photo |

---

## Rate Limits & Quotas

Default quotas per project (as of 2025; verify in Cloud Console):

| Metric | Default Limit |
|---|---|
| Requests per day | 150,000 (can be raised) |
| Requests per minute | 3,000 (QPM) |
| Requests per second (per user) | No hard limit, but burst throttled |

Rate limit errors return HTTP `429`. Implement exponential backoff.

---

## For Pizza Ordering (This Project)

**Recommended flow:**

1. `searchNearby` (new API) or `nearbysearch` (legacy) — find pizza restaurants near address.
2. Filter by `type: pizza_restaurant` or `restaurant` + keyword `pizza`.
3. For each result, check if `nationalPhoneNumber` / `formatted_phone_number` is present.
4. If phone number is missing from search results, call Place Details with `fields=formatted_phone_number`.
5. Check `regularOpeningHours` / `opening_hours` to confirm restaurant is open.
6. Pass phone number to Bland.ai for the voice call.

**Critical note:** `formatted_phone_number` is NOT returned in Nearby Search results by default.
You must either use Place Details or include it in the field mask (new API only).

---

## Useful Links

- Legacy API reference: https://developers.google.com/maps/documentation/places/web-service/search
- New API reference: https://developers.google.com/maps/documentation/places/web-service/op-overview
- Pricing: https://developers.google.com/maps/documentation/places/web-service/usage-and-billing
- Cloud Console: https://console.cloud.google.com/
