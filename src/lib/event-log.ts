/**
 * Event log — append-only JSONL writer.
 *
 * Lives in `runtime/events.jsonl` (mkdir-p the runtime dir if missing).
 * Fail-open silently: if the write fails, swallow the error so order flow
 * is never broken by a logging issue.
 *
 * Shape:
 *   { id, ts, cat, actor: "alex", data }
 *
 * Categories: "compatibility", "compatibility-override", "enrichment".
 * Event id prefix matches the cat-segment so `EVT-enrichment-...` and
 * `EVT-compat-...` are visually distinguishable in the trace.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

function eventsFile(): string {
  return process.env.COMPATIBILITY_EVENTS_FILE ?? "runtime/events.jsonl";
}

function randomId(): string {
  return randomBytes(6).toString("hex");
}

function idPrefixFor(cat: string): string {
  // Map category to id prefix. Keeps "compatibility" and
  // "compatibility-override" sharing the historical "EVT-compat-" prefix
  // (consumers may already filter on it); new categories get their own.
  if (cat === "compatibility" || cat === "compatibility-override") {
    return "EVT-compat";
  }
  return `EVT-${cat}`;
}

function writeEvent(cat: string, data: unknown): void {
  try {
    const file = eventsFile();
    mkdirSync(dirname(file), { recursive: true });
    const line =
      JSON.stringify({
        id: `${idPrefixFor(cat)}-${randomId()}`,
        ts: new Date().toISOString(),
        cat,
        actor: "alex",
        data,
      }) + "\n";
    appendFileSync(file, line);
  } catch {
    /* fail-open — never break order flow on log failure */
  }
}

export function logCompatibilityEvent(data: unknown): void {
  writeEvent("compatibility", data);
}

export function logCompatibilityOverride(data: unknown): void {
  writeEvent("compatibility-override", data);
}

export function logEnrichmentEvent(data: unknown): void {
  writeEvent("enrichment", data);
}

export function logMenuDiscoveryDrinksEvent(data: unknown): void {
  writeEvent("menu-discovery-drinks", data);
}

export function logCustomizationSurfaceEvent(data: unknown): void {
  writeEvent("customization-surface-built", data);
}

export function logA2ACustomizationSourceEvent(data: unknown): void {
  writeEvent("a2a-customization-source", data);
}

/**
 * SP-20260512-002 TR-4 — branch taken inside `start_pizza_order`.
 *
 * Values: 'presets' | 'intent_ranked' | 'occasion' | 'fallback_discovery'
 *         | 'discovery_only' | 'delegate'
 */
export function logStartPizzaOrderBranchEvent(data: unknown): void {
  writeEvent("start_pizza_order_branch", data);
}
