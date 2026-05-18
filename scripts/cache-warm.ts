#!/usr/bin/env tsx
/**
 * scripts/cache-warm.ts — SP-20260517-005 / S-10 / R-6.
 *
 * Pre-populate runtime/menu-cache/ from a curated metros file.
 *
 * Usage:
 *   tsx scripts/cache-warm.ts <metros.json> [--force] [--confirm-spend]
 *
 * The metros file (see seeds/menu-cache.json) lists {metro, restaurants[]}.
 * For each restaurant, the script runs Places search + menu enrichment
 * and writes the result to runtime/menu-cache/places_<id>.json. Existing
 * entries newer than 30 days are skipped unless --force.
 *
 * Spend ceiling: refuses to start if estimated cost exceeds $5 without
 * --confirm-spend. Cost model is approximate (Places $0.017 / detail,
 * Anthropic Haiku ~$0.0008 / call). Logs cache-warm.run event on
 * completion (TR-5).
 *
 * Environment:
 *   GOOGLE_PLACES_API_KEY   — required (Places API)
 *   ANTHROPIC_API_KEY        — required for menu extraction
 *   MENU_CACHE_DIR           — defaults to runtime/menu-cache
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { findNearbyPizzaPlaces } from "../src/connectors/places.js";
import { enrichEvidence } from "../src/lib/menu-discovery.js";
import { writeEventDirect } from "./cache-warm-event.js";

interface SeedFile {
  metros: Array<{
    name: string;
    restaurants: Array<{ name: string; address?: string }>;
  }>;
}

interface SeedEntry {
  metro: string;
  name: string;
  address: string;
}

const PLACES_COST_PER_DETAIL_USD = 0.017;
const HAIKU_COST_PER_CALL_USD = 0.0008;
const SPEND_CEILING_USD = 5.0;
const FRESH_TTL_DAYS = 30;

function help() {
  process.stdout
    .write(`cache-warm — pre-populate runtime/menu-cache/ from a curated metros file.

Usage: tsx scripts/cache-warm.ts <metros.json> [--force] [--confirm-spend]

The JSON file lists { metros: [{ name, restaurants: [{ name, address? }] }] } entries.
For each entry, the script runs Places search + menu enrichment and
writes the result to runtime/menu-cache/places_<id>.json. Existing
entries newer than 30 days are skipped; pass --force to refresh.

Counts Anthropic Haiku + Places API spend per run; refuses to start if
the run would exceed $${SPEND_CEILING_USD.toFixed(2)} unless --confirm-spend is passed.
`);
}

export function loadSeed(path: string): SeedEntry[] {
  if (!existsSync(path)) {
    process.stderr.write(`cache-warm: seed file not found: ${path}\n`);
    process.exit(1);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    process.stderr.write(
      `cache-warm: invalid JSON in ${path}: ${
        err instanceof Error ? err.message : err
      }\n`,
    );
    process.exit(1);
  }
  if (
    !raw ||
    typeof raw !== "object" ||
    !Array.isArray((raw as SeedFile).metros)
  ) {
    process.stderr.write(`cache-warm: invalid schema in ${path}\n`);
    process.exit(1);
  }
  const seed = raw as SeedFile;
  const out: SeedEntry[] = [];
  for (const m of seed.metros) {
    if (!m?.name || !Array.isArray(m.restaurants)) continue;
    if (m.restaurants.length === 0 || m.restaurants.length > 30) {
      process.stderr.write(
        `cache-warm: metro "${m.name}" must have 1-30 restaurants (got ${m.restaurants.length})\n`,
      );
      process.exit(1);
    }
    for (const r of m.restaurants) {
      if (!r?.name?.trim()) continue;
      out.push({
        metro: m.name,
        name: r.name.trim(),
        address: (r.address ?? m.name).trim(),
      });
    }
  }
  return out;
}

export function estimateSpendUsd(restaurantCount: number): number {
  return (
    restaurantCount * (PLACES_COST_PER_DETAIL_USD + HAIKU_COST_PER_CALL_USD)
  );
}

export function fuzzyMatchName(needle: string, haystack: string): boolean {
  // Apostrophes are STRIPPED (no space inserted) — "Tony's" → "tonys" —
  // and "&" is treated equivalent to "and" so "Pizzeria & Pub" matches
  // "Pizzeria and Pub".
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/['']/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  const a = norm(needle);
  const b = norm(haystack);
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  if (a.includes(b) || b.includes(a)) return true;
  // Word-set overlap fallback for cases like
  // "Kaleidoscope Pizzeria & Pub" vs "Kaleidoscope Pizzeria and Pub":
  // require ≥75% of needle's significant (≥3-char) words to appear in
  // haystack. Filters out the unrelated-name false-positive case (only
  // 0-1 word overlap).
  const needleWords = new Set(a.split(" ").filter((w) => w.length >= 3));
  const haystackWords = new Set(b.split(" ").filter((w) => w.length >= 3));
  if (needleWords.size === 0) return false;
  let matched = 0;
  for (const w of needleWords) if (haystackWords.has(w)) matched++;
  return matched / needleWords.size >= 0.75;
}

function cachePathFor(restaurantId: string): string {
  const dir = process.env.MENU_CACHE_DIR ?? "runtime/menu-cache";
  return `${dir}/${restaurantId}.json`;
}

function isFresh(restaurantId: string): boolean {
  const path = cachePathFor(restaurantId);
  if (!existsSync(path)) return false;
  const mtime = statSync(path).mtime;
  const ageDays = (Date.now() - mtime.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays < FRESH_TTL_DAYS;
}

async function processEntry(
  entry: SeedEntry,
  force: boolean,
): Promise<
  | { outcome: "succeeded" }
  | { outcome: "skipped"; reason: string }
  | { outcome: "failed"; reason: string }
> {
  const candidates = await findNearbyPizzaPlaces(entry.address);
  if (candidates.length === 0) {
    return { outcome: "failed", reason: "no Places results for address" };
  }
  const matched =
    candidates.find((r) => fuzzyMatchName(entry.name, r.name)) ?? candidates[0]; // fall through to top result if no fuzzy match — operator can hand-edit
  if (!force && isFresh(matched.id)) {
    return { outcome: "skipped", reason: `cache <${FRESH_TTL_DAYS} days old` };
  }
  const { enriched, source } = await enrichEvidence(matched);
  if (source === "unchanged") {
    return { outcome: "failed", reason: "enrichEvidence returned unchanged" };
  }
  // Cache write is handled by enrichEvidence itself via writeCache.
  void enriched;
  return { outcome: "succeeded" };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seedArg = args.find((a) => !a.startsWith("--"));
  const force = args.includes("--force");
  const confirmSpend = args.includes("--confirm-spend");

  if (!seedArg || args.includes("--help") || args.includes("-h")) {
    help();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const entries = loadSeed(seedArg);
  if (entries.length === 0) {
    process.stderr.write("cache-warm: no restaurants in seed file\n");
    process.exit(1);
  }

  const estimated = estimateSpendUsd(entries.length);
  if (estimated > SPEND_CEILING_USD && !confirmSpend) {
    process.stderr.write(
      `cache-warm: estimated spend $${estimated.toFixed(2)} > ceiling $${SPEND_CEILING_USD.toFixed(2)}. Pass --confirm-spend to proceed.\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `cache-warm: ${entries.length} restaurants across ${
      new Set(entries.map((e) => e.metro)).size
    } metros; estimated spend $${estimated.toFixed(2)}\n`,
  );

  const t0 = Date.now();
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  let placesCalls = 0;
  let haikuCalls = 0;
  for (const entry of entries) {
    placesCalls++;
    process.stdout.write(`  · ${entry.metro} / ${entry.name} ... `);
    try {
      const result = await processEntry(entry, force);
      if (result.outcome === "succeeded") {
        succeeded++;
        haikuCalls++;
        process.stdout.write("ok\n");
      } else if (result.outcome === "skipped") {
        skipped++;
        process.stdout.write(`skipped (${result.reason})\n`);
      } else {
        failed++;
        haikuCalls++;
        process.stdout.write(`failed (${result.reason})\n`);
      }
    } catch (err) {
      failed++;
      process.stdout.write(
        `failed (${err instanceof Error ? err.message : err})\n`,
      );
    }
  }
  const durationMs = Date.now() - t0;
  const actualSpend =
    placesCalls * PLACES_COST_PER_DETAIL_USD +
    haikuCalls * HAIKU_COST_PER_CALL_USD;

  process.stdout.write(
    `\ncache-warm: ${succeeded} succeeded, ${skipped} skipped, ${failed} failed in ${(
      durationMs / 1000
    ).toFixed(1)}s; spend ~$${actualSpend.toFixed(3)}\n`,
  );

  writeEventDirect({
    type: "cache-warm.run",
    metros_count: new Set(entries.map((e) => e.metro)).size,
    restaurants_attempted: entries.length,
    restaurants_succeeded: succeeded,
    restaurants_skipped: skipped,
    restaurants_failed: failed,
    places_api_calls: placesCalls,
    anthropic_haiku_calls: haikuCalls,
    estimated_spend_usd: Number(actualSpend.toFixed(4)),
    total_duration_ms: durationMs,
  });
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(
      `cache-warm: fatal error: ${err instanceof Error ? err.message : err}\n`,
    );
    process.exit(2);
  });
}
