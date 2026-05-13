/**
 * Narration-parity tests — SP-20260512-002 S-21
 *
 * Verifies that the three narration-constant surfaces (MCP tool description,
 * webapp SYSTEM prompt, A2A UPSELL_TURN_RULES) all contain the verbatim
 * phrases required by the price-wall (S-15) and deal-gate (S-18) rules.
 *
 * Any drift between the three surfaces is a narration-integrity regression.
 * The LOCKSTEP comments in each source file point here for discoverability.
 */

import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Source files under test ────────────────────────────────────────────────

const ROOT = join(import.meta.dirname ?? __dirname, "..");

const SERVER_SRC = readFileSync(join(ROOT, "src", "server.ts"), "utf8");
const EXECUTOR_SRC = readFileSync(
  join(ROOT, "src", "a2a", "executor.ts"),
  "utf8",
);
const ROUTE_SRC = readFileSync(
  join(ROOT, "webapp", "app", "api", "chat", "route.ts"),
  "utf8",
);

// ── Required verbatim phrases ──────────────────────────────────────────────

const PRICE_WALL_PHRASE = "I'll get you the exact total on the call.";
const DEAL_GATE_PHRASE = "deals page — I'll ask";

// ── AC-21.1 — src/server.ts contains price-wall phrase ────────────────────

test("src/server.ts contains price-wall verbatim phrase", () => {
  assert.ok(
    SERVER_SRC.includes(PRICE_WALL_PHRASE),
    `src/server.ts must contain: "${PRICE_WALL_PHRASE}"`,
  );
});

// ── AC-21.2 — src/server.ts contains deal-gate phrase ─────────────────────

test("src/server.ts contains deal-gate verbatim phrase", () => {
  assert.ok(
    SERVER_SRC.includes(DEAL_GATE_PHRASE),
    `src/server.ts must contain: "${DEAL_GATE_PHRASE}"`,
  );
});

// ── AC-21.2 — src/a2a/executor.ts contains price-wall phrase ──────────────

test("src/a2a/executor.ts contains price-wall verbatim phrase", () => {
  assert.ok(
    EXECUTOR_SRC.includes(PRICE_WALL_PHRASE),
    `src/a2a/executor.ts must contain: "${PRICE_WALL_PHRASE}"`,
  );
});

// ── AC-21.3 — src/a2a/executor.ts contains deal-gate phrase ───────────────

test("src/a2a/executor.ts contains deal-gate verbatim phrase", () => {
  assert.ok(
    EXECUTOR_SRC.includes(DEAL_GATE_PHRASE),
    `src/a2a/executor.ts must contain: "${DEAL_GATE_PHRASE}"`,
  );
});

// ── AC-21.3 — webapp/app/api/chat/route.ts contains price-wall phrase ─────

test("webapp/app/api/chat/route.ts contains price-wall verbatim phrase", () => {
  assert.ok(
    ROUTE_SRC.includes(PRICE_WALL_PHRASE),
    `webapp/app/api/chat/route.ts must contain: "${PRICE_WALL_PHRASE}"`,
  );
});

// ── AC-21.4 — webapp/app/api/chat/route.ts contains deal-gate phrase ──────

test("webapp/app/api/chat/route.ts contains deal-gate verbatim phrase", () => {
  assert.ok(
    ROUTE_SRC.includes(DEAL_GATE_PHRASE),
    `webapp/app/api/chat/route.ts must contain: "${DEAL_GATE_PHRASE}"`,
  );
});

// ── AC-21.5 — meta-test: removing phrase from a string fails the assertion ─

test("meta: assertion correctly fails when phrase is absent from a mutated string", () => {
  const mutated = SERVER_SRC.replace(PRICE_WALL_PHRASE, "REMOVED");
  assert.ok(
    !mutated.includes(PRICE_WALL_PHRASE),
    "mutated string must not contain the price-wall phrase (setup check)",
  );
  // Confirm the original passes and mutated fails — the check works.
  assert.ok(
    SERVER_SRC.includes(PRICE_WALL_PHRASE),
    "original still contains phrase",
  );
  assert.ok(
    !mutated.includes(PRICE_WALL_PHRASE),
    "mutated does not contain phrase",
  );

  const mutated2 = EXECUTOR_SRC.replace(DEAL_GATE_PHRASE, "REMOVED");
  assert.ok(!mutated2.includes(DEAL_GATE_PHRASE));
  assert.ok(EXECUTOR_SRC.includes(DEAL_GATE_PHRASE));
});
