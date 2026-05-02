# Pizza Chain Menu Samples

> Manual research spike, 2026-05-02. Source: public ordering UIs and menu pages.
> Goal: ground the cart/menu schema in real-world ontology.
>
> Caveat: Direct chain ordering pages (dominos.com/en/menu, pizzahut.com/menu, papajohns.com/order/menu) are gated behind store-locator selection and refuse to render full price detail without a stored location. Where direct fetches failed, we cited third-party menu aggregators (menuwithprice.org, dominosnutritioncalculator.us, papajohnmenu.com, pizzahutmenu.com, slicepizzeria.com) which mirror chain catalog structure. Prices below are representative national averages, not contractual.

---

## Domino's

### Crusts
Six crust types. Crust is a free choice for the standard four (no upcharge), but premium crusts add a flat delta. Size availability varies by crust.

| Crust | Sizes | Upcharge |
|---|---|---|
| Hand Tossed | Small 10", Medium 12", Large 14", X-Large 16" | none (default) |
| Crunchy Thin | Medium, Large | none |
| Handmade Pan | Medium only | flat upcharge (~$1–2) |
| Brooklyn Style | Large, X-Large | none |
| Parmesan Stuffed Crust | Large only | flat upcharge (~$2–3) |
| Gluten Free | Small only | flat upcharge (~$3) |

Domino's footer disclaimer explicitly calls out: *"Parmesan Stuffed Crust and Pan Pizza are extra."* Sources: [dominos.com/en/menu](https://www.dominos.com/en/menu), [unclealspizza.com/dominos-pizza-toppings-list](https://www.unclealspizza.com/dominos-pizza-toppings-list/).

### Toppings
Flat per-topping fee (no meat-vs-veggie tier). Each topping has three placement choices (whole / left / right) and three intensity choices (normal / extra / double). Extra/double bumps the fee.

- **Meats:** Pepperoni, Italian Sausage, Beef, Premium Chicken, Bacon, Ham, Philly Steak, Salami, Anchovies, Chicken (grilled)
- **Veggies:** Mushrooms, Onions, Green Peppers, Banana Peppers, Black Olives, Green Olives, Jalapeño Peppers, Pineapple, Spinach, Roasted Red Peppers, Diced Tomatoes
- **Cheese (as topping):** Cheddar, Feta, Shredded Provolone, Shredded Parmesan-Asiago

Cheese base is mozzarella by default with `none / light / normal / extra / double` amount choice.

