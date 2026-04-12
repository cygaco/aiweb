/**
 * Bland.ai connector for Wave 00.
 * Handles: prompt generation, call dispatch, transcript parsing.
 */

export interface OrderItem {
  name: string;
  size: string;
  quantity: number;
  price: number;
  substitution?: string; // what to get if unavailable
}

export interface PlaceOrderRequest {
  restaurantName: string;
  restaurantPhone: string;
  items: OrderItem[];
  deliveryAddress: string;
  customerName: string;
  customerPhone: string;
  deliveryInstructions?: string;
  maxTotal?: number;
  maxWaitMinutes?: number;
}

export interface BlandCallResponse {
  callId: string;
  status: "queued" | "in_progress" | "completed" | "failed";
}

export interface BlandCallStatus {
  callId: string;
  status: "queued" | "in_progress" | "completed" | "failed";
  duration?: number;
  transcript?: string;
  summary?: string;
  parsedResult?: {
    orderConfirmed: boolean;
    totalQuoted: number | null;
    estimatedMinutes: number | null;
    substitutionsMade: string[];
    issuesEncountered: string[];
  };
}

/**
 * Build the Bland prompt from an order request.
 * This is the "brain" of the phone call.
 */
export function buildCallPrompt(order: PlaceOrderRequest): string {
  const itemList = order.items
    .map((item) => {
      let line = `- ${item.quantity}x ${item.size} ${item.name} ($${item.price.toFixed(2)} each)`;
      if (item.substitution) {
        line += `\n  → If unavailable, substitute with: ${item.substitution}`;
      }
      return line;
    })
    .join("\n");

  const estimatedTotal = order.items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
  const maxTotal = order.maxTotal ?? estimatedTotal * 1.3; // 30% buffer
  const maxWait = order.maxWaitMinutes ?? 60;

  return `You are calling ${order.restaurantName} to place a delivery order.
Be polite, clear, and concise. You are a customer placing an order.

ORDER DETAILS:
${itemList}

DELIVERY INFO:
- Address: ${order.deliveryAddress}
- Name: ${order.customerName}
- Phone: ${order.customerPhone}
${order.deliveryInstructions ? `- Special instructions: ${order.deliveryInstructions}` : ""}
- Payment: CASH on delivery

EXPECTED TOTAL: approximately $${estimatedTotal.toFixed(2)}

RULES:
- If an item is unavailable and a substitution is listed, accept the substitution.
- If an item is unavailable and NO substitution is listed, skip that item.
- If the total they quote is over $${maxTotal.toFixed(2)}, say "That's more than I expected, let me check and call back" and end the call.
- If delivery time is over ${maxWait} minutes, that's fine — confirm the order.
- If they don't deliver to the address, ask about carryout instead.
- If they ask for a credit card, say "I'll be paying cash on delivery."
- NEVER provide a credit card number.
- NEVER agree to add items not in the order above.

BEFORE HANGING UP:
1. Read back the complete order to confirm.
2. Confirm the delivery address.
3. Confirm the estimated total.
4. Confirm the estimated delivery time.
5. Say "Thank you!" and end the call.

If they put you on hold for more than 2 minutes, hang up.
If you reach a voicemail, hang up.`;
}

// In-memory store for simulated calls
const simCalls = new Map<string, { order: PlaceOrderRequest; createdAt: number }>();

function buildSimTranscript(order: PlaceOrderRequest, total: number, eta: number): string {
  const items = order.items.map((i) => `${i.quantity} ${i.size} ${i.name}`).join(" and ");
  return [
    `Domino's Pizza: Thank you for calling Domino's, how can I help you today?`,
    `Agent: Hi, I'd like to place a delivery order please.`,
    `Domino's Pizza: Of course! What would you like to order?`,
    `Agent: I'd like ${items}.`,
    `Domino's Pizza: And what's the delivery address?`,
    `Agent: ${order.deliveryAddress}.`,
    `Domino's Pizza: Got it. Name for the order?`,
    `Agent: ${order.customerName}.`,
    `Domino's Pizza: Perfect. That'll be $${total.toFixed(2)} and it should be there in about ${eta} minutes. Paying cash on delivery?`,
    `Agent: Yes, cash on delivery is correct.`,
    `Domino's Pizza: Your order is confirmed! We'll have it ready in about ${eta} minutes. Thanks for calling!`,
    `Agent: Thank you, have a great day!`,
  ].join("\n");
}

/**
 * Dispatch a call via Bland.ai API.
 * Falls back to simulation mode when BLAND_API_KEY is not set.
 * When TEST_OVERRIDE_PHONE is set, routes every call to that number
 * instead of the real restaurant — use this to test live Bland calls
 * before going live.
 */
