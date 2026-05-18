// SP-20260517-005 / S-10 / AC-10.* — cache-warm script unit tests.
// Live Places/Anthropic integration is intentionally NOT exercised here
// (would burn API budget); we test the pure orchestration logic.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadSeed,
  estimateSpendUsd,
  fuzzyMatchName,
} from "../scripts/cache-warm.js";

function withTmp(write: (p: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "cache-warm-test-"));
  const path = join(dir, "seed.json");
  write(path);
  return path;
}

test("AC-10.4: missing seed file exits non-zero (loadSeed exits via process.exit)", () => {
  // loadSeed is wired to process.exit(1) on missing file. Capture via try/finally.
  const realExit = process.exit;
  let exitCode: number | null = null;
  process.exit = ((code: number) => {
    exitCode = code;
    throw new Error("exit-stub");
  }) as never;
  try {
    try {
      loadSeed("/nonexistent-path-zzz.json");
    } catch (err) {
      // expected via stub
      assert.match((err as Error).message, /exit-stub/);
    }
    assert.equal(exitCode, 1);
  } finally {
    process.exit = realExit;
  }
});

test("AC-10.4: malformed JSON exits non-zero", () => {
  const path = withTmp((p) => writeFileSync(p, "{ not valid json"));
  const realExit = process.exit;
  let exitCode: number | null = null;
  process.exit = ((code: number) => {
    exitCode = code;
    throw new Error("exit-stub");
  }) as never;
  try {
    try {
      loadSeed(path);
    } catch (err) {
      assert.match((err as Error).message, /exit-stub/);
    }
    assert.equal(exitCode, 1);
  } finally {
    process.exit = realExit;
  }
});

test("valid seed flattens metros → SeedEntry[]", () => {
  const path = withTmp((p) =>
    writeFileSync(
      p,
      JSON.stringify({
        metros: [
          {
            name: "Medford, OR",
            restaurants: [
              { name: "Place A", address: "1 A St" },
              { name: "Place B" },
            ],
          },
          {
            name: "SF",
            restaurants: [{ name: "Tonys", address: "100 Stockton St" }],
          },
        ],
      }),
    ),
  );
  const out = loadSeed(path);
  assert.equal(out.length, 3);
  assert.equal(out[0].metro, "Medford, OR");
  assert.equal(out[0].name, "Place A");
  assert.equal(out[0].address, "1 A St");
  // No address → falls back to metro name. out[1] is "Place B" (Medford).
  assert.equal(out[1].name, "Place B");
  assert.equal(out[1].address, "Medford, OR");
  // out[2] is from SF metro with an address — preserved verbatim.
  assert.equal(out[2].metro, "SF");
  assert.equal(out[2].address, "100 Stockton St");
});

test("seed with >30 restaurants in a metro exits non-zero (validation guard)", () => {
  const restaurants = Array.from({ length: 31 }, (_, i) => ({
    name: `R${i}`,
    address: "x",
  }));
  const path = withTmp((p) =>
    writeFileSync(
      p,
      JSON.stringify({ metros: [{ name: "TooMany", restaurants }] }),
    ),
  );
  const realExit = process.exit;
  let exitCode: number | null = null;
  process.exit = ((code: number) => {
    exitCode = code;
    throw new Error("exit-stub");
  }) as never;
  try {
    try {
      loadSeed(path);
    } catch (err) {
      assert.match((err as Error).message, /exit-stub/);
    }
    assert.equal(exitCode, 1);
  } finally {
    process.exit = realExit;
  }
});

test("AC-10.3: estimateSpendUsd computes monotonic spend per restaurant", () => {
  const one = estimateSpendUsd(1);
  const ten = estimateSpendUsd(10);
  const thousand = estimateSpendUsd(1000);
  assert.ok(one > 0);
  assert.ok(ten > one * 9, "10 restaurants should cost ~10x one");
  assert.ok(thousand > 5, "1000 restaurants should exceed the $5 ceiling");
});

test("fuzzyMatchName: identical names match", () => {
  assert.equal(
    fuzzyMatchName("Kaleidoscope Pizza", "Kaleidoscope Pizza"),
    true,
  );
});

test("fuzzyMatchName: substring match with formatting differences", () => {
  assert.equal(
    fuzzyMatchName(
      "Kaleidoscope Pizzeria & Pub",
      "Kaleidoscope Pizzeria and Pub",
    ),
    true,
  );
  assert.equal(fuzzyMatchName("Tony's", "Tonys Pizza"), true);
});

test("fuzzyMatchName: unrelated names don't match", () => {
  assert.equal(fuzzyMatchName("Domino's", "Pizza Hut"), false);
  assert.equal(fuzzyMatchName("Joes", "Marios Italian Kitchen"), false);
});

test("fuzzyMatchName: very short names require exact match (no false positives)", () => {
  // 2-char queries must not match a longer haystack containing them.
  assert.equal(fuzzyMatchName("ab", "Abigail's Pizza"), false);
});

test("real seed file (seeds/menu-cache.json) parses and yields ≥8 entries", () => {
  const out = loadSeed("seeds/menu-cache.json");
  assert.ok(
    out.length >= 8,
    `expected ≥8 seeded restaurants, got ${out.length}`,
  );
  // Medford + SF are seeded per beta directive.
  const metros = new Set(out.map((e) => e.metro));
  assert.ok(
    Array.from(metros).some((m) => m.toLowerCase().includes("medford")),
  );
  assert.ok(Array.from(metros).some((m) => m.toLowerCase().includes("san")));
});
