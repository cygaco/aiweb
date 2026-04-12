/**
 * Domino's public API connector.
 * Uses Domino's ordering API — no auth required.
 *
 * Gives us: real store ID, phone, address, hours, delivery estimate.
 * Menu is standardized across US franchise locations (consistent pricing).
 */

import type { Restaurant } from "../data/restaurants.js";

const DOMINOS_API = "https://order.dominos.com/power";

interface DominosRawStore {
  StoreID: string;
  Phone: string;
  AddressDescription: string;
  IsDeliveryStore: boolean;
  AllowDeliveryOrders: boolean;
  IsOpen: boolean;
  ServiceIsOpen?: { Delivery?: boolean };
  EstimatedWaitMinutes?: string;
  MaxDistance?: number;
}

interface DominosLocatorResponse {
  Status: number;
  Stores: DominosRawStore[];
}

function parseAddress(address: string): { street: string; city: string } {
  const commaIdx = address.indexOf(",");
  if (commaIdx === -1) return { street: address, city: "" };
  return {
    street: address.slice(0, commaIdx).trim(),
    city: address.slice(commaIdx + 1).trim(),
  };
}

function parseWaitMinutes(wait?: string): number {
  if (!wait) return 35;
  const parts = wait.split("-").map(Number).filter((n) => !isNaN(n));
  if (parts.length === 0) return 35;
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

function mapToRestaurant(store: DominosRawStore): Restaurant {
  // AddressDescription can have promo lines after street + city — take only first two
  const addressStr = store.AddressDescription.replace(/\r/g, "")
    .split("\n")
    .slice(0, 2)
    .join(", ");

  return {
    id: `dominos_${store.StoreID}`,
    name: "Domino's Pizza",
    phone: formatPhone(store.Phone),
    address: addressStr,
    lat: 0,
    lng: 0,
    deliveryRadius: store.MaxDistance ?? 5,
    estimatedDeliveryMinutes: parseWaitMinutes(store.EstimatedWaitMinutes),
    acceptsCash: true,
    hours: "See store for hours",
    menu: DOMINOS_MENU,
  };
}

export async function findNearbyDominosStores(
  address: string
): Promise<Restaurant[]> {
  try {
    const { street, city } = parseAddress(address);
    const params = new URLSearchParams({ s: street, c: city, type: "Delivery" });

    const res = await fetch(`${DOMINOS_API}/store-locator?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return [];

    const data = (await res.json()) as DominosLocatorResponse;
    if (!data.Stores?.length) return [];

    return data.Stores.filter(
      (s) =>
        s.IsDeliveryStore &&
        s.AllowDeliveryOrders &&
        s.ServiceIsOpen?.Delivery !== false
    )
      .slice(0, 3)
      .map(mapToRestaurant);
  } catch {
    return [];
  }
}

// Standard Domino's US menu — consistent across franchise locations.
const DOMINOS_MENU: Restaurant["menu"] = {
  pizzas: [
    {
      name: "Pepperoni",
      description: "Classic pepperoni with mozzarella",
      sizes: [
        { name: 'Small 10"', price: 8.99 },
        { name: 'Medium 12"', price: 10.99 },
        { name: 'Large 14"', price: 12.99 },
      ],
    },
    {
      name: "Cheese",
      description: "Hand-stretched with 100% mozzarella",
      sizes: [
        { name: 'Small 10"', price: 7.99 },
        { name: 'Medium 12"', price: 9.99 },
        { name: 'Large 14"', price: 11.99 },
      ],
    },
    {
      name: "Meat Lovers",
      description: "Pepperoni, sausage, ham, beef, bacon",
      sizes: [
        { name: 'Small 10"', price: 10.99 },
        { name: 'Medium 12"', price: 13.99 },
        { name: 'Large 14"', price: 15.99 },
      ],
    },
    {
      name: "Veggie",
      description: "Mushrooms, onions, green peppers, tomatoes, olives",
      sizes: [
        { name: 'Small 10"', price: 9.99 },
        { name: 'Medium 12"', price: 12.99 },
        { name: 'Large 14"', price: 14.99 },
      ],
    },
    {
      name: "Supreme",
      description: "Pepperoni, sausage, mushrooms, onions, green peppers",
      sizes: [
        { name: 'Small 10"', price: 11.99 },
        { name: 'Medium 12"', price: 14.99 },
        { name: 'Large 14"', price: 16.99 },
      ],
    },
  ],
  sides: [
    { name: "Wings (8pc)", sizes: [{ name: "Regular", price: 8.99 }] },
    { name: "Cheesy Bread", sizes: [{ name: "Regular", price: 6.99 }] },
    { name: "Garden Salad", sizes: [{ name: "Regular", price: 7.99 }] },
    { name: "2-Liter Coke", sizes: [{ name: "Regular", price: 3.49 }] },
  ],
};
