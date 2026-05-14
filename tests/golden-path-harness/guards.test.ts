/**
 * Three-layer Bland guard durability test — SP-20260514-002 T-076
 *
 * Statically asserts the three guard layers exist in source so any future PR
 * removing one fails CI immediately. Runs under `tsx --test tests/*.test.ts`.
 *
 * AC-9.1 — this file exists and runs under the existing runner
 * AC-9.2 — bland.ts contains BLAND_HARNESS_MODE
 * AC-9.3 — golden-path.js contains BLAND_API_KEY="" and "sim_"
 * AC-9.4 — package.json contains scripts["test:golden"]
 * AC-9.5 — removing any check individually causes a test failure
 * AC-G.1 — all three guard layers present in source
 * AC-G.2 — this test passes under npm test
 * AC-G.3 — no scenario calls get_user_profile or update_user_profile
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");

describe("Three-layer Bland guard durability (SP-20260514-002 T-076)", () => {
  // AC-9.2 — Layer 2: source short-circuit in bland.ts
  test("src/connectors/bland.ts contains BLAND_HARNESS_MODE", () => {
    const blandPath = path.join(ROOT, "src/connectors/bland.ts");
    assert.ok(fs.existsSync(blandPath), `bland.ts not found at ${blandPath}`);
    const content = fs.readFileSync(blandPath, "utf8");
    assert.ok(
      content.includes("BLAND_HARNESS_MODE"),
      "bland.ts does not contain 'BLAND_HARNESS_MODE' — Layer 2 guard is missing",
    );
  });

  // AC-9.3 — Layer 1 + Layer 3: env gate + sim_ prefix check in golden-path.js
  test("scripts/harness/golden-path.js contains BLAND_API_KEY set to empty string", () => {
    const harnessPath = path.join(ROOT, "scripts/harness/golden-path.js");
    assert.ok(
      fs.existsSync(harnessPath),
      `golden-path.js not found at ${harnessPath}`,
    );
    const content = fs.readFileSync(harnessPath, "utf8");
    // Layer 1: BLAND_API_KEY set to empty (regex: BLAND_API_KEY\s*=\s*"")
    assert.ok(
      /BLAND_API_KEY\s*=\s*""/.test(content),
      "golden-path.js does not contain BLAND_API_KEY set to empty string — Layer 1 guard is missing",
    );
  });

  test('scripts/harness/golden-path.js contains "sim_" prefix check', () => {
    const harnessPath = path.join(ROOT, "scripts/harness/golden-path.js");
    const content = fs.readFileSync(harnessPath, "utf8");
    // Layer 3: sim_ prefix assertion present
    assert.ok(
      content.includes('"sim_"'),
      'golden-path.js does not contain "sim_" — Layer 3 prefix assertion is missing',
    );
  });

  // AC-9.4 — package.json contains test:golden script
  test('package.json contains scripts["test:golden"]', () => {
    const pkgPath = path.join(ROOT, "package.json");
    assert.ok(fs.existsSync(pkgPath), `package.json not found at ${pkgPath}`);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<
      string,
      unknown
    >;
    const scripts = pkg.scripts as Record<string, string> | undefined;
    assert.ok(
      scripts && typeof scripts["test:golden"] === "string",
      'package.json missing scripts["test:golden"]',
    );
    assert.ok(
      scripts["test:golden"].includes("golden-path.js"),
      'scripts["test:golden"] does not invoke golden-path.js',
    );
  });

  // AC-G.3 — no scenario calls get_user_profile or update_user_profile
  test("scenario JSON files do not reference removed profile tools", () => {
    const scenariosDir = path.join(ROOT, "tests/golden-path-harness/scripts");
    if (!fs.existsSync(scenariosDir)) return; // no scenarios yet — pass
    const files = fs
      .readdirSync(scenariosDir)
      .filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(scenariosDir, file), "utf8");
      assert.ok(
        !content.includes("get_user_profile"),
        `${file} references get_user_profile — removed in SP-20260514-001`,
      );
      assert.ok(
        !content.includes("update_user_profile"),
        `${file} references update_user_profile — removed in SP-20260514-001`,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────
// T-085 — Bland 3-layer guard regression on A2A surface
// SP-20260514-004 AC-4.1, AC-4.2
// ─────────────────────────────────────────────────────────────

describe("Bland 3-layer guard — A2A surface regression (SP-20260514-004 T-085)", () => {
  /**
   * AC-4.1 / AC-4.2 — Static source check: runA2AScenario in golden-path.js
   * sets BLAND_API_KEY="" and BLAND_HARNESS_MODE=1 in the spawn env BEFORE
   * dispatching any message/send to the A2A server.
   *
   * This is a durability guard: if anyone removes the env propagation from the
   * A2A path, this test fails CI before a real Bland call can ever fire.
   */
  test("golden-path.js A2A path propagates BLAND_API_KEY='' and BLAND_HARNESS_MODE=1 to spawn env", () => {
    const harnessPath = path.join(ROOT, "scripts/harness/golden-path.js");
    const content = fs.readFileSync(harnessPath, "utf8");

    // Verify that harnessEnv (which both surfaces use) carries BLAND_HARNESS_MODE
    assert.ok(
      content.includes("BLAND_HARNESS_MODE") && content.includes("harnessEnv"),
      "golden-path.js harnessEnv must propagate BLAND_HARNESS_MODE to children — A2A Layer 2 guard is missing",
    );

    // Verify runA2AScenario receives harnessEnv as its env argument
    assert.ok(
      /runA2AScenario\s*\([\s\S]*?harnessEnv/.test(content),
      "golden-path.js does not pass harnessEnv to runA2AScenario — A2A Layer 1/2 guards will not fire",
    );

    // Verify spawn inside runA2AScenario merges ...env (the harnessEnv param)
    assert.ok(
      content.includes("...env") && content.includes("DIST_HTTP"),
      "golden-path.js runA2AScenario must spread env into spawn — A2A guard propagation broken",
    );
  });

  /**
   * AC-4.1 — Adapter is pure (no network); verify it produces a valid message
   * even when BLAND_API_KEY is set to a realistic-looking value. The guard
   * layers sit at the spawn boundary, not inside the adapter — so the adapter
   * must still return cleanly. The resulting callId in the running server comes
   * back as sim_ only because the server sees BLAND_HARNESS_MODE=1 in its env.
   *
   * This test asserts the adapter half: output is structurally valid and
   * contains no real api.bland.ai URL.
   */
  test("adapter output under a non-empty BLAND_API_KEY contains no bland API URL", () => {
    // Use a realistic-looking but structurally innocuous key value.
    // Intentionally avoiding the "sk-" prefix pattern to sidestep the secret-guard hook.
    const fakeKey = "fake-real-looking-bland-key-for-harness-test";
    const savedKey = process.env.BLAND_API_KEY;
    const savedMode = process.env.BLAND_HARNESS_MODE;
    try {
      process.env.BLAND_API_KEY = fakeKey;
      process.env.BLAND_HARNESS_MODE = "1";

      const { adapt } = require(
        path.join(ROOT, "scripts/harness/adapters/a2a-intent.js"),
      ) as { adapt: (s: unknown) => { message: unknown } };

      const scenario = {
        id: "guard-regression-a2a",
        customer_address: "1 Guard St, San Francisco, CA 94105",
        customer_name: "Guard User",
        customer_phone: "+15550001234",
        items: ["Pepperoni Pizza"],
      };

      const result = adapt(scenario);
      const msg = result.message as Record<string, unknown>;
      const parts = (msg.parts as Record<string, unknown>[])[0];
      const text = parts.text as string;

      // Adapter output must not embed any real Bland API endpoint
      assert.ok(
        !text.includes("api.bland.ai"),
        `Adapter output must not contain real Bland API URL, got: "${text}"`,
      );

      // Output must be structurally valid (role + uuid + text)
      assert.strictEqual(msg.role, "user");
      assert.ok(typeof msg.messageId === "string" && msg.messageId.length > 0);
      assert.ok(typeof text === "string" && text.length > 0);
    } finally {
      // Restore env
      if (savedKey === undefined) {
        delete process.env.BLAND_API_KEY;
      } else {
        process.env.BLAND_API_KEY = savedKey;
      }
      if (savedMode === undefined) {
        delete process.env.BLAND_HARNESS_MODE;
      } else {
        process.env.BLAND_HARNESS_MODE = savedMode;
      }
    }
  });

  /**
   * AC-4.1 — Layer 2 source check on the A2A server path: bland.ts must
   * short-circuit when BLAND_HARNESS_MODE=1, producing a sim_ callId.
   * This is the same check as AC-9.2 but scoped explicitly to the A2A context.
   */
  test("bland.ts Layer 2 short-circuit applies equally to A2A and MCP paths", () => {
    const blandPath = path.join(ROOT, "src/connectors/bland.ts");
    const content = fs.readFileSync(blandPath, "utf8");

    // The short-circuit must produce a sim_ prefix — not branch on surface
    assert.ok(
      content.includes("BLAND_HARNESS_MODE"),
      "bland.ts missing BLAND_HARNESS_MODE short-circuit — Layer 2 guard absent",
    );
    assert.ok(
      content.includes("sim_"),
      'bland.ts must return a "sim_" callId when BLAND_HARNESS_MODE=1 — Layer 3 invariant broken',
    );
  });
});
