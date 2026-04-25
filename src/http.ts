import crypto from "node:crypto";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import rateLimit from "express-rate-limit";
import { createServer } from "./server.js";
import { initProfileStore } from "./lib/profile-store.js";

const PORT = parseInt(process.env.PORT ?? "8080", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const WARP_MCP_KEY = process.env.WARP_MCP_KEY;
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

if (!WARP_MCP_KEY) {
  console.error("FATAL: WARP_MCP_KEY not set. Refusing to start.");
  process.exit(1);
}

if (!process.env.PROFILE_ENCRYPTION_SECRET) {
  console.error("FATAL: PROFILE_ENCRYPTION_SECRET not set. Refusing to start.");
  process.exit(1);
}

initProfileStore();

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function requireBearer(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const token = header.slice("Bearer ".length);
  if (!safeEqual(token, WARP_MCP_KEY!)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

// keyGenerator hashes the Authorization header so the live bearer token is
// never held verbatim in the rate-limiter's in-memory key store.
const bearerKey = (req: Request) =>
  crypto
    .createHash("sha256")
    .update(req.headers.authorization ?? "unknown")
    .digest("hex");

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: bearerKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate limit exceeded" },
});

const placeOrderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: bearerKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "place_order rate limit exceeded" },
  skip: (req) => {
    try {
      const body = req.body as Record<string, unknown>;
      return (
        body?.method !== "tools/call" ||
        (body?.params as Record<string, unknown>)?.name !== "place_order"
      );
    } catch {
      return false;
    }
  },
});

const app = express();
app.use(express.json());

// Unauthenticated health probes — Fly internal health check hits these
// without the public Host header, so they must be registered BEFORE host
// validation and BEFORE auth.
app.get("/", (_req, res) => {
  res.status(200).type("text/plain").send("aiweb-mcp");
});

app.get("/healthz", (_req, res) => {
  res.status(200).type("text/plain").send("ok");
});

// Host header validation is scoped to /mcp only — closes DNS rebinding
// for the authenticated MCP surface without blocking internal health probes.
const mcpChain: express.RequestHandler[] = [
  ...(ALLOWED_HOSTS.length > 0 ? [hostHeaderValidation(ALLOWED_HOSTS)] : []),
  requireBearer,
];

app.post(
  "/mcp",
  ...mcpChain,
  globalLimiter,
  placeOrderLimiter,
  async (req, res) => {
    // Per-request server + transport: MCP SDK's Protocol.connect() throws on
    // a second connect() call (shared/protocol.js:219-222). Stateless mode
    // requires a fresh Protocol instance per connection.
    const token = (req.headers.authorization ?? "").slice("Bearer ".length);
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const server = createServer(tokenHash);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    res.on("close", () => {
      transport.close().catch(() => undefined);
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("mcp request error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "internal error" });
      }
    }
  },
);

app.get("/mcp", ...mcpChain, (_req, res) => {
  res.status(405).json({ error: "method not allowed in stateless mode" });
});

app.listen(PORT, HOST, () => {
  console.log(`AI Web MCP server listening on ${HOST}:${PORT} (POST /mcp)`);
});
