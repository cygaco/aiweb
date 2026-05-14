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
