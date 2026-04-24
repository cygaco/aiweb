import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import rateLimit from "express-rate-limit";
import { createServer } from "./server.js";

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

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.headers.authorization ?? req.ip ?? "unknown",
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate limit exceeded" },
});

const placeOrderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.headers.authorization ?? req.ip ?? "unknown",
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
      return true;
    }
  },
});

const app = createMcpExpressApp({
  host: HOST,
  ...(ALLOWED_HOSTS.length > 0 && { allowedHosts: ALLOWED_HOSTS }),
});

const server = createServer();

app.get("/healthz", (_req, res) => {
  res.status(200).type("text/plain").send("ok");
});

app.post(
  "/mcp",
  requireBearer,
  globalLimiter,
  placeOrderLimiter,
  async (req, res) => {
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

app.get("/mcp", requireBearer, (_req, res) => {
  res.status(405).json({ error: "method not allowed in stateless mode" });
});

app.listen(PORT, HOST, () => {
  console.log(`AI Web MCP server listening on ${HOST}:${PORT} (POST /mcp)`);
});
