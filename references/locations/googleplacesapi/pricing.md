# Google Places API — Usage and Billing

Source: https://developers.google.com/maps/documentation/places/web-service/usage-and-billing
Last reviewed: knowledge cutoff Aug 2025

---

## Free Tier

Google provides a **$200 USD monthly credit** per billing account. This is applied
automatically before charging begins.

At $0.017/request for Nearby Search, $200 covers ~11,765 requests per month free.
For a pizza ordering MVP, this is likely sufficient for early testing and low-volume production.

**Important:** The $200 credit is per billing account (Google Cloud project linked to billing),
not per API. It covers all Maps Platform usage.

---

## Billing Model

Billed per API call (request). For the new Places API (v1), billing also depends on which
fields are requested via field masks — some field groups cost more than others.

All prices are in USD. Prices are for the **pay-as-you-go** model after free tier is exhausted.

---

## Legacy Places API — SKU Pricing

### Search SKUs

| SKU | Endpoint | Price per 1,000 calls |
|---|---|---|
| Places - Nearby Search | `/nearbysearch` | $17.00 |
| Places - Text Search | `/textsearch` | $17.00 |
| Places - Find Place | `/findplacefromtext` | $17.00 |
| Places - Query Autocomplete | `/queryautocomplete` | $2.83 |
| Places - Autocomplete - Per Session | Session bundle | $17.00 |
| Places - Autocomplete - Per Request | `/autocomplete` (without session) | $2.83 |

### Details SKUs (tiered by fields requested)

| SKU | Fields | Price per 1,000 calls |
|---|---|---|
| Places - Basic Data | Basic fields (name, address, geometry, etc.) | $0.00 (free with search) |
| Places - Contact Data | `formatted_phone_number`, `international_phone_number`, `opening_hours`, `website` | $3.00 |
| Places - Atmosphere Data | `price_level`, `rating`, `reviews`, `user_ratings_total` | $5.00 |

**Legacy Place Details total cost examples:**

| Fields Requested | Cost per 1,000 calls |
|---|---|
| Basic only (name, address) | $0.00 (when preceded by a search) |
| + phone + hours | $3.00 |
| + phone + hours + rating + reviews | $8.00 |

> Note: Place Details Basic fields are billed at $0 when called after a search. If called
> standalone (directly by Place ID without a prior search), Basic may be billed.

---

## New Places API (v1) — SKU Pricing

The new API uses field-mask-based billing. Fields are grouped into tiers, and you're billed
for the highest tier of field you request.

### Nearby Search (New)

| SKU | Field Mask Triggers | Price per 1,000 calls |
|---|---|---|
| Nearby Search - Basic | `places.id`, `places.displayName`, `places.types`, `places.businessStatus`, `places.location`, `places.formattedAddress`, `places.plusCode`, `places.viewport`, `places.rating`, `places.userRatingCount`, `places.priceLevel`, `places.regularOpeningHours`, `places.photos`, `places.primaryType`, `places.primaryTypeDisplayName` | $17.00 |
| Nearby Search - Advanced | + `places.currentOpeningHours`, `places.secondaryOpeningHours`, `places.editorialSummary`, `places.servesBeer`, `places.servesBreakfast`, etc. | $17.00 + upgrade |
| Nearby Search - Preferred | + `places.nationalPhoneNumber`, `places.internationalPhoneNumber`, `places.websiteUri` | $17.00 + $3.00 contact = ~$20.00 |

> Simplified view: requesting `places.nationalPhoneNumber` in a Nearby Search costs
> approximately **$0.020 per call** (Basic + Contact Data).

### Text Search (New)

| SKU | Field Mask | Price per 1,000 calls |
|---|---|---|
| Text Search - Basic | Basic fields only | $17.00 |
| Text Search - Advanced | Basic + advanced fields | higher tier |
| Text Search - Preferred | Includes phone/website | ~$20.00 |

### Place Details (New) — Get Place

| SKU | Field Mask | Price per 1,000 calls |
|---|---|---|
| Place Details - Basic | Basic fields | $5.00 |
| Place Details - Contact | + phone, website | $5.00 + $3.00 = $8.00 |
| Place Details - Atmosphere | + reviews, editorial | $5.00 + $5.00 = $10.00 |

---

## Per-Call Cost Summary (Pizza Ordering Use Case)

### Recommended: New API — Single searchNearby with phone in field mask
```
$0.020 per call (Basic + Contact Data tier)
= $20.00 per 1,000 calls
```
Includes: name, address, phone, hours, rating, types, business status.
One call → everything needed. No follow-up needed.

### Legacy: nearbysearch + place details for phone
```
Search:  $0.017 per call
Details: $0.008 per call (Basic + Contact)
Total:   $0.025 per call (for each restaurant you want the phone of)
```
If you fetch details for top 3 results: $0.017 + 3 × $0.008 = $0.041 per user query.

### Cost Comparison for 10,000 orders/month

| Approach | Cost |
|---|---|
| New API (1 searchNearby, field mask with phone) | $200 = covered by free tier |
| Legacy (1 search + 3 details) | $410 — exceeds free tier by $210 |

**Verdict: New API is 2x cheaper for this use case.**

---

## Free Tier Coverage

At the $200/month credit:

| Approach | Free Requests/Month |
|---|---|
| New API searchNearby (with phone) | ~10,000 |
| Legacy nearbysearch only | ~11,765 |
| Legacy search + 3 details | ~4,878 |

For MVP (< 1,000 orders/month), both approaches are free.

---

## Billing Setup Checklist

1. Create Google Cloud project.
2. Enable billing account with credit card.
3. Enable APIs:
   - "Places API" (for legacy endpoints)
   - "Places API (New)" (for v1 endpoints)
   - "Geocoding API" (if geocoding user addresses)
4. Create API key, restrict to these APIs + your server IP.
5. Set budget alert at $50 and $200 in Cloud Console (Billing > Budgets).
6. Monitor usage in Cloud Console > APIs & Services > Dashboard.

---

## Rate Limits

| Limit | Value |
|---|---|
| Requests per second (burst) | ~50 QPS (soft limit) |
| Requests per minute | 3,000 QPM |
| Requests per day | 150,000 (default; can request increase) |

Rate limit response: HTTP 429 with `OVER_QUERY_LIMIT` in body.
Implement exponential backoff: 1s, 2s, 4s, 8s.

---

## Cost Reduction Tips

1. **Cache results.** If user searches for pizza near same address twice, cache for 24h.
   Google TOS allows caching up to 30 days for Place IDs, shorter for other data.
2. **Minimal field mask.** Only request fields you actually use.
3. **Batch details calls.** Don't call Place Details for all 20 results — only top 3–5.
4. **Skip details if phone is in search result.** With new API + proper field mask, phone
   is already in the Nearby Search response.
5. **Monitor the $200 credit.** Set budget alerts before exceeding free tier.
6. **Use Autocomplete sessions.** Per-session billing is much cheaper than per-keystroke
   if implementing search-as-you-type.

---

## Important TOS Notes

- **Do not cache Place IDs forever.** Google recommends refreshing Place IDs periodically.
- **Do not display Places data without Google attribution.** "Powered by Google" logo required.
- **Do not use Places data to build a competing mapping product.**
- **Do not scrape or bulk-download.** Use the API as intended for live queries.
