/**
 * Tests for EMERGENCY_DISABLE_BLAND panic-stop env var.
 * SP-20260514-003 T-051 — AC-1.1, AC-1.2, AC-1.3
 *
 * Strategy:
 * - Route events to a tmp file so we can inspect panic-stop entries.
 * - Mock globalThis.fetch to assert it is NEVER called when the gate is on.
 * - Test env-off default, env-on short-circuit, and case-insensitive variants.
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── event-log redirect ────────────────────────────────────────────────────────
const TMP_DIR = mkdtempSync(join(tmpdir(), "panic-stop-test-"));
const EVENTS_FILE = join(TMP_DIR, "events.jsonl");
process.env.COMPATIBILITY_EVENTS_FILE = EVENTS_FILE;

// Import after env is set so event-log picks up the override.
import {
  dispatchCall,
  PANIC_STOP_MESSAGE,
  type PlaceOrderRequest,
} from "../src/connectors/bland.js";

// ── fixtures ──────────────────────────────────────────────────────────────────
const ORDER: PlaceOrderRequest = {
  restaurantName: "Vlad's Pizza Kitchen",
  restaurantPhone: "+14155551234",
  deliveryAddress: "123 Main St, San Francisco, CA",
  customerName: "Test User",
  customerPhone: "+14155550000",
  items: [{ name: "Pepperoni", size: "large", quantity: 1, price: 13.99 }],
};

// ── fetch mock helpers ────────────────────────────────────────────────────────
let fetchCallCount = 0;
const originalFetch = globalThis.fetch;

function mockFetch(): void {
  fetchCallCount = 0;
  (globalThis as Record<string, unknown>).fetch = async () => {
    fetchCallCount++;
    // Return a minimal valid Bland response so non-panicked paths work.
    return {
      ok: true,
      json: async () => ({ call_id: "mock_call_123", status: "queued" }),
      text: async () => "",
    };
  };
}

function restoreFetch(): void {
  (globalThis as Record<string, unknown>).fetch = originalFetch;
}

function readEvents(): Array<Record<string, unknown>> {
  if (!existsSync(EVENTS_FILE)) return [];
  return readFileSync(EVENTS_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function panicStopEvents(): Array<Record<string, unknown>> {
  return readEvents().filter((e) => e.cat === "panic-stop");
}

// ── AC-1.1: env unset / default-off ──────────────────────────────────────────
test("AC-1.1: EMERGENCY_DISABLE_BLAND unset — dispatchCall runs simulation path (no API key), no panic-stop event", async () => {
  delete process.env.EMERGENCY_DISABLE_BLAND;
  delete process.env.BLAND_API_KEY;
  mockFetch();

  const countBefore = panicStopEvents().length;
  const result = await dispatchCall(ORDER);

  // Sim path returns sim_* callId and never hits fetch.
  assert.match(result.callId, /^sim_/);
  assert.equal(result.status, "queued");
  assert.equal(fetchCallCount, 0, "fetch must not be called in sim mode");
  assert.equal(
    panicStopEvents().length,
    countBefore,
    "no panic-stop event emitted when flag is off",
  );
  restoreFetch();
});

// ── AC-1.1 (real-API branch): env unset, BLAND_API_KEY set — calls fetch ─────
test("AC-1.1: EMERGENCY_DISABLE_BLAND unset with BLAND_API_KEY set — dispatches call (fetch called)", async () => {
  delete process.env.EMERGENCY_DISABLE_BLAND;
  process.env.BLAND_API_KEY = "test_key_abc";
  mockFetch();

  const countBefore = panicStopEvents().length;
  const result = await dispatchCall(ORDER);

  assert.equal(result.callId, "mock_call_123");
  assert.equal(fetchCallCount, 1, "fetch must be called once in real mode");
  assert.equal(
    panicStopEvents().length,
    countBefore,
    "no panic-stop event when flag is off",
  );

  delete process.env.BLAND_API_KEY;
  restoreFetch();
});

// ── AC-1.2: env on ('true') — short-circuit, no fetch, one panic-stop event ──
test("AC-1.2: EMERGENCY_DISABLE_BLAND=true — throws PANIC_STOP_MESSAGE, no fetch call, panic-stop event written", async () => {
  process.env.EMERGENCY_DISABLE_BLAND = "true";
  process.env.BLAND_API_KEY = "test_key_abc"; // would trigger real fetch if gate fails
  mockFetch();

  const countBefore = panicStopEvents().length;

  await assert.rejects(
    () => dispatchCall(ORDER),
    (err: Error) => {
      assert.equal(err.message, PANIC_STOP_MESSAGE);
      return true;
    },
  );

  assert.equal(fetchCallCount, 0, "fetch must NOT be called when gate is on");

  const events = panicStopEvents();
  assert.equal(
    events.length,
    countBefore + 1,
    "exactly one panic-stop event written",
  );
  const evt = events[events.length - 1] as Record<string, unknown>;
  assert.equal(evt.cat, "panic-stop");
  const data = evt.data as Record<string, unknown>;
  assert.equal(data.restaurantName, ORDER.restaurantName);

  delete process.env.EMERGENCY_DISABLE_BLAND;
  delete process.env.BLAND_API_KEY;
  restoreFetch();
});

// ── AC-1.2: env on ('1') ──────────────────────────────────────────────────────
test("AC-1.2: EMERGENCY_DISABLE_BLAND=1 — also triggers panic-stop", async () => {
  process.env.EMERGENCY_DISABLE_BLAND = "1";
  mockFetch();

  const countBefore = panicStopEvents().length;

  await assert.rejects(
    () => dispatchCall(ORDER),
    (err: Error) => {
      assert.equal(err.message, PANIC_STOP_MESSAGE);
      return true;
    },
  );
  assert.equal(fetchCallCount, 0);
  assert.equal(panicStopEvents().length, countBefore + 1);

  delete process.env.EMERGENCY_DISABLE_BLAND;
  restoreFetch();
});

// ── AC-1.2: case-insensitive 'True' ──────────────────────────────────────────
test("AC-1.2: EMERGENCY_DISABLE_BLAND=True (mixed case) — triggers panic-stop", async () => {
  process.env.EMERGENCY_DISABLE_BLAND = "True";
  mockFetch();

  const countBefore = panicStopEvents().length;

  await assert.rejects(
    () => dispatchCall(ORDER),
    (err: Error) => err.message === PANIC_STOP_MESSAGE,
  );
  assert.equal(fetchCallCount, 0);
  assert.equal(panicStopEvents().length, countBefore + 1);

  delete process.env.EMERGENCY_DISABLE_BLAND;
  restoreFetch();
});

// ── AC-1.2: case-insensitive 'TRUE' ──────────────────────────────────────────
test("AC-1.2: EMERGENCY_DISABLE_BLAND=TRUE (upper case) — triggers panic-stop", async () => {
  process.env.EMERGENCY_DISABLE_BLAND = "TRUE";
  mockFetch();

  const countBefore = panicStopEvents().length;

  await assert.rejects(
    () => dispatchCall(ORDER),
    (err: Error) => err.message === PANIC_STOP_MESSAGE,
  );
  assert.equal(fetchCallCount, 0);
  assert.equal(panicStopEvents().length, countBefore + 1);

  delete process.env.EMERGENCY_DISABLE_BLAND;
  restoreFetch();
});

// ── AC-1.2: panic-stop event includes callSite from BLAND_CALL_SITE env ──────
test("AC-1.2: panic-stop event records callSite from BLAND_CALL_SITE env var", async () => {
  process.env.EMERGENCY_DISABLE_BLAND = "true";
  process.env.BLAND_CALL_SITE = "server";
  mockFetch();

  const countBefore = panicStopEvents().length;

  await assert.rejects(() => dispatchCall(ORDER));

  const events = panicStopEvents();
  assert.equal(events.length, countBefore + 1);
  const data = (events[events.length - 1] as Record<string, unknown>)
    .data as Record<string, unknown>;
  assert.equal(data.callSite, "server");

  delete process.env.EMERGENCY_DISABLE_BLAND;
  delete process.env.BLAND_CALL_SITE;
  restoreFetch();
});

// ── AC-1.1 edge: random truthy strings do NOT trigger the gate ────────────────
test("AC-1.1: EMERGENCY_DISABLE_BLAND=yes — does NOT trigger panic-stop (only 'true'/'1' accepted)", async () => {
  process.env.EMERGENCY_DISABLE_BLAND = "yes";
  delete process.env.BLAND_API_KEY;
  mockFetch();

  const countBefore = panicStopEvents().length;

  const result = await dispatchCall(ORDER);
  // Falls through to sim path (no API key).
  assert.match(result.callId, /^sim_/);
  assert.equal(
    panicStopEvents().length,
    countBefore,
    "only 'true'/'1' trigger the gate",
  );

  delete process.env.EMERGENCY_DISABLE_BLAND;
  restoreFetch();
});
