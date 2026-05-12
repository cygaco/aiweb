import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("a2a executor route-bypass repair", () => {
  test("executor.ts calls buildCustomizationSurface(restaurantForCart, cart, 'a2a')", () => {
    const src = readFileSync(
      resolve(__dirname, "../src/a2a/executor.ts"),
      "utf8",
    );
    // Must call with restaurantForCart and "a2a" surface tag
    // Allow optional trailing comma (formatter inserts one on multi-line calls)
    assert.ok(
      /buildCustomizationSurface\s*\(\s*restaurantForCart\s*,\s*cart\s*,\s*["']a2a["']\s*,?\s*\)/.test(
        src,
      ),
      'executor.ts must call buildCustomizationSurface(restaurantForCart, cart, "a2a")',
    );
    // Must NOT contain the bypass form (restaurant, cart) — no surface arg
    assert.ok(
      !/buildCustomizationSurface\s*\(\s*restaurant\s*,\s*cart\s*,?\s*\)/.test(
        src,
      ),
      "executor.ts must NOT call buildCustomizationSurface(restaurant, cart) — that's the bypass form",
    );
  });
});
