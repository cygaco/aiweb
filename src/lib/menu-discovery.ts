/**
 * Menu discovery — real evidence upstream of the compatibility gate.
 *
 * For non-Domino's restaurants, Places API returns a generic 3-item menu that
 * produces false `likely_available` signals. This module fetches the
 * restaurant's website and uses Claude to extract real menu items and delivery
 * cues, enriching the Restaurant object before re-running compatibility checks.
 *
 * Design decisions (Beta Q1–Q8, 2026-05-07):
 *  - Hybrid live+cache+freshness (Q1) — cache miss → fetch → write; cache hit → use
 *  - One module for menu + delivery cues (Q3) — same fetch, avoid double cost
 *  - Enrich top-1 caution restaurant only; ENRICH_COUNT env flag (Q4)
 *  - Fail-open (Q5) — on error/timeout, return restaurant unchanged
 *  - Source tag: 'restaurant_website' on success (Q8)
 *
 * Time caps: 3s fetch, 4s total (including Claude call). Both are abort-signal
 * enforced — not just promise races — so connections are actually closed.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type {
  Restaurant,
  PizzaMenuItem,
  MenuItem,
} from "../data/restaurants.js";
import type { Drink } from "./cart.js";
import { logMenuDiscoveryDrinksEvent } from "./event-log.js";

// ─── Config ─────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 3_000;
const TOTAL_TIMEOUT_MS = 4_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const ENRICH_COUNT = Number(process.env.ENRICH_COUNT ?? "1");

// Read at call-time so tests can set MENU_CACHE_DIR before importing.
function cacheDir(): string {
  return process.env.MENU_CACHE_DIR ?? "runtime/menu-cache";
}

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─── Cache ───────────────────────────────────────────────────────────────────

interface CachedMenuResult {
  discoveredAt: string;
  source: "restaurant_website";
  pizzas: PizzaMenuItem[];
  sides: MenuItem[];
  drinks: Drink[];
  deliveryCues: DeliveryCues;
}

interface DeliveryCues {
  offersDelivery: boolean | null;
  deliveryRadiusMiles: number | null;
  rawSignal: string | null;
}

function cachePath(restaurantId: string): string {
  return join(cacheDir(), `${restaurantId}.json`);
}

function isValidDeliveryCues(d: unknown): d is DeliveryCues {
  if (!d || typeof d !== "object") return false;
  const obj = d as Record<string, unknown>;
  const okOffers =
    obj.offersDelivery === null || typeof obj.offersDelivery === "boolean";
  const okRadius =
    obj.deliveryRadiusMiles === null ||
    typeof obj.deliveryRadiusMiles === "number";
  const okSignal = obj.rawSignal === null || typeof obj.rawSignal === "string";
  return okOffers && okRadius && okSignal;
}

function isValidDrink(d: unknown): boolean {
  if (!d || typeof d !== "object") return false;
  const obj = d as Record<string, unknown>;
  if (typeof obj.id !== "string" || obj.id.length === 0) return false;
  if (typeof obj.name !== "string" || obj.name.length === 0) return false;
  if (!Array.isArray(obj.sizes) || obj.sizes.length === 0) return false;
  for (const s of obj.sizes) {
    if (!s || typeof s !== "object") return false;
    const sz = s as Record<string, unknown>;
    if (typeof sz.id !== "string" || sz.id.length === 0) return false;
    if (typeof sz.name !== "string" || sz.name.length === 0) return false;
    if (
      typeof sz.price !== "number" ||
      !Number.isFinite(sz.price) ||
      sz.price < 0
    )
      return false;
  }
  return true;
}

function isValidCachedMenuResult(raw: unknown): raw is CachedMenuResult {
  if (!raw || typeof raw !== "object") return false;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.discoveredAt !== "string") return false;
  if (obj.source !== "restaurant_website") return false;
  if (!Array.isArray(obj.pizzas) || !Array.isArray(obj.sides)) return false;
  if (!Array.isArray(obj.drinks)) return false;
  if (!obj.drinks.every(isValidDrink)) return false;
  if (!isValidDeliveryCues(obj.deliveryCues)) return false;
  return true;
}

function readCache(restaurantId: string): CachedMenuResult | null {
  try {
    const p = cachePath(restaurantId);
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, "utf8")) as unknown;
    // Shape validation — malformed cache (e.g. older schema, partial write,
    // hand-edited file) returns miss instead of throwing in applyEnrichment.
    if (!isValidCachedMenuResult(raw)) return null;
    const age = Date.now() - new Date(raw.discoveredAt).getTime();
    if (!Number.isFinite(age) || age > CACHE_TTL_MS) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeCache(restaurantId: string, result: CachedMenuResult): void {
  try {
    mkdirSync(cacheDir(), { recursive: true });
    writeFileSync(cachePath(restaurantId), JSON.stringify(result, null, 2));
  } catch {
    /* fail-open — cache write failure is not fatal */
  }
}

