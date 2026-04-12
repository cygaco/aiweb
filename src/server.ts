/**
 * The AI Web — Wave 00 MCP Server
 *
 * Three tools. One connector. Real pizza.
 *
 * Tools:
 * 1. start_pizza_order — find restaurants, show presets, collect info
 * 2. place_order — build Bland prompt, fire the call
 * 3. check_order_status — poll call status, parse transcript
 *
 * The tool descriptions ARE the product. Claude reads them
 * and follows the conversation UX we designed.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { findNearbyRestaurants } from "./data/restaurants.js";
import {
  COLD_PRESETS,
  orderFromIntent,
  pizzasNeeded,
} from "./lib/presets.js";
import {
  dispatchCall,
  getCallStatus,
  type OrderItem,
  type PlaceOrderRequest,
} from "./connectors/bland.js";

const server = new McpServer({
  name: "ai-web-wave00",
  version: "0.0.1",
});

// ─────────────────────────────────────────────
// TOOL 1: start_pizza_order
// ─────────────────────────────────────────────

server.tool(
  "start_pizza_order",

  `Find pizza restaurants and get ordering options for the user.
Call this FIRST when someone wants to order pizza.

YOUR CONVERSATION FLOW — follow these steps:

STEP 1: PARSE WHAT THEY ALREADY TOLD YOU.
Before calling this tool, extract everything from the user's message:
- Did they say what they want? ("meat lovers" → style = "meat_lovers")
- Did they say how many people? (headcount)
- Did they say a specific restaurant? (restaurant_hint)
- Did they mention dietary needs? Pass them too.
If they said "order me a meat lovers" — you already know what they want.
Do NOT ask again.

STEP 2: CALL THIS TOOL with the delivery address.

STEP 3: PRESENT WHAT CAME BACK.
Lead with what you know: "Here's what I found near you."
Show the presets as SELECTABLE OPTIONS — not a wall of text:
  • "Large pepperoni — #1 pick, $12.99"
  • "Game day — meat + wings for the crew"
  • "Kids party — cheese + pepperoni, simple"
  • "Office lunch — variety + salads"
  • "Something else — tell me what you want"
  • "Take a taste quiz — I'll learn your style"
If the user already specified what they want (intent_style is set),
SKIP the presets and go straight to confirming the order.

STEP 4: COLLECT MISSING INFO.
You need name, phone, and address to place the order.
Weave these into conversation naturally:
  "What's the delivery address?" (if not given)
  "Name and phone for the order?" (one ask, not two)
  "Any delivery instructions — gate code, apartment?"
Do NOT dump all questions at once. Ask what's missing.

STEP 5: CONFIRM THE ORDER.
ALWAYS show the full order before calling place_order:
  Items, quantities, sizes
  Restaurant name
  Estimated total
  Estimated delivery time
  Delivery address
  Name + phone
  "Paying cash to the driver"
Wait for explicit "yes" / "confirm" / "go for it".
NEVER call place_order without confirmation.`,

  {
    delivery_address: z
      .string()
      .describe("Delivery address. Can be partial — will be validated."),
    intent_style: z
      .string()
      .optional()
      .describe(
        'What the user wants, if they said it. E.g. "meat_lovers", "pepperoni", "veggie", "healthy", "supreme", "cheese". If they said "order me a meat lovers" pass "meat_lovers" here. If vague ("order me a pizza"), omit this.'
      ),
    intent_size: z
      .string()
      .optional()
      .describe('Size if specified. E.g. "Large 14\\"", "Medium 12\\""'),
    intent_quantity: z
      .number()
      .optional()
      .describe("How many pizzas if specified."),
    headcount: z
      .number()
      .optional()
      .describe("Number of people eating, if mentioned."),
    occasion: z
      .string()
      .optional()
      .describe(
        'Occasion if mentioned: "game_day", "office_lunch", "kids_party", "family", "date_night", "late_night"'
      ),
    restaurant_hint: z
      .string()
      .optional()
      .describe(
        "Specific restaurant if mentioned, e.g. \"dominos\", \"pizza hut\""
      ),
  },

  async ({ delivery_address, intent_style, intent_size, intent_quantity, headcount, occasion, restaurant_hint }) => {
    // Find nearby restaurants
    let restaurants = findNearbyRestaurants(delivery_address);

    // Filter by restaurant hint if given
    if (restaurant_hint) {
      const hint = restaurant_hint.toLowerCase();
      const filtered = restaurants.filter((r) =>
        r.name.toLowerCase().includes(hint)
      );
      if (filtered.length > 0) restaurants = filtered;
    }

    // Build response
    const result: Record<string, unknown> = {
      delivery_address,
      restaurants: restaurants.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        address: r.address,
        estimatedDeliveryMinutes: r.estimatedDeliveryMinutes,
        acceptsCash: r.acceptsCash,
        hours: r.hours,
        menuSummary: {
          pizzas: r.menu.pizzas.map((p) => ({
            name: p.name,
            description: p.description,
            sizes: p.sizes,
          })),
          sides: r.menu.sides.map((s) => ({
            name: s.name,
            price: s.sizes[0].price,
          })),
        },
      })),
    };

    // If user specified what they want, build the order immediately
    if (intent_style) {
      const items = orderFromIntent({
        style: intent_style,
        size: intent_size,
        quantity: intent_quantity,
      });
      const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
      result.suggested_order = {
        items,
        estimatedTotal: total,
        note: "User specified what they want — skip presets, go to confirmation.",
      };
    }
    // If occasion preset matches, build from preset
    else if (occasion) {
      const preset = COLD_PRESETS.find((p) => p.occasion === occasion);
      if (preset) {
        const items = preset.items(headcount);
        const sides = preset.suggestedSides?.(headcount) ?? [];
        result.suggested_order = {
          items: [...items, ...sides],
          estimatedTotal: preset.estimateTotal(headcount),
          preset: preset.label,
          note: headcount
            ? `Built for ${headcount} people using ${preset.label} preset.`
            : `${preset.label} preset selected. Ask how many people if needed.`,
        };
        if (preset.needsHeadcount && !headcount) {
          result.needs_info = "Ask how many people are eating.";
        }
      }
    }
    // Otherwise show presets for the user to pick
    else {
      result.presets = COLD_PRESETS.map((p) => ({
        id: p.id,
        label: p.label,
        description: p.description,
        needsHeadcount: p.needsHeadcount,
        estimatedTotal: p.estimateTotal(headcount),
      }));
      result.note =
        "Show these as selectable options. Also offer 'Something else' (user types what they want) and 'Take a taste quiz' (ask: crust? protein/veggie? spice level? dietary restrictions? — then use answers as intent_style).";
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

// ─────────────────────────────────────────────
// TOOL 2: place_order
// ─────────────────────────────────────────────

server.tool(
  "place_order",

  `Place a pizza order by having an AI voice agent call the restaurant.
The AI will call the restaurant, read the order, and confirm it — just
like a human calling to place a delivery order. Payment is CASH on delivery.

CRITICAL: Only call this AFTER the user has confirmed the full order.
You MUST have shown them: items, price, restaurant, ETA, address, name,
phone, and gotten explicit approval. This triggers a real phone call
to a real restaurant.

The call takes 2-3 minutes. After calling this, tell the user:
"I'm calling [restaurant] now to place your order. This takes a couple
 minutes — I'll let you know as soon as it's confirmed."

Then call check_order_status with the returned call_id to get the result.`,

  {
    restaurant_name: z.string().describe("Restaurant name."),
    restaurant_phone: z
      .string()
      .describe("Restaurant phone number in E.164 format."),
    items: z
      .array(
        z.object({
          name: z.string(),
          size: z.string(),
          quantity: z.number(),
          price: z.number(),
          substitution: z
            .string()
            .optional()
            .describe("What to get if this item is unavailable."),
        })
      )
      .describe("The items to order."),
    delivery_address: z.string().describe("Full delivery address."),
    customer_name: z.string().describe("Name for the order."),
    customer_phone: z.string().describe("Phone for delivery updates."),
    delivery_instructions: z
      .string()
      .optional()
      .describe("Gate code, apt number, 'leave at door', etc."),
    max_total: z
      .number()
      .optional()
      .describe(
        "Max $ the AI should agree to. If restaurant quotes more, it hangs up. Default: 130% of estimated total."
      ),
  },

  async ({
    restaurant_name,
    restaurant_phone,
    items,
    delivery_address,
    customer_name,
    customer_phone,
    delivery_instructions,
    max_total,
  }) => {
    const orderRequest: PlaceOrderRequest = {
      restaurantName: restaurant_name,
      restaurantPhone: restaurant_phone,
      items: items as OrderItem[],
      deliveryAddress: delivery_address,
      customerName: customer_name,
      customerPhone: customer_phone,
      deliveryInstructions: delivery_instructions,
      maxTotal: max_total,
    };

    try {
      const callResult = await dispatchCall(orderRequest);

      const estimatedTotal = items.reduce(
        (sum, i) => sum + i.price * i.quantity,
        0
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                status: "calling",
                call_id: callResult.callId,
                message: `Calling ${restaurant_name} now. The AI is placing the order for ${customer_name}. This typically takes 2-3 minutes.`,
                order_summary: {
                  items: items.map(
                    (i) => `${i.quantity}x ${i.size} ${i.name}`
                  ),
                  estimated_total: estimatedTotal,
                  delivery_to: delivery_address,
                  payment: "Cash on delivery",
                },
                next_step:
                  "Call check_order_status with this call_id in about 2 minutes to get the result.",
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                status: "error",
                message: `Failed to call restaurant: ${error instanceof Error ? error.message : "Unknown error"}`,
                suggestion:
                  "Check that BLAND_API_KEY is set and the restaurant phone number is valid.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }
);

// ─────────────────────────────────────────────
// TOOL 3: check_order_status
// ─────────────────────────────────────────────

server.tool(
  "check_order_status",

  `Check if the phone call to the restaurant has completed and whether
the order was confirmed.

Call this after place_order. The call typically takes 2-3 minutes.
If status is "in_progress" or "queued", wait a minute and try again.

When the call completes, you'll get:
- Whether the order was confirmed
- The total the restaurant quoted
- Estimated delivery time
- Any substitutions that were made
- Any issues (couldn't deliver, restaurant closed, etc.)

Tell the user the results naturally:
✓ "Order confirmed! They said about 30 min, $28.47 total. Pay cash to the driver."
✓ "They were out of thin crust so I went with hand tossed. Everything else confirmed."
✗ "They couldn't deliver to that address. Want me to try another restaurant?"
✗ "No answer — want me to try [next restaurant]?"`,

  {
    call_id: z.string().describe("The call_id from place_order."),
  },

  async ({ call_id }) => {
    try {
      const status = await getCallStatus(call_id);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                call_id: status.callId,
                status: status.status,
                duration_seconds: status.duration,
                ...(status.status === "completed"
                  ? {
                      order_confirmed:
                        status.parsedResult?.orderConfirmed ?? false,
                      total_quoted: status.parsedResult?.totalQuoted,
                      estimated_minutes:
                        status.parsedResult?.estimatedMinutes,
                      substitutions_made:
                        status.parsedResult?.substitutionsMade ?? [],
                      issues: status.parsedResult?.issuesEncountered ?? [],
                      transcript_summary: status.summary,
                      full_transcript: status.transcript,
                    }
                  : status.status === "failed"
                    ? {
                        message:
                          "Call failed — restaurant didn't answer, went to voicemail, or line was busy.",
                        suggestion:
                          "Try the next restaurant or ask the user if they want to retry.",
                      }
                    : {
                        message:
                          "Call is still in progress. Wait about a minute and check again.",
                      }),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                status: "error",
                message: `Failed to check status: ${error instanceof Error ? error.message : "Unknown error"}`,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }
);

// ─────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("AI Web Wave 00 MCP server running on stdio");
}

main().catch(console.error);
