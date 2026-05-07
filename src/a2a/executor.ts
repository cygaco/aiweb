import { randomUUID } from "node:crypto";
import type {
  AgentExecutionEvent,
  AgentExecutor,
  ExecutionEventBus,
  RequestContext,
} from "@a2a-js/sdk/server";
import type {
  Message,
  Task,
  TaskArtifactUpdateEvent,
  TaskStatusUpdateEvent,
} from "@a2a-js/sdk";
import {
  findNearbyRestaurants,
  getRestaurantPhone,
} from "../data/restaurants.js";
import { COLD_PRESETS, orderFromIntent } from "../lib/presets.js";
import {
  dispatchCall,
  getCallStatus,
  type OrderItem,
  type PlaceOrderRequest,
} from "../connectors/bland.js";
import { issueToken, verifyToken } from "../lib/confirmation-token.js";
import { cartTotal, type Cart } from "../lib/cart.js";
import {
  buildCustomizationSurface,
  hasCustomizationOpportunities,
  legacyItemsToCart,
} from "../lib/cart-flow.js";
import { assessCompatibility } from "../lib/compatibility.js";
import { logCompatibilityOverride } from "../lib/event-log.js";
import { geocodeAddress } from "../lib/geo.js";

const POLL_INTERVAL_MS = 15_000;
const POLL_TIMEOUT_MS = 5 * 60_000;
const UPSELL_TURN_RULES = [
  "If the user already specified everything (style, size, modifiers, drink, deal) → skip to confirmation. Do not ask follow-up questions.",
  "Otherwise: required clarifications first (size if missing, headcount if preset needs it). Then ONE concise upsell turn combining extras + drinks + sides + deals: 'Want extra cheese, a soda, or to bundle with the family deal ($X total)?' — never list as 4 separate prompts.",
  "Surface deals only when their components match the cart shape; never claim a savings number unless the math is explicit and verified.",
  "Always render the full cart with prices before `prepare_order`.",
];

interface OrderInput {
  address?: string;
  name?: string;
  phone?: string;
  intent_style?: string;
  intent_size?: string;
  intent_quantity?: number;
  occasion?: string;
  headcount?: number;
  restaurant_id?: string;
  restaurant_hint?: string;
  items?: OrderItem[];
  cart?: Cart;
  dietary?: string;
  delivery_instructions?: string;
  max_total?: number;
  confirmed?: boolean;
  confirmation_token?: string;
  override_compatibility?: boolean;
}

export function extractInput(message: Message): OrderInput {
  const out: OrderInput = {};
  for (const part of message.parts ?? []) {
    if (part.kind === "data" && part.data) {
      Object.assign(out, part.data as Record<string, unknown>);
    } else if (part.kind === "text" && part.text) {
      try {
        const parsed = JSON.parse(part.text);
        if (parsed && typeof parsed === "object") {
          Object.assign(out, parsed as Record<string, unknown>);
        }
      } catch {
        // ignore — text is not JSON; intent will be extracted from
        // structured fields if any survive in metadata
      }
    }
  }
  if (
    typeof out.delivery_instructions === "string" &&
    out.delivery_instructions.length > 200
  ) {
    out.delivery_instructions = out.delivery_instructions.slice(0, 200);
  }
  return out;
}

function status(
  taskId: string,
  contextId: string,
  state: "submitted" | "working" | "input-required" | "completed" | "failed",
  text?: string,
  final = false,
): TaskStatusUpdateEvent {
  const message: Message | undefined = text
    ? {
        kind: "message",
        messageId: randomUUID(),
        role: "agent",
        parts: [{ kind: "text", text }],
        taskId,
        contextId,
      }
    : undefined;
  return {
    kind: "status-update",
    taskId,
    contextId,
    status: {
      state: state as TaskStatusUpdateEvent["status"]["state"],
      message,
      timestamp: new Date().toISOString(),
    },
    final,
  };
}

function artifact(
  taskId: string,
  contextId: string,
  name: string,
  data: unknown,
): TaskArtifactUpdateEvent {
  return {
    kind: "artifact-update",
    taskId,
    contextId,
    artifact: {
      artifactId: randomUUID(),
      name,
      parts: [{ kind: "data", data: data as Record<string, unknown> }],
    },
  };
}

function fail(reason: string): { error: string } {
  return { error: reason };
}

