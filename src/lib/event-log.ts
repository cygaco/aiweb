/**
 * Event log — append-only JSONL writer for compatibility events.
 *
 * Lives in `runtime/events.jsonl` (mkdir-p the runtime dir if missing).
 * Fail-open silently: if the write fails, swallow the error so order flow
 * is never broken by a logging issue.
 *
 * Shape:
 *   { id, ts, cat: "compatibility" | "compatibility-override", actor: "alex", data }
 *
 * S-9.5 from PRD-V2-DELTA. The "canonical logger" referenced in PRD A11.
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

function writeEvent(cat: string, data: unknown): void {
  try {
    const file = eventsFile();
    mkdirSync(dirname(file), { recursive: true });
    const line =
      JSON.stringify({
        id: `EVT-compat-${randomId()}`,
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
