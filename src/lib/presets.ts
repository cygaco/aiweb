/**
 * Order presets and smart defaults.
 * The "intelligence layer" for MVP — hardcoded research-backed data.
 *
 * Source: Pizza ordering research (AI_Pizza_Ordering_Agent_Research.pdf)
 * - 64-67% prefer pepperoni
 * - 3/8 rule for group sizing
 * - 70/30 rule for kids parties
 * - 59% view wings as ultimate pizza pairing on game day
 */

import type { OrderItem } from "../connectors/bland.js";

export interface Preset {
  id: string;
  label: string;
  description: string;
  occasion: string;
  needsHeadcount: boolean;
  items: (headcount?: number) => OrderItem[];
  suggestedSides?: (headcount?: number) => OrderItem[];
  estimateTotal: (headcount?: number) => number;
}

// Default substitutions — safe for most people
const DEFAULT_SUBS: Record<string, string> = {
  "thin crust": "hand tossed",
  pepperoni: "sausage",
  "hand tossed": "thin crust",
};

function pepperoni(
  size: string,
  price: number,
  qty: number = 1
): OrderItem {
  return {
    name: "Pepperoni",
    size,
    quantity: qty,
    price,
    substitution: "sausage",
  };
}

function cheese(size: string, price: number, qty: number = 1): OrderItem {
  return {
    name: "Cheese",
    size,
    quantity: qty,
    price,
    substitution: undefined, // no sub for cheese — it's the fallback
  };
}

function meatLovers(
  size: string,
  price: number,
  qty: number = 1
): OrderItem {
  return {
    name: "Meat Lovers",
    size,
    quantity: qty,
    price,
    substitution: "pepperoni",
  };
}

function veggie(size: string, price: number, qty: number = 1): OrderItem {
  return {
    name: "Veggie",
    size,
    quantity: qty,
    price,
    substitution: "cheese",
  };
}

function wings(): OrderItem {
  return {
    name: "Wings (8pc)",
    size: "Regular",
    quantity: 1,
    price: 8.99,
  };
}

function salad(): OrderItem {
  return {
    name: "Garden Salad",
    size: "Regular",
    quantity: 1,
    price: 7.99,
  };
}

/**
 * Calculate pizzas needed using the 3/8 rule.
 * p = ceil((adults × 3 + teens × 3.5 + kids × 1.5) / 8)
 */
export function pizzasNeeded(
  adults: number,
  teens: number = 0,
  kids: number = 0
): number {
  const slices = adults * 3 + teens * 3.5 + kids * 1.5;
  return Math.ceil(slices / 8);
}

/**
 * Cold user presets — shown when we don't know the user.
 */
export const COLD_PRESETS: Preset[] = [
  {
    id: "quick_pepperoni",
    label: "Large pepperoni",
    description: "#1 pick — 64% of people choose this",
    occasion: "default",
    needsHeadcount: false,
    items: () => [pepperoni("Large 14\"", 12.99)],
    estimateTotal: () => 12.99,
  },
  {
    id: "game_day",
    label: "Game day",
    description: "Meat-heavy pizzas + wings for the crew",
    occasion: "game_day",
    needsHeadcount: true,
    items: (headcount = 6) => {
      const count = pizzasNeeded(headcount);
      const items: OrderItem[] = [];
      // Half meat lovers, half pepperoni
      const meatCount = Math.ceil(count / 2);
      const pepCount = count - meatCount;
      if (meatCount > 0) items.push(meatLovers("Large 14\"", 15.99, meatCount));
      if (pepCount > 0) items.push(pepperoni("Large 14\"", 12.99, pepCount));
      return items;
    },
    suggestedSides: (headcount = 6) => {
      const wingOrders = Math.ceil((headcount ?? 6) / 4);
      return [{ ...wings(), quantity: wingOrders }];
    },
    estimateTotal: (headcount = 6) => {
      const count = pizzasNeeded(headcount);
      const meatCount = Math.ceil(count / 2);
      const pepCount = count - meatCount;
      const wingOrders = Math.ceil(headcount / 4);
      return meatCount * 15.99 + pepCount * 12.99 + wingOrders * 8.99;
    },
  },
  {
    id: "kids_party",
    label: "Kids party",
    description: "Cheese + pepperoni, simple and safe",
    occasion: "kids_party",
    needsHeadcount: true,
    // 70/30 rule: 70% cheese, 30% pepperoni
    items: (headcount = 8) => {
      const count = pizzasNeeded(0, 0, headcount);
      const cheeseCount = Math.max(1, Math.ceil(count * 0.7));
      const pepCount = Math.max(1, count - cheeseCount);
      return [
        cheese("Large 14\"", 11.99, cheeseCount),
        pepperoni("Large 14\"", 12.99, pepCount),
      ];
    },
    estimateTotal: (headcount = 8) => {
      const count = pizzasNeeded(0, 0, headcount);
      const cheeseCount = Math.max(1, Math.ceil(count * 0.7));
      const pepCount = Math.max(1, count - cheeseCount);
      return cheeseCount * 11.99 + pepCount * 12.99;
    },
  },
  {
    id: "office_lunch",
    label: "Office lunch",
    description: "Variety + salads, crowd-pleasing",
    occasion: "office_lunch",
    needsHeadcount: true,
    items: (headcount = 10) => {
      // Office: 1-2 slices/person, variety
      const count = Math.ceil((headcount * 2) / 8);
      const items: OrderItem[] = [];
      // Spread across types
      items.push(pepperoni("Large 14\"", 12.99, Math.ceil(count * 0.3)));
      items.push(cheese("Large 14\"", 11.99, Math.ceil(count * 0.3)));
      items.push(veggie("Large 14\"", 14.99, Math.max(1, count - Math.ceil(count * 0.3) * 2)));
      return items;
    },
    suggestedSides: (headcount = 10) => {
      const saladCount = Math.ceil((headcount ?? 10) / 5);
      return [{ ...salad(), quantity: saladCount }];
    },
    estimateTotal: (headcount = 10) => {
      const count = Math.ceil((headcount * 2) / 8);
      const saladCount = Math.ceil(headcount / 5);
      return (
        Math.ceil(count * 0.3) * 12.99 +
        Math.ceil(count * 0.3) * 11.99 +
        Math.max(1, count - Math.ceil(count * 0.3) * 2) * 14.99 +
        saladCount * 7.99
      );
    },
  },
];

/**
 * Build a simple order from intent signals.
 * Used when the user specifies what they want (e.g. "meat lovers").
 */
export function orderFromIntent(intent: {
  style?: string;
  size?: string;
  quantity?: number;
}): OrderItem[] {
  const size = intent.size ?? "Large 14\"";
  const qty = intent.quantity ?? 1;

  switch (intent.style?.toLowerCase()) {
    case "meat_lovers":
    case "meat lovers":
    case "meaty":
    case "heavy_meat":
      return [meatLovers(size, 15.99, qty)];
    case "veggie":
    case "vegetable":
    case "healthy":
      return [veggie(size, 14.99, qty)];
    case "cheese":
    case "plain":
      return [cheese(size, 11.99, qty)];
    case "supreme":
    case "everything":
      return [
        {
          name: "Supreme",
          size,
          quantity: qty,
          price: 16.99,
          substitution: "pepperoni",
        },
      ];
    case "pepperoni":
    default:
      return [pepperoni(size, 12.99, qty)];
  }
}