Source: [unclealspizza.com Domino's toppings list](https://www.unclealspizza.com/dominos-pizza-toppings-list/), [chowhound.com Domino's review](https://www.chowhound.com/1761744/dominos-best-pizza-order/).

### Sauces / cheese
Base sauce is a free choice (no upcharge). Cheese amount is a free choice.

- **Sauces:** Robust Inspired Tomato (default), Hearty Marinara, Honey BBQ, Garlic Parmesan White, Alfredo, None
- **Sauce amount:** light / normal / extra
- **Cheese amount:** none / light / normal / extra / double

### Dipping sauces
Sold as separate SKUs at $0.79 each (some run $0.99). Not bundled with pizza by default.

- Garlic Dipping Sauce
- Ranch
- Marinara
- Hot Buffalo
- Honey BBQ
- Blue Cheese
- Sweet Mango Habanero (paired with wings)
- Kicker Hot Sauce (with sandwiches)
- Icing (with desserts) — bundled free with cinnamon twists

Sources: [dominosnutritioncalculator.us/dominos-menu](https://dominosnutritioncalculator.us/dominos-menu/), [dominos.com/en/menu/sauces](https://www.dominos.com/en/menu/sauces).

### Drinks
20oz bottles ~$2.49–$2.79; 2L bottles ~$3.99. All Coca-Cola products.

| Drink | Sizes |
|---|---|
| Coke | 20oz, 2L |
| Diet Coke | 20oz, 2L |
| Coke Zero Sugar | 20oz, 2L |
| Sprite | 20oz, 2L |
| Fanta Orange | 20oz |
| Dasani Water | 20oz |

Source: [dominos.com/en/menu/drinks](https://www.dominos.com/en/menu/drinks).

### Sides
- **Wings:** 8pc / 16pc / Boneless 8pc / 16pc — flavors: Plain, Hot Buffalo, Mild Buffalo, BBQ, Sweet Mango Habanero, Garlic Parmesan ($11.39 starting)
- **Breads:** Stuffed Cheesy Bread (plain / spinach&feta / bacon&jalapeño), Parmesan Bread Twists, Garlic Bread Twists, Cinnamon Bread Twists
- **Loaded Tots:** Philly Cheese Steak, Buffalo Chicken, Cheddar Bacon ($9.09)
- **Sandwiches:** Italian, Philly, Chicken Bacon Ranch, Buffalo Chicken, Chicken Habanero ($10.29) — all 8" hoagie
- **Pasta:** Italian Sausage Marinara, Chicken Alfredo, Chicken Carbonara, Pasta Primavera, Build Your Own — served in dish or bread bowl
- **Salads:** Classic Garden, Chicken Caesar
- **Desserts:** Marbled Cookie Brownie, Cinnamon Bread Twists, Lava Cakes (2-pack)

Source: [menuwithprice.org/dominos](https://menuwithprice.org/dominos/), [dominosnutritioncalculator.us](https://dominosnutritioncalculator.us/dominos-menu/).

### Deals
Domino's deal taxonomy is dominated by mix-and-match and combo bundles. All deals are coupon-code-driven on the website.

| Deal | Structure | Price |
|---|---|---|
| Mix & Match | Pick any 2+ items from {medium 2-topping pizza, 8pc wings, sandwich, pasta, salad, bread, dessert, 2L drink} | $6.99 each |
| Perfect Combo | 2 medium 1-topping pizzas + 16pc Parmesan bread bites + 8pc cinnamon twists + 2L soda | $19.99 fixed |
| Carryout Special | Any 3-topping pizza, carryout only | $7.99 |
| 50% Off Pizza | Any pizza at menu price, applied at order level | 50% discount |
| App-First-Order | New app users | 50% off first 3 orders |

Source: [dominos.com/en/deals/9226 Perfect Combo](https://www.dominos.com/en/deals/9226), [eatdrinkdeals.com](https://www.eatdrinkdeals.com/dominos-pizza-coupons-specials-2/).

### Address capture
Structured fields — Domino's stores parse address into discrete tokens because their delivery routing depends on it.

- **Street Address** (line 1, required)
- **Apt/Suite/Unit** (line 2, optional but flagged for apartment buildings)
- **City** (required)
- **State** (required, dropdown)
- **ZIP** (required, 5-digit; drives store routing)
- **Phone** (required)
- **Delivery Instructions** (free-text, used for gate codes, building entrance, placement)
- **Pinpoint Delivery** (lat/long-only mode for parks/beaches — bypasses street address)

Source: [dominos.com customer-service/faq](https://www.dominos.com/en/pages/content/customer-service/faq), [Domino's Pinpoint Delivery](https://www.dominos.com/pinpoint-delivery/).

### Sample full cart (one real-looking order with everything)
```
Restaurant: Domino's #4521 (123 Main St, Anytown, US)
Items:
  1× Large Hand-Tossed Pizza
     - Sauce: Robust Tomato (normal)
     - Cheese: Mozzarella (extra)
     - Toppings: Pepperoni (whole, normal), Italian Sausage (whole, normal),
                 Mushrooms (left, normal), Banana Peppers (right, normal)
     - Crust upcharge: $0
     Price: $14.99
  1× 8pc Wings — Hot Buffalo
     Price: $11.39
  1× Stuffed Cheesy Bread — Bacon & Jalapeño
     Price: $7.99
  2× Garlic Dipping Sauce
     Price: $1.58 ($0.79 × 2)
  1× 2L Coke
     Price: $3.99
Subtotal: $39.94
Delivery fee: $4.99
Tax: $3.20
Tip (cash on delivery): driver discretion
Total: $48.13
Address: 456 Oak Ave Apt 3B, Anytown, US 12345
Phone: 555-0123
Instructions: "Buzz #3B, leave at door"
Payment: Cash on delivery
```

---

## Pizza Hut

### Crusts
Five active crusts plus seasonal/regional variants. Crust selection drives size availability — Pan and Hand-Tossed cover all sizes; specialty crusts are size-locked.

| Crust | Sizes | Upcharge |
|---|---|---|
| Original Pan | Personal, Medium, Large | none (signature) |
| Hand Tossed | Medium, Large | none |
| Thin N Crispy | Medium, Large | none |
| Original Stuffed Crust | Large only | flat upcharge (~$2–3) |
| Tavern Style (Chicago tavern) | Medium square only | none |
| Big New Yorker | XL only | premium tier |
| Detroit-Style | Rectangular pan only | premium tier |
| Gluten-Free (Udi's) | Small 10" only, select stores | flat upcharge (~$3) |

Source: [pizzahut.com/c/content/stuffed-crust-pizza](https://www.pizzahut.com/c/content/stuffed-crust-pizza), [blog.pizzahut.com tavern-style overhaul](https://blog.pizzahut.com/pizza-hut-unveils-new-chicago-tavern-style-pizza-and-toppings-transformation-with-biggest-toppings-menu-overhaul-in-over-a-decade/).

### Toppings
Flat per-topping fee. June 2024 menu overhaul added 8 new toppings, billed as biggest in 10+ years.

- **Meats:** Pepperoni, Crispy Cupped Pepperoni *(new)*, Italian Sausage, Chicken Sausage *(new)*, Beef, Bacon, Ham, Grilled Chicken, Meatballs, Anchovies
- **Veggies:** Mushrooms, Red Onions, Caramelized Onions *(new)*, Green Peppers, Fire Roasted Peppers *(new)*, Banana Peppers, Jalapeños, Black Olives, Pineapple, Roma Tomatoes, Grape Tomatoes *(new)*, Spinach, Fresh Diced Garlic *(new)*
- **Cheese:** Mozzarella (default base), Extra Cheese, 3-Cheese Blend, Parmesan, Feta

Cheese amount: light / regular / extra. No "none" option for the cheese base on most builds.

Source: [blog.pizzahut.com toppings overhaul](https://blog.pizzahut.com/pizza-hut-unveils-new-chicago-tavern-style-pizza-and-toppings-transformation-with-biggest-toppings-menu-overhaul-in-over-a-decade/), [pizzahutmenu.com](https://pizzahutmenu.com/).

### Sauces / cheese
Multiple base sauces, free choice. Sauce amount: light / regular / extra.

- Classic Marinara (default)
- Spicy Marinara *(new 2024)*
- Pesto Sauce Swirl *(new 2024)*
- Creamy Garlic Parmesan
- BBQ
- Buffalo
- None / Sauceless

### Dipping sauces
Sold separately at $0.89 each (some flavors $0.99). Wings include one dipping sauce free; additional sauces priced.

- Marinara
- Buffalo
- Honey BBQ
- Blue Cheese
- Ranch
- Garlic Dipping Sauce
- Honey Mustard
- Icing (dessert)

Source: [pizzahut.com/menu/dips](https://www.pizzahut.com/menu/dips), [pizzahutmenu.com](https://pizzahutmenu.com/).

### Drinks
Pepsi portfolio. 20oz bottles $2.49–$3.79; 2L bottles ~$3.99.

| Drink | Sizes |
|---|---|
| Pepsi | 20oz, 2L |
| Diet Pepsi | 20oz, 2L |
| Pepsi Zero Sugar | 20oz, 2L |
| Mountain Dew | 20oz, 2L |
| Starry (replaced Sierra Mist 2023) | 20oz, 2L |
| Brisk Iced Tea | 20oz |
| Aquafina Water | 20oz |

### Sides
- **Wings:** Traditional Bone-In, Breaded Boneless — sold in 6/8/10/16/24 counts. Flavors: Buffalo (Mild/Med/Hot), Honey BBQ, Garlic Parmesan, Lemon Pepper, Hawaiian Teriyaki, Cajun, Spicy Garlic, Naked
- **Melts:** Pepperoni Lover's, Buffalo Chicken, Chicken Bacon Parmesan, Meat Lover's ($6.99 each)
- **Breadsticks:** 5pc with marinara ($5.99–$6.99), Cheese Sticks ($6.99–$7.99), Stuffed Garlic Knots
- **Pasta:** Creamy Chicken Alfredo, Meaty Marinara
- **Sides:** Fries (plain or seasoned), Garlic Bread, Roasted Garlic Tomato Basil
- **Desserts:** Cinnamon Sticks (with icing), HERSHEY'S Chocolate Chip Cookie, Ultimate HERSHEY'S Brownie

Source: [pizzahutmenu.com](https://pizzahutmenu.com/), [pizzahutsmenu.com](https://www.pizzahutsmenu.com/).

### Deals
Pizza Hut leans on box deals (multi-component fixed bundles) more than mix-and-match.

| Deal | Structure | Price |
|---|---|---|
| Big Dinner Box | 2 medium 1-topping pizzas + 5 breadsticks + 10 cinnamon sticks | $24.99 (code BIGBOX24) |
| Triple Treat Box | 2 medium 1-topping pizzas + 5 breadsticks OR 1 wings order | $21.99 (code TRIPLE21) |
| $5 Lineup | Pick 2+ from {medium 1-topping, breadsticks, 8 boneless wings, pasta, cookie} | $5 each (code LINEUP5) |
| Large 3-Topping | Any large 3-topping any crust | $12.99 |
| Wings Wednesday | All wings | 50% off |
| Melt Deal | Single melt + drink | $6.99 |

Source: [pizzahutmenu.com](https://pizzahutmenu.com/), [pizzahutsmenu.com deals 2026](https://www.pizzahutsmenu.com/).

### Address capture
Structured fields, similar to Domino's. Apt/Suite is presented as a separate visible field (not buried in instructions).

- **Street Address**
- **Apt/Suite** (separate field)
- **City** (required)
- **State** (required, dropdown)
- **ZIP** (required, 5-digit)
- **Phone** (required)
- **Email** (required for digital order)
- **Special Instructions** (free-text)

Source: [pizzahut.com/faqs](https://www.pizzahut.com/faqs/).

### Sample full cart
```
Restaurant: Pizza Hut #1234 (789 Elm St)
Items:
  1× Large Original Stuffed Crust Pizza
     - Sauce: Classic Marinara (regular)
     - Cheese: Mozzarella (regular) + 3-Cheese Blend
     - Toppings: Crispy Cupped Pepperoni (whole), Italian Sausage (whole),
                 Caramelized Onions (whole)
     - Crust upcharge: $2.50
     Price: $19.49
  1× 8pc Traditional Wings — Garlic Parmesan
     Price: $11.39 (includes 1 free dip)
  1× Cheese Sticks
     Price: $7.99
  1× HERSHEY'S Brownie
     Price: $6.99
  2× Ranch dip
     Price: $1.78 ($0.89 × 2)
  1× 2L Mountain Dew
     Price: $3.99
Subtotal: $51.63
Delivery fee: $5.49
Tax: $4.13
Total: $61.25
Address: 1010 Pine Rd Apt 7, Anytown, US 12345
Phone: 555-0199
Instructions: "Gate code 4321"
Payment: Cash on delivery
```

---

## Papa John's

### Crusts
Six crust types, each with explicit per-size pricing. Stuffed-crust and NY-style command a clear premium tier.

| Crust | Small | Medium | Large | X-Large | Tier |
|---|---|---|---|---|---|
| Original Hand-Tossed | $8.99 | $10.99 | $12.99 | $15.99 | base |
| Thin Crust | $8.99 | $11.09 | $13.00 | $15.99 | base |
| Pan | available | available | available | — | base |
| Epic Stuffed Crust | $12.00 | $15.00 | $17.00 | $22.00 | premium |
| Garlic Epic Stuffed | $12.00 | $14.00 | $17.00 | $22.00 | premium |
| New York Style | $12.49 | $15.49 | $18.29 | $22.29 | premium |
| Gluten-Free | $13.00 | $15.00 | $16.00 | $17.00 | premium |

Source: [papajohnmenu.com](https://www.papajohnmenu.com/).

### Toppings
Tiered pricing by topping count, NOT by meat-vs-veggie. Maximum 10 toppings per pizza. Each topping supports placement (whole / left / right) and amount (normal / extra).

- **Meats:** Pepperoni, Italian Sausage, Spicy Italian Sausage, Beef, Bacon, Ham/Canadian Bacon, Grilled Chicken, Salami, Philly Steak, Meatball, Anchovies
- **Veggies:** Mushrooms, Onions, Green Peppers, Banana Peppers, Jalapeños, Black Olives, Roma Tomatoes, Pineapple, Fresh Spinach
- **Cheese variants:** Mozzarella base (none / light / normal / extra), Extra Mozzarella add-on, 3-Cheese Blend, Parmesan Romano (normal / extra)

Topping pricing (medium example): 0–1 topping included in base; +$1.60 per additional topping.

Source: [slicepizzeria.com/papa-johns-toppings](https://www.slicepizzeria.com/papa-johns-toppings/).

### Sauces / cheese
Five pizza base sauces; choice is free. Sauce amount: normal / light / extra.

- Original Pizza Sauce (default)
- BBQ Sauce
- Buffalo Sauce
- Alfredo Sauce
- Ranch (used as base on some specialty)
- Honey Chipotle (LTO)

Cheese: mozzarella base with `none / light / normal / extra` amount; additional cheese add-ons priced as toppings.

### Dipping sauces
$0.75 each. Cream Cheese Icing for desserts is $0.50.

- Special Garlic Sauce (free with most orders, this is the iconic one)
- Spicy Garlic
- Ranch
- Buffalo
- BBQ
- Cheese Sauce
- Blue Cheese
- Original Pizza Sauce (sold as a dip)
- Honey Chipotle
- Cream Cheese Icing ($0.50)

Source: [papajohnmenu.com](https://www.papajohnmenu.com/), [papajohnsmenu.us/extras](https://papajohnsmenu.us/extras/).

### Drinks
Pepsi portfolio. 20oz bottles ~$2.19; 2L bottles ~$3.19. Smaller drink tax than Pizza Hut.

| Drink | Sizes |
|---|---|
| Pepsi | 20oz, 2L |
| Diet Pepsi | 20oz, 2L |
| Pepsi Zero Sugar | 20oz, 2L |
| Mountain Dew | 20oz, 2L |
| Starry | 20oz, 2L |
| Aquafina | 20oz |

### Sides
- **Wings:** Traditional bone-in, Boneless — sold in 6/8/16/24pc. Flavors: Buffalo, Garlic Parmesan, BBQ, Honey Chipotle, Hot Lemon Pepper
- **Breadsticks:** Original ($6.29–$6.99), Cheesesticks ($7.79), Garlic Knots ($6.99)
- **Papadias:** Flatbread sandwiches — Philly Cheesesteak, Grilled BBQ Chicken & Bacon, Italian, Meatball Pepperoni
- **Papa Bites:** Pepperoni Papa Bites, OREO Cookie Papa Bites ($5.99–$7.99)
- **Pepperoni Rolls** ($6.00)
- **Desserts:** Cinnamon Pull-Aparts, Double Chocolate Brownie, Chocolate Chip Cookie

Source: [papajohnmenu.com](https://www.papajohnmenu.com/), [godairyfree.org papa johns](https://godairyfree.org/dining-out/fast-food-restaurants/papa-johns).

### Deals
Papa John's deal language is "Papa Pairings" (their mix-and-match analog).

| Deal | Structure | Price |
|---|---|---|
| Papa Pairings | Pick 2+ from {medium 1-topping NY/Original pizza, wings, Papadia, breadsticks, cheesesticks, garlic knots, dessert} | $6.99 each (some markets $7.99) |
| 2-Large 1-Topping | 2× large 1-topping pizzas | $9.99 each |
| BOGO Large | Buy any large 1-topping at menu price, get a 2nd free | bundled discount |
| Papa Rewards | Loyalty: 1 point per $5 spent, 75 points = free pizza | n/a |
| App-only deal | New users | 50% off first order |

Source: [eatdrinkdeals.com Papa Johns](https://www.eatdrinkdeals.com/papa-johns-specials-deals/), [hip2save.com Papa Johns BOGO](https://hip2save.com/deals/papa-johns-coupons/).

### Address capture
Structured fields. Papa John's online flow asks for delivery instructions in a multi-step checkout (address first, then a separate "drop-off notes" step before payment).

- **Street Address**
- **Apt/Suite/Unit** (separate field, not required)
- **City**
- **State** (dropdown)
- **ZIP** (5-digit; routes to nearest store)
- **Phone**
- **Email**
- **Delivery Instructions / Drop-off Notes** (free-text)

Source: [papajohns.com order flow](https://www.papajohns.com/) (inferred via FAQ; direct fetch returned WD-NS error).

### Sample full cart
```
Restaurant: Papa John's #5678 (321 Maple Ave)
Items:
  1× Large Original Hand-Tossed Pizza
     - Sauce: Original Pizza Sauce (normal)
     - Cheese: Mozzarella (normal)
     - Toppings: Pepperoni (whole, normal), Italian Sausage (whole, normal),
                 Mushrooms (whole, normal), Banana Peppers (whole, normal)
     - Crust price: $12.99
     - Topping upcharge: 3 extra × $1.60 = $4.80
     Price: $17.79
  1× Large Epic Stuffed Crust — Pepperoni
     - Crust price: $17.00
     Price: $17.00
  1× 8pc Traditional Wings — Honey Chipotle
     Price: $10.99
  1× Garlic Knots
     Price: $6.99
  3× Special Garlic dip ($0.75 ea)
     Price: $2.25
  1× Double Chocolate Brownie
     Price: $7.29
  1× 2L Pepsi
     Price: $3.19
Subtotal: $65.50
Delivery fee: $4.99
Tax: $5.24
Total: $75.73
Address: 222 Birch Ln Suite 4, Anytown, US 12345
Phone: 555-0177
Instructions: "Leave at lobby with concierge"
Payment: Cash on delivery
```

---

## Synthesis

**Common ontology — what every chain shares:**

All three chains converge on the same five-axis pizza configurator: `{ size, crust, sauce, cheese, toppings[] }`. **Crust** is always a discrete enum with a `tier` flag (base vs. premium) — the upcharge is a per-crust constant, not a per-size delta in most cases (Papa John's is the exception, encoding crust × size as a price matrix). **Sauce** is a single-select enum with a free `amount: light|normal|extra` modifier. **Cheese** is a base ingredient (mozzarella) with an `amount` enum *and* an optional add-ons array (3-cheese, parmesan, feta). **Toppings** are uniformly modeled as `{ name, placement: whole|left|right, amount: normal|extra|double }`. Pricing models split: Domino's and Pizza Hut charge a flat per-topping fee regardless of category (meat = veggie); Papa John's tiers by *count* (first N free, then $X each). None of the three currently bills meats higher than veggies — the meat/veggie distinction is purely UI categorization.

**Dipping sauces** are universally separate SKUs at $0.75–$0.99 each, never bundled with the pizza by default — they piggyback on sides (wings include 1 free; breadsticks ship with marinara/icing). **Drinks** all follow the same `{ brand, container_size: 20oz|2L, count }` shape — Coke at Domino's, Pepsi at Pizza Hut & Papa John's. Cans are absent from delivery menus across all three (likely a logistics constraint). **Deals** consistently fall into three taxonomic buckets: (1) **Mix-and-Match / Pairings** — pick N items at $X each from a curated SKU list, deal-level price is `$X × count`; (2) **Bundle / Box** — fixed components at a fixed total price (Big Dinner Box, Perfect Combo); (3) **Discount** — % off or $ off applied at order or item level (Wings Wednesday, BOGO). Every deal needs `{ name, code?, type: 'mix_match'|'bundle'|'discount', components: ComponentSpec[], price_rule: { kind: 'per_item_fixed'|'total_fixed'|'percent_off', value: number } }` to be representable. **Address capture** is identical across all three chains: structured `{ street, apt?, city, state, zip, phone, email?, instructions }` — none use single-line addresses; all expose Apt/Suite as a distinct field; all have a free-text instructions field that does double-duty for gate codes, drop-off placement, and accessibility notes. ZIP is the routing key — chains use it to assign the nearest store before any other validation.

**What varies, and what the schema must accommodate:** Papa John's price-by-crust-by-size matrix means the schema can't assume `pizza.basePrice + crust.delta + size.delta` is enough — we need a `priceMatrix[crust][size]` lookup as the canonical form, with the flat-delta case representable as a degenerate matrix. Pizza Hut size-locks specialty crusts (Stuffed Crust = Large only, Tavern = Medium square only) — the crust enum needs a `validSizes: Size[]` constraint. Domino's "Pinpoint Delivery" (lat/long-only address) is unique but suggests `Address` should be a sum type: `StructuredAddress | GeoPoint`. Cheese amount semantics differ — Papa John's allows `none` on the base cheese, Pizza Hut effectively does not. Topping intensity ranges from 2 levels (normal/extra at Papa John's, Pizza Hut) to 3 levels (normal/extra/double at Domino's). The schema should encode `amount` as a string enum with chain-specific allowed-values rather than a fixed scale.

Sources:
- [Domino's Menu](https://www.dominos.com/en/menu)
- [Domino's Perfect Combo deal](https://www.dominos.com/en/deals/9226)
- [Domino's Pinpoint Delivery](https://www.dominos.com/pinpoint-delivery/)
- [Domino's Customer FAQ](https://www.dominos.com/en/pages/content/customer-service/faq)
- [Domino's nutrition calculator menu mirror](https://dominosnutritioncalculator.us/dominos-menu/)
- [Uncle Al's Domino's toppings list](https://www.unclealspizza.com/dominos-pizza-toppings-list/)
- [Pizza Hut Dips menu](https://www.pizzahut.com/menu/dips)
- [Pizza Hut Stuffed Crust content](https://www.pizzahut.com/c/content/stuffed-crust-pizza)
- [Pizza Hut tavern-style + toppings overhaul (2024)](https://blog.pizzahut.com/pizza-hut-unveils-new-chicago-tavern-style-pizza-and-toppings-transformation-with-biggest-toppings-menu-overhaul-in-over-a-decade/)
- [pizzahutmenu.com aggregator](https://pizzahutmenu.com/)
- [pizzahutsmenu.com aggregator](https://www.pizzahutsmenu.com/)
- [Pizza Hut FAQs](https://www.pizzahut.com/faqs/)
- [papajohnmenu.com aggregator](https://www.papajohnmenu.com/)
- [Slice Pizzeria — Papa John's toppings reference](https://www.slicepizzeria.com/papa-johns-toppings/)
- [papajohnsmenu.us extras page](https://papajohnsmenu.us/extras/)
- [eatdrinkdeals.com — Papa John's specials](https://www.eatdrinkdeals.com/papa-johns-specials-deals/)
- [Hip2Save Papa John's BOGO](https://hip2save.com/deals/papa-johns-coupons/)
