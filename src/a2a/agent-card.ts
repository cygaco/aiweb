import type { AgentCard } from "@a2a-js/sdk";

const PUBLIC_BASE = process.env.A2A_PUBLIC_URL ?? "https://aiweb-mcp.fly.dev";

export const agentCard: AgentCard = {
  protocolVersion: "0.3.0",
  name: "Pizza Concierge",
  description:
    "Orders real pizza from real pizzerias by calling them via Bland.ai voice. Cash on delivery, US only. Wave 00 of The AI Web.",
  url: `${PUBLIC_BASE}/a2a`,
  preferredTransport: "JSONRPC",
  version: "0.1.0",
  provider: {
    organization: "Agents for All",
    url: "https://agentsforall.co",
  },
  documentationUrl: `${PUBLIC_BASE}/`,
  defaultInputModes: ["text/plain", "application/json"],
  defaultOutputModes: ["application/json"],
  capabilities: {
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: false,
  },
  securitySchemes: {
    bearer: {
      type: "http",
      scheme: "bearer",
      description:
        "Bearer token issued by the operator. Required for /a2a task submission and /mcp; rate-limited per-bearer. No per-user data binding — the same operator-level bearer authorizes every caller in this deployment.",
    },
  },
  security: [{ bearer: [] }],
  skills: [
    {
      id: "order_pizza",
      name: "Order pizza",
      description:
        "Order a pizza for delivery from a nearby restaurant. The agent finds candidate restaurants, builds a cart from research-backed presets and the requester's preferences, then calls the restaurant by voice and confirms the order. Cash on delivery only. Caller MUST set confirmed=true to commit; the agent will not call restaurants speculatively.",
      tags: ["food", "delivery", "voice"],
      inputModes: ["application/json"],
      outputModes: ["application/json"],
      examples: [
        '{ "address": "123 Main St", "intent_style": "pepperoni", "headcount": 2, "name": "Alex", "phone": "+14155551234", "confirmed": true }',
        '{ "address": "123 Main St", "occasion": "game_day", "headcount": 8, "name": "Alex", "phone": "+14155551234", "confirmed": true }',
      ],
    },
  ],
};