export class PizzaAgentExecutor implements AgentExecutor {
  private cancelled = new Set<string>();

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    this.cancelled.add(taskId);
    eventBus.publish({
      kind: "status-update",
      taskId,
      contextId: taskId,
      status: { state: "canceled", timestamp: new Date().toISOString() },
      final: true,
    } as AgentExecutionEvent);
  }

  async execute(
    ctx: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const taskId = ctx.taskId;
    const contextId = ctx.contextId;

    const initialTask: Task = {
      kind: "task",
      id: taskId,
      contextId,
      status: { state: "submitted", timestamp: new Date().toISOString() },
    };
    eventBus.publish(initialTask);

    const input = extractInput(ctx.userMessage);

    const missing: string[] = [];
    if (!input.address) missing.push("address");
    if (!input.name) missing.push("name");
    if (!input.phone) missing.push("phone");
    if (
      !input.items?.length &&
      !input.cart?.length &&
      !input.intent_style &&
      !input.occasion
    )
      missing.push("intent_style|occasion|items|cart");

    if (missing.length > 0) {
      eventBus.publish(
        status(
          taskId,
          contextId,
          "input-required",
          `Missing required fields: ${missing.join(", ")}. Send a JSON message with at minimum {address, name, phone, intent_style or occasion or items or cart, confirmed:true}.`,
          true,
        ),
      );
      return;
    }

    if (input.confirmed !== true) {
      // Build a candidate cart and emit it as an artifact, then ask for confirmation
      eventBus.publish(
        status(
          taskId,
          contextId,
          "working",
          "Looking up restaurants and building cart…",
        ),
      );
      let restaurants;
      try {
        restaurants = await findNearbyRestaurants(input.address!);
      } catch (e) {
        eventBus.publish(
          status(
            taskId,
            contextId,
            "failed",
            `Restaurant lookup failed: ${e instanceof Error ? e.message : String(e)}`,
            true,
          ),
        );
        return;
      }
      const restaurant =
        restaurants.find((r) => r.id === input.restaurant_id) ??
        restaurants.find((r) =>
          input.restaurant_hint
            ? r.name.toLowerCase().includes(input.restaurant_hint.toLowerCase())
            : false,
        ) ??
        restaurants[0];
      if (!restaurant) {
        eventBus.publish(
          status(
            taskId,
            contextId,
            "failed",
            "No restaurants near that address.",
            true,
          ),
        );
        return;
      }
      const items: OrderItem[] = input.items?.length
        ? input.items
        : input.intent_style
          ? orderFromIntent(restaurant, {
              style: input.intent_style,
              size: input.intent_size,
              quantity: input.intent_quantity,
            })
          : input.occasion
            ? (COLD_PRESETS.find((p) => p.id === input.occasion)?.items(
                restaurant,
                input.headcount ?? 4,
              ) ?? [])
            : [];
      const cart = input.cart?.length
        ? input.cart
        : legacyItemsToCart(items, restaurant);
      const estimatedTotal = cartTotal(cart);
      let proposedToken: string | undefined;
      try {
        proposedToken = issueToken({
          restaurant_id: restaurant.id,
          items: input.cart?.length ? undefined : items,
          cart: input.cart?.length ? cart : undefined,
          customer_name: input.name!,
          customer_phone: input.phone!,
          delivery_address: input.address!,
          delivery_instructions: input.delivery_instructions,
        });
      } catch {
        // PROFILE_ENCRYPTION_SECRET missing — token feature unavailable;
        // executor still emits the cart so the caller can decide.
      }
      // Per-chosen-restaurant compatibility assessment for the artifact.
      // Address is geocoded best-effort; null falls through to coverage
      // `requires_address`.
      const userGeo = await geocodeAddress(input.address!);
      const compatibility = assessCompatibility(
        restaurant,
        userGeo?.lat,
        userGeo?.lng,
        input.intent_style,
      );
      eventBus.publish(
        artifact(taskId, contextId, "proposed_cart", {
          restaurant_id: restaurant.id,
          restaurant_name: restaurant.name,
          restaurant_phone: restaurant.phone,
          items,
          cart,
          estimated_total: estimatedTotal,
          delivery_to: input.address,
          customer_name: input.name,
          customer_phone: input.phone,
          delivery_instructions: input.delivery_instructions ?? null,
          payment: "Cash on delivery",
          confirmation_token: proposedToken,
          confirmation_token_ttl_seconds: proposedToken ? 600 : undefined,
          compatibility,
        }),
      );
      const customizationSurface = buildCustomizationSurface(restaurant, cart);
      if (
        !input.cart?.length &&
        hasCustomizationOpportunities(customizationSurface)
      ) {
        eventBus.publish(
          artifact(taskId, contextId, "customization_options", {
            ...customizationSurface,
            upsell_turn_rules: UPSELL_TURN_RULES,
            order_flow:
              "start_pizza_order → upsell turn → update_order(diff) → ask for special instructions → show full cart → user confirms → prepare_order → place_order",
          }),
        );
        eventBus.publish(
          status(
            taskId,
            contextId,
            "input-required",
            `Proposed cart from ${restaurant.name}. Apply one concise upsell turn, then re-submit with cart to receive a fresh proposed_cart token.`,
            true,
          ),
        );
        return;
      }
      eventBus.publish(
        status(
          taskId,
          contextId,
          "input-required",
          proposedToken
            ? `Proposed cart from ${restaurant.name}. Re-submit the same params with confirmed:true AND confirmation_token from the artifact to place the order.`
            : `Proposed cart from ${restaurant.name}. Re-submit the same params with confirmed:true to place the order.`,
          true,
        ),
      );
      return;
    }

    // confirmed=true → place the order
    eventBus.publish(
      status(
        taskId,
        contextId,
        "working",
        "Resolving restaurant and dispatching call…",
      ),
    );

    let restaurants;
    try {
      restaurants = await findNearbyRestaurants(input.address!);
    } catch (e) {
      eventBus.publish(
        status(
          taskId,
          contextId,
          "failed",
          `Restaurant lookup failed: ${e instanceof Error ? e.message : String(e)}`,
          true,
        ),
      );
      return;
    }
    const restaurant =
      restaurants.find((r) => r.id === input.restaurant_id) ??
      restaurants.find((r) =>
        input.restaurant_hint
          ? r.name.toLowerCase().includes(input.restaurant_hint.toLowerCase())
          : false,
      ) ??
      restaurants[0];
    if (!restaurant) {
      eventBus.publish(
        status(
          taskId,
          contextId,
          "failed",
          "No restaurants near that address.",
          true,
        ),
      );
      return;
    }
    const restaurantPhone = getRestaurantPhone(restaurant.id);
    if (!restaurantPhone) {
      eventBus.publish(
        status(
          taskId,
          contextId,
          "failed",
          "Restaurant phone not resolvable server-side.",
          true,
        ),
      );
      return;
    }
    const items: OrderItem[] = input.items?.length
      ? input.items
      : input.intent_style
        ? orderFromIntent(restaurant, {
            style: input.intent_style,
            size: input.intent_size,
            quantity: input.intent_quantity,
          })
        : input.occasion
          ? (COLD_PRESETS.find((p) => p.id === input.occasion)?.items(
              restaurant,
              input.headcount ?? 4,
            ) ?? [])
          : [];
    const finalCart = input.cart?.length ? input.cart : undefined;

    if (!finalCart?.length && !items.length) {
      eventBus.publish(
        status(
          taskId,
          contextId,
          "failed",
          "Could not derive any order items.",
          true,
        ),
      );
      return;
    }

    // Confirmation gate. When REQUIRE_CONFIRMATION_TOKEN=1, the caller must
    // present the confirmation_token from a prior input-required artifact.
    // Stops adversarial callers from setting confirmed:true on a first
    // message and skipping cart-show.
    const requireToken = process.env.REQUIRE_CONFIRMATION_TOKEN === "1";
    if (input.confirmation_token) {
      const verdict = verifyToken(input.confirmation_token, {
        restaurant_id: restaurant.id,
        items,
        cart: finalCart,
        customer_name: input.name!,
        customer_phone: input.phone!,
        delivery_address: input.address!,
        delivery_instructions: input.delivery_instructions,
      });
      if (!verdict.ok) {
        eventBus.publish(
          status(
            taskId,
            contextId,
            "failed",
            `Confirmation token rejected: ${verdict.reason}. Re-submit without confirmed to receive a fresh proposed_cart with a new token.`,
            true,
          ),
        );
        return;
      }
    } else if (requireToken) {
      eventBus.publish(
        status(
          taskId,
          contextId,
          "failed",
          "confirmation_token required. Submit without confirmed:true first to receive a proposed_cart with a token, then resubmit with confirmed:true and that token.",
          true,
        ),
      );
      return;
    }

    // Second-pass compatibility (PRD-V2-DELTA M-5). Block on no_go unless
    // override_compatibility is set. Caller must explicitly opt-in to bypass.
    const userGeo = await geocodeAddress(input.address!);
    const assessment = assessCompatibility(
      restaurant,
      userGeo?.lat,
      userGeo?.lng,
      input.intent_style,
    );
    if (assessment.overall === "no_go" && !input.override_compatibility) {
      eventBus.publish(
        status(
          taskId,
          contextId,
          "failed",
          `Order blocked by compatibility check (${assessment.delivery.state}/${assessment.coverage.state}/${assessment.item.state}). ${assessment.nextStep ?? ""} Pass override_compatibility:true if the user explicitly approved.`,
          true,
        ),
      );
      return;
    }
    if (assessment.overall === "no_go" && input.override_compatibility) {
      logCompatibilityOverride({
        restaurant_id: restaurant.id,
        user_intent: input.intent_style ?? null,
        assessment,
        source: "a2a",
      });
    }
    // likely_available also requires call-side confirmation (compliance C-003 / M-7).
    const itemAvailabilityUnknown =
      assessment.item.state === "unknown" ||
      assessment.item.state === "likely_available";

    const orderRequest: PlaceOrderRequest = {
      restaurantName: restaurant.name,
      restaurantPhone,
      items: items.length ? items : undefined,
      cart: finalCart,
      deliveryAddress: input.address!,
      customerName: input.name!,
      customerPhone: input.phone!,
      deliveryInstructions: input.delivery_instructions,
      maxTotal: input.max_total,
      dietaryRequirements: input.dietary,
      itemAvailabilityUnknown,
      intentStyle: input.intent_style,
    };

    let callId: string;
    try {
      const dispatched = await dispatchCall(orderRequest);
      callId = dispatched.callId;
    } catch (e) {
      eventBus.publish(
        status(
          taskId,
          contextId,
          "failed",
          `Bland dispatch failed: ${e instanceof Error ? e.message : String(e)}`,
          true,
        ),
      );
      return;
    }

    eventBus.publish(
      artifact(taskId, contextId, "call_dispatched", {
        call_id: callId,
        restaurant: restaurant.name,
        items,
        cart: finalCart,
      }),
    );
    eventBus.publish(
      status(
        taskId,
        contextId,
        "working",
        `Calling ${restaurant.name} (call_id: ${callId}). This typically takes 2–3 minutes.`,
      ),
    );

    const startedAt = Date.now();
    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      if (this.cancelled.has(taskId)) return;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      let st;
      try {
        st = await getCallStatus(callId);
      } catch (e) {
        eventBus.publish(
          status(
            taskId,
            contextId,
            "working",
            `Status check error (will retry): ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
        continue;
      }
      if (st.status === "completed" || st.status === "failed") {
        eventBus.publish(
          artifact(taskId, contextId, "order_receipt", {
            call_id: callId,
            status: st.status,
            duration_seconds: st.duration,
            summary: st.summary,
            transcript: st.transcript,
            order_confirmed: st.parsedResult?.orderConfirmed ?? false,
            total_quoted: st.parsedResult?.totalQuoted,
            estimated_minutes: st.parsedResult?.estimatedMinutes,
            substitutions: st.parsedResult?.substitutionsMade,
            issues: st.parsedResult?.issuesEncountered,
          }),
        );
        const finalState = st.parsedResult?.orderConfirmed
          ? "completed"
          : "failed";
        eventBus.publish(
          status(
            taskId,
            contextId,
            finalState,
            st.parsedResult?.orderConfirmed
              ? "Order confirmed by restaurant."
              : "Call ended without confirmed order.",
            true,
          ),
        );
        return;
      }
      eventBus.publish(
        status(taskId, contextId, "working", `Call status: ${st.status}…`),
      );
    }

    eventBus.publish(
      status(
        taskId,
        contextId,
        "failed",
        "Polling timed out after 5 minutes without terminal call status.",
        true,
      ),
    );
  }
}