export async function dispatchCall(
  order: PlaceOrderRequest
): Promise<BlandCallResponse> {
  const apiKey = process.env.BLAND_API_KEY;

  if (!apiKey) {
    const callId = `sim_${Date.now()}`;
    simCalls.set(callId, { order, createdAt: Date.now() });
    return { callId, status: "queued" };
  }

  const testPhone = process.env.TEST_OVERRIDE_PHONE;
  const targetPhone = testPhone ?? order.restaurantPhone;
  const prompt = testPhone
    ? buildCallPrompt(order) +
      `\n\nTEST MODE: You are calling a developer who is playing the role of ${order.restaurantName}. Proceed exactly as you normally would.`
    : buildCallPrompt(order);

  const body: Record<string, unknown> = {
    phone_number: targetPhone,
    task: prompt,
    voice: "maya",
    max_duration: 5,
    record: true,
    wait_for_greeting: true,
  };
  if (process.env.BLAND_FROM_NUMBER) {
    body.from = process.env.BLAND_FROM_NUMBER;
  }

  const response = await fetch("https://api.bland.ai/v1/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Bland API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as { call_id: string; status: string };

  return {
    callId: data.call_id,
    status: "queued",
  };
}

/**
 * Check call status and get transcript.
 * Handles simulated calls (sim_*) when no BLAND_API_KEY is set.
 */
export async function getCallStatus(
  callId: string
): Promise<BlandCallStatus> {
  if (callId.startsWith("sim_")) {
    const sim = simCalls.get(callId);
    if (!sim) throw new Error(`Unknown simulated call: ${callId}`);

    const ageMs = Date.now() - sim.createdAt;
    if (ageMs < 10_000) {
      return { callId, status: "in_progress" };
    }

    const total = sim.order.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const eta = 30;
    const transcript = buildSimTranscript(sim.order, total, eta);

    return {
      callId,
      status: "completed",
      duration: 95,
      transcript,
      summary: `[SIMULATED] Order confirmed. Total: $${total.toFixed(2)}. ETA: ${eta} min.`,
      parsedResult: {
        orderConfirmed: true,
        totalQuoted: total,
        estimatedMinutes: eta,
        substitutionsMade: [],
        issuesEncountered: [],
      },
    };
  }

  const apiKey = process.env.BLAND_API_KEY;
  if (!apiKey) {
    throw new Error("BLAND_API_KEY not set in environment");
  }

  const response = await fetch(`https://api.bland.ai/v1/calls/${callId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Bland API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    status: string;
    call_length?: number;
    concatenated_transcript?: string;
    summary?: string;
  };

  const result: BlandCallStatus = {
    callId,
    status: mapBlandStatus(data.status),
    duration: data.call_length,
    transcript: data.concatenated_transcript,
    summary: data.summary,
  };

  // If call is completed, parse the transcript for order confirmation
  if (result.status === "completed" && result.transcript) {
    result.parsedResult = parseTranscript(result.transcript);
  }

  return result;
}

function mapBlandStatus(
  status: string
): "queued" | "in_progress" | "completed" | "failed" {
  switch (status) {
    case "completed":
      return "completed";
    case "in_progress":
    case "ringing":
      return "in_progress";
    case "failed":
    case "error":
    case "no_answer":
    case "voicemail":
      return "failed";
    default:
      return "queued";
  }
}

/**
 * Parse a call transcript to extract order confirmation details.
 * MVP: Simple keyword matching. Post-MVP: LLM-powered extraction.
 */
function parseTranscript(transcript: string): BlandCallStatus["parsedResult"] {
  const lower = transcript.toLowerCase();

  const orderConfirmed =
    lower.includes("order") &&
    (lower.includes("confirm") ||
      lower.includes("got it") ||
      lower.includes("ready") ||
      lower.includes("be there") ||
      lower.includes("on its way") ||
      lower.includes("minutes"));

  // Try to extract total
  const totalMatch = transcript.match(
    /\$(\d+\.?\d{0,2})/g
  );
  const totalQuoted = totalMatch
    ? parseFloat(totalMatch[totalMatch.length - 1].replace("$", ""))
    : null;

  // Try to extract delivery time
  const timeMatch = lower.match(/(\d+)\s*(minutes?|mins?)/);
  const estimatedMinutes = timeMatch ? parseInt(timeMatch[1]) : null;

  // Check for substitutions
  const substitutionsMade: string[] = [];
  if (lower.includes("out of") || lower.includes("don't have") || lower.includes("unavailable")) {
    substitutionsMade.push("Item substitution detected — check transcript");
  }

  // Check for issues
  const issuesEncountered: string[] = [];
  if (lower.includes("don't deliver") || lower.includes("outside")) {
    issuesEncountered.push("Delivery area issue");
  }
  if (lower.includes("closed")) {
    issuesEncountered.push("Restaurant may be closed");
  }
  if (lower.includes("voicemail") || lower.includes("no answer")) {
    issuesEncountered.push("Could not reach restaurant");
  }

  return {
    orderConfirmed,
    totalQuoted,
    estimatedMinutes,
    substitutionsMade,
    issuesEncountered,
  };
}
