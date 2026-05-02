#!/usr/bin/env node
/**
 * a2a-client.js — minimal Agent2Agent client to test the deployed Pizza
 * Concierge end-to-end. Dogfoods our own A2A surface as if a stranger
 * agent were calling it.
 *
 * Usage:
 *   node scripts/one-off/a2a-client.js card                 # fetch agent card
 *   node scripts/one-off/a2a-client.js cart                 # submit non-confirmed task → input-required + token
 *   node scripts/one-off/a2a-client.js confirm <token> <restaurant_id>
 *                                                            # submit confirmed task → DISPATCHES REAL BLAND CALL
 *
 * Env:
 *   AIWEB_MCP_URL or A2A_BASE  (defaults to https://aiweb-mcp.fly.dev)
 *   WARP_MCP_KEY               (bearer; loaded from .env if present)
 */

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

// minimal .env loader so the script works without dotenv
function loadEnv() {
  const envPath = path.join(__dirname, "..", "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

const BASE = (process.env.A2A_BASE || "https://aiweb-mcp.fly.dev").replace(
  /\/+$/,
  "",
);
const KEY = process.env.WARP_MCP_KEY || process.env.AIWEB_MCP_KEY;
if (!KEY) {
  console.error("FATAL: WARP_MCP_KEY (or AIWEB_MCP_KEY) not set");
  process.exit(1);
}

async function fetchCard() {
  const res = await fetch(`${BASE}/.well-known/agent-card.json`);
  if (!res.ok) throw new Error(`card fetch failed: HTTP ${res.status}`);
  return res.json();
}

async function rpc(method, params) {
  const res = await fetch(`${BASE}/a2a`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return JSON.parse(text);
}

function printTask(envelope, label) {
  const t = envelope.result;
  console.log(`\n── ${label} ──`);
  console.log("task id:    ", t.id);
  console.log("context id: ", t.contextId);
  console.log("state:      ", t.status?.state);
  if (t.status?.message?.parts?.[0]?.text) {
    console.log("agent says: ", t.status.message.parts[0].text);
  }
  for (const a of t.artifacts ?? []) {
    console.log(`\nartifact: ${a.name}`);
    for (const p of a.parts) {
      if (p.kind === "data") {
        console.log(JSON.stringify(p.data, null, 2));
      } else if (p.kind === "text") {
        console.log(p.text);
      }
    }
  }
}

async function cmdCard() {
  const card = await fetchCard();
  console.log("name:             ", card.name);
  console.log("version:          ", card.version);
  console.log("protocolVersion:  ", card.protocolVersion);
  console.log("preferredTransport:", card.preferredTransport);
  console.log("url:              ", card.url);
  console.log("auth:             ", JSON.stringify(card.security));
  console.log("skills:           ", card.skills.map((s) => s.id).join(", "));
}

async function cmdCart() {
  const env = await rpc("message/send", {
    message: {
      kind: "message",
      messageId: randomUUID(),
      role: "user",
      parts: [
        {
          kind: "data",
          data: {
            address: "123 Main St, San Francisco",
            name: "Test Caller",
            phone: "+14155551234",
            intent_style: "pepperoni",
            headcount: 2,
          },
        },
      ],
    },
  });
  printTask(env, "STEP 1: cart proposed (no confirmation)");
  const cart = env.result.artifacts?.[0]?.parts?.[0]?.data;
  if (cart?.confirmation_token) {
    console.log("\n── to confirm and dispatch the call, run: ──");
    console.log(
      `node scripts/one-off/a2a-client.js confirm "${cart.confirmation_token}" "${cart.restaurant_id}"`,
    );
    console.log(
      "  ⚠️  this will trigger a real Bland.ai voice call to the restaurant.",
    );
  }
}

async function cmdConfirm() {
  const token = process.argv[3];
  const restaurantId = process.argv[4];
  if (!token || !restaurantId) {
    console.error(
      'Usage: node scripts/one-off/a2a-client.js confirm "<token>" "<restaurant_id>"',
    );
    process.exit(1);
  }
  const env = await rpc("message/send", {
    message: {
      kind: "message",
      messageId: randomUUID(),
      role: "user",
      parts: [
        {
          kind: "data",
          data: {
            address: "123 Main St, San Francisco",
            name: "Test Caller",
            phone: "+14155551234",
            intent_style: "pepperoni",
            headcount: 2,
            restaurant_id: restaurantId,
            confirmed: true,
            confirmation_token: token,
          },
        },
      ],
    },
  });
  printTask(env, "STEP 2: confirmed → dispatched");
}

const cmd = process.argv[2] || "cart";
const handlers = { card: cmdCard, cart: cmdCart, confirm: cmdConfirm };
const handler = handlers[cmd];
if (!handler) {
  console.error(`unknown command: ${cmd}`);
  console.error("commands: card | cart | confirm <token> <restaurant_id>");
  process.exit(1);
}
handler().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
