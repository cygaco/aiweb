/**
 * The AI Web — Wave 00 MCP Server
 *
 * Three tools. One connector. Real pizza.
 *
 * Tools:
 * 1. start_pizza_order — find restaurants, show presets, collect info
 * 2. place_order — build Bland prompt, fire the call
 * 3. check_order_status — poll call status, parse transcript
 * 4. get_user_profile — fetch stored profile
 * 5. update_user_profile — save/update stored profile
 *
 * The tool descriptions ARE the product. Claude reads them
 * and follows the conversation UX we designed.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  findNearbyRestaurants,
  getRestaurantPhone,
} from "./data/restaurants.js";
import { COLD_PRESETS, orderFromIntent, pizzasNeeded } from "./lib/presets.js";
import {
  dispatchCall,
  getCallStatus,
  type OrderItem,
  type PlaceOrderRequest,
} from "./connectors/bland.js";
import { getProfile, updateProfile } from "./lib/profile-store.js";

export function createServer(tokenHash?: string): McpServer {
  const server = new McpServer({
    name: "ai-web-wave00",
    version: "0.0.1",
  });

  // ─────────────────────────────────────────────
  // TOOL: get_user_profile
  // ─────────────────────────────────────────────

  server.tool(
    "get_user_profile",

    "Fetch the stored user profile for this session. Always call this at the start of an order flow to avoid asking for info already on file (name, phone, address, dietary prefs). Returns empty object if no profile set yet. Never read/write profile data manually in conversation -- always use these tools.",

    {},

    async () => {
      if (!tokenHash) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "unavailable",
                message:
                  "Profile storage is not available in stdio mode. Run via HTTP.",
              }),
            },
          ],
        };
      }
      try {
        const profile = getProfile(tokenHash);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(profile, null, 2) },
          ],
        };
      } catch (err) {
        console.error(
          "get_user_profile error:",
          err instanceof Error ? err.message : err,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "error",
                message: "Failed to read profile.",
              }),
            },
          ],
        };
      }
    },
  );

  // ─────────────────────────────────────────────
  // TOOL: update_user_profile
  // ─────────────────────────────────────────────

  server.tool(
    "update_user_profile",

    "Save or update the user profile. Call this after a successful order when the user agrees to save their info -- always ask before saving. Accepts any subset of: name, phone (E.164 format like +14155551234), default_address, dietary, preferred_restaurant_id, notes. Merges with existing profile. Pass empty string to clear a field.",

    {
      name: z.string().optional().describe("Customer name."),
      phone: z
        .string()
        .optional()
        .describe("Phone in E.164 format, e.g. +14155551234."),
      default_address: z
        .string()
        .optional()
        .describe("Default delivery address."),
      dietary: z
        .string()
        .optional()
        .describe('Dietary preference, e.g. "vegan", "gluten-free".'),
      preferred_restaurant_id: z
        .string()
        .optional()
        .describe("Preferred restaurant ID from start_pizza_order results."),
      notes: z
        .string()
        .max(500)
        .optional()
        .describe(
          "Freeform notes about preferences. Max 500 chars. Stored verbatim.",
        ),
    },

    async ({
      name,
      phone,
      default_address,
      dietary,
      preferred_restaurant_id,
      notes,
    }) => {
      if (!tokenHash) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "error",
                message:
                  "Profile storage is not available in stdio mode. Run via HTTP.",
              }),
            },
          ],
        };
      }
      try {
        const updated = updateProfile(tokenHash, {
          name,
          phone,
          default_address,
          dietary,
          preferred_restaurant_id,
          notes,
        });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(updated, null, 2) },
          ],
        };
      } catch (err) {
        // Only forward known user-facing validation messages (E.164 phone format).
        // Everything else (DB / crypto errors) gets a generic message to avoid
        // leaking internals to the MCP caller.
        const msg = err instanceof Error ? err.message : "";
        const userFacing = /E\.164|Invalid phone/i.test(msg);
        if (!userFacing) {
          console.error("update_user_profile error:", msg);
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "error",
                message: userFacing ? msg : "Failed to update profile.",
              }),
            },
          ],
        };
      }
    },
  );

  // ─────────────────────────────────────────────
  // TOOL 1: start_pizza_order
  // ─────────────────────────────────────────────

  server.tool(
    "start_pizza_order",

    `Find pizza restaurants near an address and build a suggested order.

FIRST — IDENTIFY THE ENTRY POINT, then follow the right path:

━━ ENTRY 1: ZERO CONTEXT ("order pizza", "I want pizza", "pizza please") ━━
  Ask: "What are you in the mood for?" — INDIVIDUAL options only:
    • Large pepperoni — the classic
    • Meat lovers
    • Veggie
    • Just cheese
    • Something else (free text)
    • You pick — I'll surprise you  [call tool with delegate=true]
    • Feeding a group? [only then show: game day / office / kids party]
  Ask address. Then call this tool. Do NOT call tool before getting their pick.

━━ ENTRY 2: INTENT KNOWN ("pepperoni pizza", "large meat lovers") ━━
  Skip mood question. Ask address only. Call tool with intent_style set.

━━ ENTRY 3: GROUP/OCCASION ("kids birthday pizza", "game day for 12") ━━
  Ask address. Ask headcount if not given. Call tool with occasion + headcount.

━━ ENTRY 4: ADDRESS FIRST ("pizza to 123 Main St") ━━
  Call tool immediately with address. Ask mood alongside results if intent unknown.

━━ ENTRY 5: RESTAURANT SPECIFIC ("order from Domino's") ━━
  Ask intent + address. Call tool with restaurant_hint.

━━ ENTRY 6: HIGH CONTEXT (intent + address + name + phone all given) ━━
  Parse everything. Call tool. Present ready-to-confirm order. One confirm → done.

━━ ENTRY 7: DISCOVERY ("what pizza places are near me?") ━━
  Ask address. Call tool with discovery_only=true.
  Show list: name, distance, phone, hours. Do NOT push to order.
  End with: "Want to order from one of these?"

━━ ENTRY 8: DELEGATE ("surprise me", "you pick", "just get me something") ━━
  Ask address only. Call tool with delegate=true.
  Present as agent's recommendation: "Here's what I'd get you — confirm?"

━━ ENTRY 9: CONSTRAINED ("under $20", "gluten-free", "vegan pizza") ━━
  Extract max_budget and/or dietary. Ask address + intent if missing.
  Call tool with constraints. Surface budget_warning or dietary_note if returned.

AFTER THE TOOL RETURNS:

RESTAURANTS: Show name, ETA. Flag isTest entries clearly.

SUGGESTED ORDER (if returned):
  These are ORDER PRESETS — NOT items from the restaurant's menu. Say it clearly.
  "Here's what I'd order for you: [items]"
  menu_confidence:
    "high"   → "✓ On their menu"
    "medium" → "Most pizza places carry this — confirmed on the call"
    "low"    → "Specialty — availability checked when calling"
  dietary_note → "I'll have the AI confirm [dietary] options before ordering"
  budget_warning → surface it, offer smaller/cheaper alternative
  delegate_pick: true → frame as your recommendation, not their choice

PRESETS (if returned, no suggested_order):
  These are WHAT-THE-USER-WANTS options — NOT the restaurant's menu.
  Present as "What are you in the mood for?" not "Here's the menu."

COLLECTING MISSING INFO:
  Need before place_order: name, phone, confirmed address.
  Ask one gap at a time. "Name and phone?" covers both if both missing.

CONFIRM — show full cart:
  Items + sizes | Restaurant | Est. total | Est. delivery | Address | Name | Phone | Cash
  Wait for explicit yes. NEVER call place_order without confirmation.

Pass use_profile_defaults=true if user has not specified an address -- the tool will use their saved address if available.`,

    {
      delivery_address: z
        .string()
        .optional()
        .describe(
          "Delivery address. Can be partial — will be validated. Omit when use_profile_defaults=true and profile has a saved address.",
        ),
      use_profile_defaults: z
        .boolean()
        .optional()
        .describe(
          "Set true to use the saved profile address when the user has not specified one.",
        ),
      intent_style: z
        .string()
        .optional()
        .describe(
          'What the user wants, if they said it. E.g. "meat_lovers", "pepperoni", "veggie", "healthy", "supreme", "cheese". If they said "order me a meat lovers" pass "meat_lovers" here. If vague ("order me a pizza"), omit this.',
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
          'Occasion if mentioned: "game_day", "office_lunch", "kids_party", "family", "date_night", "late_night"',
        ),
      restaurant_hint: z
        .string()
        .optional()
        .describe(
          'Specific restaurant if mentioned, e.g. "dominos", "pizza hut"',
        ),
      max_budget: z
        .number()
        .optional()
        .describe(
          "Maximum total in dollars. Warn if suggested order exceeds this.",
        ),
      dietary: z
        .string()
        .optional()
        .describe(
          'Dietary requirement if mentioned. E.g. "gluten-free", "vegan", "vegetarian", "nut-free". Bland will confirm availability on the call.',
        ),
      discovery_only: z
        .boolean()
        .optional()
        .describe(
          "Set true when user just wants to see nearby options, not place an order yet.",
        ),
      delegate: z
        .boolean()
        .optional()
        .describe(
          "Set true when user says 'you pick', 'surprise me', or delegates the choice. Agent selects the order.",
        ),
    },

    async ({
      delivery_address,
      use_profile_defaults,
      intent_style,
      intent_size,
      intent_quantity,
      headcount,
      occasion,
      restaurant_hint,
      max_budget,
      dietary,
      discovery_only,
      delegate,
    }) => {
      // Resolve delivery address — fall back to saved profile default if requested
      let resolvedAddress = delivery_address;
      if (!resolvedAddress && use_profile_defaults && tokenHash) {
        try {
          const profile = getProfile(tokenHash);
          if (profile.default_address)
            resolvedAddress = profile.default_address;
        } catch {
          // profile store unavailable — continue without defaults
        }
      }

      if (!resolvedAddress) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "error",
                message:
                  "Please provide a delivery_address, or set use_profile_defaults=true if you have a saved address on file.",
              }),
            },
          ],
        };
      }

      // Find nearby restaurants (live Domino's API, fallback to hardcoded)
      let restaurants = await findNearbyRestaurants(resolvedAddress);

      // Filter by restaurant hint if given
      if (restaurant_hint) {
        const hint = restaurant_hint.toLowerCase();
        const filtered = restaurants.filter((r) =>
          r.name.toLowerCase().includes(hint),
        );
        if (filtered.length > 0) restaurants = filtered;
      }

      // Build response
      const result: Record<string, unknown> = {
        delivery_address: resolvedAddress,
        restaurants: restaurants.map((r) => ({
          id: r.id,
          name: r.name,
          phone: r.phone,
          address: r.address,
          estimatedDeliveryMinutes: r.estimatedDeliveryMinutes,
          acceptsCash: r.acceptsCash,
          hours: r.hours,
          ...(r.isTest && {
            isTest: true,
            note: "Test entry — real phone, answer as restaurant staff.",
          }),
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

      // Discovery-only mode: just return restaurants, no order building
      if (discovery_only) {
        result.mode = "discovery";
        result.note =
          "User wants to browse options. Show restaurants with distance, hours, and phone. Ask if they want to order from one.";
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      }

      // Determine menu confidence based on restaurant source
      const primaryRestaurant = restaurants[0];
      const menuConfidence = primaryRestaurant?.isTest
        ? "test"
        : primaryRestaurant?.id.startsWith("places_")
          ? "medium"
          : primaryRestaurant?.id.startsWith("dominos_")
            ? "high"
            : "medium";

      // Delegate mode: agent picks large pepperoni as default
      if (delegate) {
        const items = orderFromIntent({
          style: "pepperoni",
          size: 'Large 14"',
          quantity: 1,
        });
        const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
        result.suggested_order = {
          items,
          estimatedTotal: total,
          menu_confidence: menuConfidence,
          delegate_pick: true,
          note: "Agent-selected order. Present as your recommendation: 'Here's what I'd get you — [item] from [restaurant]. Confirm and I'll call.'",
        };
        if (dietary) {
          (result.suggested_order as Record<string, unknown>).dietary_note =
            `Customer requires ${dietary}. Bland will confirm availability before ordering.`;
          result.dietary = dietary;
        }
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      }

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
          menu_confidence: menuConfidence,
          note: "User specified what they want — skip presets, go to confirmation.",
          ...(dietary && {
            dietary_note: `Customer requires ${dietary}. Bland will confirm availability before ordering.`,
          }),
          ...(max_budget &&
            total > max_budget && {
              budget_warning: `Estimated $${total.toFixed(2)} exceeds budget of $${max_budget.toFixed(2)}. Suggest a smaller size or fewer items.`,
            }),
        };
      }
      // If occasion preset matches, build from preset
      else if (occasion) {
        const preset = COLD_PRESETS.find((p) => p.occasion === occasion);
        if (preset) {
          const items = preset.items(headcount);
          const sides = preset.suggestedSides?.(headcount) ?? [];
          const total = preset.estimateTotal(headcount);
          result.suggested_order = {
            items: [...items, ...sides],
            estimatedTotal: total,
            preset: preset.label,
            menu_confidence: menuConfidence,
            note: headcount
              ? `Built for ${headcount} people using ${preset.label} preset.`
              : `${preset.label} preset selected. Ask how many people if needed.`,
            ...(dietary && {
              dietary_note: `Customer requires ${dietary}. Bland will confirm availability before ordering.`,
            }),
            ...(max_budget &&
              total > max_budget && {
                budget_warning: `Estimated $${total.toFixed(2)} exceeds budget of $${max_budget.toFixed(2)}.`,
              }),
          };
          if (preset.needsHeadcount && !headcount) {
            result.needs_info = "Ask how many people are eating.";
          }
        }
      }
      // Otherwise return presets — these are user preference options, not restaurant menu items
      else {
        result.presets = COLD_PRESETS.filter(
          (p) =>
            // Only show group presets if headcount or occasion context exists
            !p.needsHeadcount || !!headcount,
        ).map((p) => ({
          id: p.id,
          label: p.label,
          description: p.description,
          needsHeadcount: p.needsHeadcount,
          estimatedTotal: p.estimateTotal(headcount),
        }));
        result.presets_note =
          "These are WHAT-THE-USER-WANTS options — NOT the restaurant's menu. " +
          "Present as 'What are you in the mood for?' Show individual options first. " +
          "Only surface group presets (game day, office, kids) if user signals a group context.";
        if (dietary) result.dietary = dietary;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
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
      restaurant_id: z
        .string()
        .describe(
          "Restaurant ID from start_pizza_order results. Phone is resolved server-side.",
        ),
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
          }),
        )
        .describe("The items to order."),
      delivery_address: z
        .string()
        .optional()
        .describe(
          "Full delivery address. If omitted, falls back to saved profile address.",
        ),
      customer_name: z
        .string()
        .optional()
        .describe(
          "Name for the order. If omitted, falls back to saved profile name.",
        ),
      customer_phone: z
        .string()
        .optional()
        .describe(
          "Phone for delivery updates. If omitted, falls back to saved profile phone.",
        ),
      delivery_instructions: z
        .string()
        .optional()
        .describe("Gate code, apt number, 'leave at door', etc."),
      max_total: z
        .number()
        .optional()
        .describe(
          "Max $ the AI should agree to. If restaurant quotes more, it hangs up. Default: 130% of estimated total.",
        ),
      dietary_requirements: z
        .string()
        .optional()
        .describe(
          'Dietary requirement to confirm on the call. E.g. "gluten-free", "vegan". Bland will ask the restaurant before ordering.',
        ),
    },

    async ({
      restaurant_name,
      restaurant_id,
      items,
      delivery_address,
      customer_name,
      customer_phone,
      delivery_instructions,
      max_total,
      dietary_requirements,
    }) => {
      // Resolve optional fields from profile if available
      let resolvedAddress = delivery_address;
      let resolvedName = customer_name;
      let resolvedPhone = customer_phone;

      if (tokenHash) {
        try {
          const profile = getProfile(tokenHash);
          if (!resolvedAddress && profile.default_address)
            resolvedAddress = profile.default_address;
          if (!resolvedName && profile.name) resolvedName = profile.name;
          if (!resolvedPhone && profile.phone) resolvedPhone = profile.phone;
        } catch {
          // profile store unavailable — continue without defaults
        }
      }

      const missing: string[] = [];
      if (!resolvedAddress) missing.push("delivery_address");
      if (!resolvedName) missing.push("customer_name");
      if (!resolvedPhone) missing.push("customer_phone");

      if (missing.length > 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "error",
                  message: `Missing required fields: ${missing.join(", ")}. Please provide them or save them to your profile first using update_user_profile.`,
                  missing_fields: missing,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const resolvedPhone_ = resolvedPhone!;
      const resolvedName_ = resolvedName!;
      const resolvedAddress_ = resolvedAddress!;

      const resolvedRestaurantPhone = getRestaurantPhone(restaurant_id);
      if (!resolvedRestaurantPhone) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "error",
                  message:
                    "Unknown restaurant ID. Call start_pizza_order first to discover restaurants near you.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }
      const E164_REGEX = /^\+[1-9]\d{7,14}$/;
      if (!E164_REGEX.test(resolvedRestaurantPhone)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "error",
                  message:
                    "Restaurant phone number format error -- please report this.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }
      const orderRequest: PlaceOrderRequest = {
        restaurantName: restaurant_name,
        restaurantPhone: resolvedRestaurantPhone,
        items: items as OrderItem[],
        deliveryAddress: resolvedAddress_,
        customerName: resolvedName_,
        customerPhone: resolvedPhone_,
        deliveryInstructions: delivery_instructions,
        maxTotal: max_total,
        dietaryRequirements: dietary_requirements,
      };

      try {
        const callResult = await dispatchCall(orderRequest);

        const estimatedTotal = items.reduce(
          (sum, i) => sum + i.price * i.quantity,
          0,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "calling",
                  call_id: callResult.callId,
                  message: `Calling ${restaurant_name} now. The AI is placing the order for ${resolvedName_}. This typically takes 2-3 minutes.`,
                  order_summary: {
                    items: items.map(
                      (i) => `${i.quantity}x ${i.size} ${i.name}`,
                    ),
                    estimated_total: estimatedTotal,
                    delivery_to: resolvedAddress_,
                    payment: "Cash on delivery",
                  },
                  next_step:
                    "Call check_order_status with this call_id in about 2 minutes to get the result.",
                },
                null,
                2,
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
                2,
              ),
            },
          ],
        };
      }
    },
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
                2,
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
                2,
              ),
            },
          ],
        };
      }
    },
  );

  return server;
}
