import { NextRequest, NextResponse } from "next/server";

// Simple in-memory IP-keyed rate limiter.
// Limits: 20 requests per 60-second window per IP on /api/chat.
//
// NOTE: This map resets on every cold start and is NOT shared across instances.
// A multi-instance / serverless deployment needs a Redis-backed store (e.g.
// Upstash) to enforce limits cluster-wide. Acceptable for dev and
// single-machine production.

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 20;

type WindowEntry = { count: number; windowStart: number };
const ipWindows = new Map<string, WindowEntry>();

export function middleware(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  const now = Date.now();
  const entry = ipWindows.get(ip);

  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    // Start a fresh window for this IP.
    ipWindows.set(ip, { count: 1, windowStart: now });
    return NextResponse.next();
  }

  if (entry.count >= MAX_REQUESTS) {
    const retryAfter = Math.ceil(
      (WINDOW_MS - (now - entry.windowStart)) / 1000,
    );
    return new NextResponse(
      JSON.stringify({ error: "Too many requests — please wait a moment." }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retryAfter),
        },
      },
    );
  }

  entry.count += 1;
  return NextResponse.next();
}

// Only run this middleware for the chat endpoint.
export const config = {
  matcher: ["/api/chat"],
};