// ─── Website fetch ───────────────────────────────────────────────────────────

async function fetchWebsite(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AIWebBot/1.0)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Body-too-large fail-open: a 500KB+ page is almost certainly not a real
    // menu we can parse usefully (load-test, attack, or framework bloat).
    // Refuse rather than truncating + extracting noise.
    if (html.length > 500_000) return null;
    // Trim to 15k chars — enough for menu section, avoids giant context.
    return html.slice(0, 15_000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── LLM extraction ─────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are extracting pizza menu and delivery information from restaurant website HTML.

Return a JSON object with exactly this shape (no markdown, no explanation):
{
  "pizzas": [
    { "name": "string", "description": "string or null", "sizes": [{ "name": "string", "price": number }] }
  ],
  "sides": [
    { "name": "string", "sizes": [{ "name": "string", "price": number }] }
  ],
  "drinks": [
    { "name": "string", "brand": "string|null", "sizes": [{ "name": "string", "price": number }] }
  ],
  "deliveryCues": {
    "offersDelivery": true | false | null,
    "deliveryRadiusMiles": number | null,
    "rawSignal": "short quote from page proving delivery status, or null"
  }
}

Rules:
- Include only pizzas you see explicitly named on the page (not generic categories)
- If no pizza menu found, return empty "pizzas" array
- If delivery status unclear, set offersDelivery to null
- Prices must be numbers (e.g. 12.99), not strings
- Return at most 15 pizzas
- Include only drinks you see explicitly named on the page (e.g. "Coke 20oz $2.50"). If no drinks found, return empty "drinks" array.
- Common size strings: "20 oz", "2 L", "Can". Prefer the page's literal wording.`;

interface ExtractedMenu {
  pizzas: PizzaMenuItem[];
  sides: MenuItem[];
  drinks: Drink[];
  deliveryCues: DeliveryCues;
}

async function extractMenuFromHtml(
  html: string,
  restaurantName: string,
  signal: AbortSignal,
): Promise<ExtractedMenu | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });

  try {
    const msg = await client.messages.create(
      {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: `Restaurant: ${restaurantName}\n\nHTML:\n${html}\n\n${EXTRACTION_PROMPT}`,
          },
        ],
      },
      { signal },
    );

    const text = msg.content[0]?.type === "text" ? msg.content[0].text : null;
    if (!text) return null;

    // Strip markdown code fences if present
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    const parsed = JSON.parse(cleaned) as unknown;
    // Shape validation — fail-open if Claude returns a partial/malformed
    // schema. Without deliveryCues the call to applyEnrichment would throw.
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.pizzas) || !Array.isArray(obj.sides)) return null;
    if (obj.drinks !== undefined && !Array.isArray(obj.drinks)) return null;
    if (obj.drinks === undefined) obj.drinks = [];
    if (!isValidDeliveryCues(obj.deliveryCues)) return null;

    // Post-process drinks: generate stable ids from brand+size slug
    const rawDrinks = (obj.drinks ?? []) as Array<Record<string, unknown>>;
    const drinks: Drink[] = [];
    for (const d of rawDrinks) {
      const name = typeof d.name === "string" ? d.name : "";
      const brand =
        typeof d.brand === "string" && d.brand.length > 0 ? d.brand : undefined;
      const rawSizes = Array.isArray(d.sizes)
        ? (d.sizes as Array<Record<string, unknown>>)
        : [];
      const sizes = rawSizes
        .filter(
          (s): s is Record<string, unknown> => !!s && typeof s === "object",
        )
        .map((s): { id: string; name: string; price: number } | null => {
          const name = typeof s.name === "string" ? s.name : "";
          // IN-1: non-numeric or invalid price → drop the size (fail-open).
          // Coercing to 0 would fabricate a free item — instead treat as invalid.
          const price =
            typeof s.price === "number" &&
            Number.isFinite(s.price) &&
            s.price >= 0
              ? s.price
              : null;
          const id = slug(name);
          if (id.length === 0 || name.length === 0 || price === null)
            return null;
          return { id, name, price };
        })
        .filter(
          (s): s is { id: string; name: string; price: number } => s !== null,
        );
      if (!name || sizes.length === 0) continue;
      const idBase = slug(
        brand ? `${brand}-${sizes[0].name}` : `${name}-${sizes[0].name}`,
      );
      if (!idBase) continue;
      drinks.push({ id: idBase, name, brand, sizes });
    }

    return {
      pizzas: obj.pizzas as PizzaMenuItem[],
      sides: obj.sides as MenuItem[],
      drinks,
      deliveryCues: obj.deliveryCues as DeliveryCues,
    };
  } catch {
    return null;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface EnrichmentResult {
  enriched: Restaurant;
  source: "restaurant_website" | "cache" | "unchanged";
  deliveryCues: DeliveryCues | null;
}

/**
 * Attempt to enrich a restaurant's menu and delivery evidence from its website.
 *
 * Returns the original restaurant unchanged (source: 'unchanged') if:
 *  - restaurant has no website field
 *  - fetch times out or fails
 *  - Claude extraction fails or times out
 *  - ANTHROPIC_API_KEY not set
 *
 * On cache hit (within 24h TTL), returns source: 'cache' without a network call.
 */
export async function enrichEvidence(
  restaurant: Restaurant,
  _intentStyle?: string,
): Promise<EnrichmentResult> {
  const unchanged: EnrichmentResult = {
    enriched: restaurant,
    source: "unchanged",
    deliveryCues: null,
  };

  // TR-1: track total elapsed time from the start of this call.
  const startMs = Date.now();

  // Domino's has its own provider adapter (src/connectors/dominos.ts) with
  // truthful API data. Even if a future commit populates restaurant.website
  // with dominos.com, we don't want a generic marketing page overwriting the
  // local-store API data. Beta DECIDE 2026-05-07 Q6 directive: adapter unchanged.
  if (restaurant.id.startsWith("dominos_")) return unchanged;

  // Cache check first — no network needed
  const cached = readCache(restaurant.id);
  if (cached) {
    return {
      enriched: applyEnrichment(
        restaurant,
        cached,
        "cache",
        startMs,
        _intentStyle,
      ),
      source: "cache",
      deliveryCues: cached.deliveryCues,
    };
  }

  const website = restaurant.website;
  if (!website) return unchanged;

  // Total time budget enforced via AbortController
  const totalController = new AbortController();
  const totalTimer = setTimeout(
    () => totalController.abort(),
    TOTAL_TIMEOUT_MS,
  );

  try {
    const html = await fetchWebsite(website);
    if (!html || totalController.signal.aborted) return unchanged;

    const extracted = await extractMenuFromHtml(
      html,
      restaurant.name,
      totalController.signal,
    );
    if (!extracted || totalController.signal.aborted) return unchanged;

    // Only update if we got at least one real pizza
    if (extracted.pizzas.length === 0) return unchanged;

    const cacheEntry: CachedMenuResult = {
      discoveredAt: new Date().toISOString(),
      source: "restaurant_website",
      pizzas: extracted.pizzas,
      sides: extracted.sides,
      drinks: extracted.drinks,
      deliveryCues: extracted.deliveryCues,
    };
    writeCache(restaurant.id, cacheEntry);

    return {
      enriched: applyEnrichment(
        restaurant,
        cacheEntry,
        "restaurant_website",
        startMs,
        _intentStyle,
      ),
      source: "restaurant_website",
      deliveryCues: extracted.deliveryCues,
    };
  } finally {
    clearTimeout(totalTimer);
  }
}

function applyEnrichment(
  restaurant: Restaurant,
  data: CachedMenuResult,
  source: "restaurant_website" | "cache",
  startMs: number,
  intentStyle: string | undefined,
): Restaurant {
  const enriched: Restaurant = {
    ...restaurant,
    menuSource: "restaurant_website",
    menu: {
      ...restaurant.menu,
      pizzas: data.pizzas,
      sides: data.sides.length > 0 ? data.sides : restaurant.menu.sides,
      drinks: data.drinks.length > 0 ? data.drinks : restaurant.menu.drinks,
    },
  };

  // Apply delivery cues if discovered
  if (
    data.deliveryCues.offersDelivery === true &&
    enriched.serviceType === "unknown"
  ) {
    enriched.serviceType = "delivery";
  } else if (
    data.deliveryCues.offersDelivery === false &&
    enriched.serviceType === "unknown"
  ) {
    enriched.serviceType = "pickup_only";
  }

  if (
    data.deliveryCues.deliveryRadiusMiles !== null &&
    enriched.deliveryRadius === null
  ) {
    enriched.deliveryRadius = data.deliveryCues.deliveryRadiusMiles;
  }

  // TR-1: emit full-field event — restaurant_id, drinks_count, source, durationMs, intent_style.
  if (data.drinks.length > 0) {
    logMenuDiscoveryDrinksEvent({
      restaurant_id: restaurant.id,
      drinks_count: data.drinks.length,
      source,
      durationMs: Date.now() - startMs,
      intent_style: intentStyle ?? null,
    });
  }

  return enriched;
}
