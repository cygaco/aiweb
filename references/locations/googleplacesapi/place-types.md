# Google Places API — Place Types

Source: https://developers.google.com/maps/documentation/places/web-service/supported_types
Last reviewed: knowledge cutoff Aug 2025

---

## Overview

Place types are hierarchical tags assigned to places. A place can have multiple types.
Types are used for:
- Filtering search results (`type` / `includedTypes` parameter)
- Categorizing results in responses
- Billing differentiation (not directly, but affects which results appear)

The new API introduced more granular types (Table A) and merged the older category tables.

---

## Table A — Primary Types (New API, Granular)

These are the most specific types. The new API supports these in `includedTypes` and
`excludedTypes`. The legacy API does not support all of these in the `type` filter.

### Food & Restaurant Types Relevant to Pizza Ordering

| Type | Description | Relevant? |
|---|---|---|
| `pizza_restaurant` | Pizza-focused restaurant | **PRIMARY** — use this first |
| `restaurant` | General restaurant | Yes — fallback |
| `meal_delivery` | Delivery-focused food service | Yes — delivery context |
| `meal_takeaway` | Takeaway food service | Yes — pickup context |
| `fast_food_restaurant` | Fast food | Marginal |
| `italian_restaurant` | Italian cuisine | Yes — often serves pizza |
| `food` | General food establishment | Broad fallback |
| `store` | Retail store | No |
| `bakery` | Bakery | No |
| `cafe` | Cafe | No |

### Full Food-Related Type List (Table A, New API)

```
american_restaurant
bakery
bar
bar_and_grill
barbecue_restaurant
brazilian_restaurant
breakfast_restaurant
brunch_restaurant
cafe
chinese_restaurant
coffee_shop
fast_food_restaurant
french_restaurant
greek_restaurant
hamburger_restaurant
ice_cream_shop
indian_restaurant
indonesian_restaurant
italian_restaurant
japanese_restaurant
korean_restaurant
lebanese_restaurant
meal_delivery
meal_takeaway
mediterranean_restaurant
mexican_restaurant
middle_eastern_restaurant
pizza_restaurant          ← PRIMARY for this project
ramen_restaurant
restaurant                ← FALLBACK
sandwich_shop
seafood_restaurant
spanish_restaurant
steak_house
sushi_restaurant
thai_restaurant
turkish_restaurant
vegan_restaurant
vegetarian_restaurant
vietnamese_restaurant
```

---

## Table B — Legacy Type Categories

These are the types used in the legacy API `type` parameter and returned in `types` arrays.

### Food & Dining

| Type | Description |
|---|---|
| `restaurant` | General restaurant |
| `food` | Food establishment (broad) |
| `meal_delivery` | Delivery service |
| `meal_takeaway` | Takeaway service |
| `bakery` | Bakery |
| `bar` | Bar |
| `cafe` | Cafe |
| `night_club` | Night club |

> Note: `pizza_restaurant` exists in Table A (new API) but NOT in the legacy `type` filter.
> For legacy API, use `type=restaurant` + `keyword=pizza`.

### Point of Interest Categories

| Type | Description |
|---|---|
| `point_of_interest` | Generic POI (almost all businesses have this) |
| `establishment` | Business establishment (almost all businesses have this) |
| `store` | Retail store |

---

## How Types Appear in Results

A typical pizza restaurant will have these types in the response:
```json
"types": [
  "pizza_restaurant",
  "restaurant",
  "food",
  "point_of_interest",
  "establishment"
]
```

The new API also adds `primaryType`:
```json
"primaryType": "pizza_restaurant",
"primaryTypeDisplayName": { "text": "Pizza restaurant", "languageCode": "en" }
```

---

## Using Types for Search — Recommendations

### New API (Recommended Strategy)

**Option 1 — Strict pizza:**
```json
"includedPrimaryTypes": ["pizza_restaurant"]
```
Returns only places whose primary type is pizza_restaurant.
Might miss pizzerias categorized as "italian_restaurant" or "restaurant".

**Option 2 — Broad pizza:**
```json
"includedTypes": ["pizza_restaurant", "italian_restaurant", "meal_delivery"]
```
Returns places that have ANY of these types. More results, more noise.

**Option 3 — Hybrid (recommended):**
```json
"includedTypes": ["pizza_restaurant", "restaurant"],
```
Then filter client-side: keep results where `types` contains `pizza_restaurant` OR
`primaryType` is `pizza_restaurant` OR `displayName.text` contains "pizza".

### Legacy API Strategy
```
type=restaurant&keyword=pizza
```
`type` must be a single Table B value. `keyword=pizza` matches the name and content.
This is the most reliable approach for the legacy API.

---

## Type Filtering Logic for Pizza Ordering

```typescript
// New API — check if result is pizza-relevant
function isPizzaRelevant(place: Place): boolean {
  const pizzaTypes = ['pizza_restaurant', 'italian_restaurant', 'meal_delivery', 'meal_takeaway'];
  return (
    place.primaryType === 'pizza_restaurant' ||
    place.types?.some(t => pizzaTypes.includes(t)) ||
    place.displayName?.text?.toLowerCase().includes('pizza')
  );
}

// Legacy API — check response types
function isPizzaRelevantLegacy(place: LegacyPlace): boolean {
  return (
    place.types?.includes('restaurant') &&
    (place.name?.toLowerCase().includes('pizza') ||
     place.types?.includes('meal_delivery') ||
     place.types?.includes('meal_takeaway'))
  );
}
```

---

## Other Useful Place Types (Non-Food)

For future reference if expanding The AI Web beyond pizza:

| Category | Types |
|---|---|
| Shopping | `supermarket`, `convenience_store`, `department_store`, `clothing_store`, `electronics_store` |
| Health | `pharmacy`, `doctor`, `hospital`, `dentist` |
| Services | `laundry`, `car_wash`, `car_repair`, `locksmith`, `plumber` |
| Transport | `gas_station`, `parking`, `bus_station`, `train_station` |
| Entertainment | `movie_theater`, `bowling_alley`, `gym`, `spa` |

---

## Notes on Type Completeness

- Not all pizza places are tagged `pizza_restaurant` — some are `restaurant` only.
- Especially in smaller cities/countries, type tagging is inconsistent.
- Always supplement type filtering with keyword matching on the name.
- Google Updates types periodically; check for new types in Table A each quarter.
