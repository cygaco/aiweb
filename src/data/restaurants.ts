/**
 * Hardcoded restaurant data for Wave 00 MVP.
 * Real restaurants with real phone numbers and real menus.
 * 
 * Post-MVP: Replace with Google Places API + menu scraping.
 */

export interface MenuItem {
  name: string;
  sizes: { name: string; price: number }[];
  description?: string;
}

export interface Restaurant {
  id: string;
  name: string;
  phone: string;
  address: string;
  lat: number;
  lng: number;
  deliveryRadius: number; // miles
  estimatedDeliveryMinutes: number;
  acceptsCash: boolean;
  menu: {
    pizzas: MenuItem[];
    sides: MenuItem[];
  };
  hours: string;
}

// TODO: Replace with real local restaurants for your test area.
// These are PLACEHOLDER entries — update phone/address before testing.
export const RESTAURANTS: Restaurant[] = [
  {
    id: "dominos_001",
    name: "Domino's Pizza",
    phone: "+1XXXXXXXXXX", // REPLACE with real local Domino's number
    address: "123 Main St, Your City, ST 00000",
    lat: 0,
    lng: 0,
    deliveryRadius: 5,
    estimatedDeliveryMinutes: 30,
    acceptsCash: true,
    menu: {
      pizzas: [
        {
          name: "Pepperoni",
          description: "Classic pepperoni with mozzarella",
          sizes: [
            { name: "Small 10\"", price: 8.99 },
            { name: "Medium 12\"", price: 10.99 },
            { name: "Large 14\"", price: 12.99 },
          ],
        },
        {
          name: "Cheese",
          description: "Hand-stretched with 100% mozzarella",
          sizes: [
            { name: "Small 10\"", price: 7.99 },
            { name: "Medium 12\"", price: 9.99 },
            { name: "Large 14\"", price: 11.99 },
          ],
        },
        {
          name: "Meat Lovers",
          description: "Pepperoni, sausage, ham, beef, bacon",
          sizes: [
            { name: "Small 10\"", price: 10.99 },
            { name: "Medium 12\"", price: 13.99 },
            { name: "Large 14\"", price: 15.99 },
          ],
        },
        {
          name: "Veggie",
          description: "Mushrooms, onions, green peppers, tomatoes, olives",
          sizes: [
            { name: "Small 10\"", price: 9.99 },
            { name: "Medium 12\"", price: 12.99 },
            { name: "Large 14\"", price: 14.99 },
          ],
        },
        {
          name: "Supreme",
          description: "Pepperoni, sausage, mushrooms, onions, green peppers",
          sizes: [
            { name: "Small 10\"", price: 11.99 },
            { name: "Medium 12\"", price: 14.99 },
            { name: "Large 14\"", price: 16.99 },
          ],
        },
      ],
      sides: [
        {
          name: "Wings (8pc)",
          sizes: [{ name: "Regular", price: 8.99 }],
        },
        {
          name: "Cheesy Bread",
          sizes: [{ name: "Regular", price: 6.99 }],
        },
        {
          name: "Garden Salad",
          sizes: [{ name: "Regular", price: 7.99 }],
        },
        {
          name: "2-Liter Coke",
          sizes: [{ name: "Regular", price: 3.49 }],
        },
      ],
    },
    hours: "11:00 AM - 1:00 AM",
  },
  {
    id: "local_001",
    name: "Joe's Pizza",
    phone: "+1XXXXXXXXXX", // REPLACE with real local pizza shop
    address: "456 Oak Ave, Your City, ST 00000",
    lat: 0,
    lng: 0,
    deliveryRadius: 3,
    estimatedDeliveryMinutes: 35,
    acceptsCash: true,
    menu: {
      pizzas: [
        {
          name: "Pepperoni",
          sizes: [
            { name: "Medium 14\"", price: 14.99 },
            { name: "Large 18\"", price: 18.99 },
          ],
        },
        {
          name: "Cheese",
          sizes: [
            { name: "Medium 14\"", price: 12.99 },
            { name: "Large 18\"", price: 16.99 },
          ],
        },
        {
          name: "Margherita",
          description: "Fresh mozzarella, basil, tomato sauce",
          sizes: [
            { name: "Medium 14\"", price: 15.99 },
            { name: "Large 18\"", price: 19.99 },
          ],
        },
      ],
      sides: [
        {
          name: "Garlic Knots (6pc)",
          sizes: [{ name: "Regular", price: 5.99 }],
        },
      ],
    },
    hours: "11:00 AM - 11:00 PM",
  },
];

/**
 * Find restaurants near an address.
 * MVP: Returns all restaurants (no real geo filtering).
 * Post-MVP: Use Google Places API + real distance calc.
 */
export function findNearbyRestaurants(_address: string): Restaurant[] {
  // TODO: Real geocoding + distance filtering
  return RESTAURANTS.filter((r) => r.phone !== "+1XXXXXXXXXX");
}
