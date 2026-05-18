// Tiny helper for cache-warm.ts: write a single TR-5 event line to the
// canonical event log. Kept in a separate module so the cache-warm
// script remains pure data-orchestration; the file-system side effect
// is concentrated here for easier mocking in tests.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export function writeEventDirect(data: Record<string, unknown>): void {
  const file =
    process.env.COMPATIBILITY_EVENTS_FILE ??
    join(process.cwd(), "runtime", "events.jsonl");
  try {
    mkdirSync(dirname(file), { recursive: true });
    const record = {
      id: `EVT-cache-warm-${Date.now().toString(36)}`,
      ts: new Date().toISOString(),
      cat: "cache-warm",
      actor: "alex",
      data,
    };
    appendFileSync(file, JSON.stringify(record) + "\n");
  } catch {
    // Fail-open — never break the run on log failure.
  }
}
