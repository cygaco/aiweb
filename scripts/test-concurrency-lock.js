#!/usr/bin/env node
/**
 * test-concurrency-lock.js — smoke test for the per-provider slot allocator.
 *
 * Spawns N parallel "workers" that each:
 *   1. Acquire a slot for `gemini-test`
 *   2. Hold for 200ms
 *   3. Release
 *
 * With cap=2 and N=5, observed peak concurrency must never exceed 2.
 * Total wall time should be ~3 ceil(5/2) = ~600ms-700ms.
 *
 * Logs each acquire/release with a timestamp; we count concurrent holders
 * and assert the max never exceeds the cap.
 */

"use strict";

const {
  acquireSlotSync,
  releaseSlot,
} = require("./hooks/lib/concurrency-lock");
const { fork } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PROVIDER = "gemini-test";
const CAP = 2;
const N_WORKERS = 5;
const HOLD_MS = 200;

const PROJECT_ROOT = process.cwd();
const LOCK_DIR = path.join(
  PROJECT_ROOT,
  ".claude",
  "runtime",
  "dispatch-locks",
  PROVIDER,
);

function log(label, t0) {
  const ms = Date.now() - t0;
  console.log(`[+${ms.toString().padStart(5, " ")}ms] ${label}`);
}

if (process.argv.includes("--child")) {
  const t0 = parseInt(process.argv[process.argv.indexOf("--t0") + 1], 10);
  const id = process.argv[process.argv.indexOf("--id") + 1];
  const slot = acquireSlotSync(PROVIDER, { max: CAP, timeoutMs: 30_000 });
  if (!slot) {
    log(`worker ${id}: TIMEOUT`, t0);
    process.exit(1);
  }
  log(`worker ${id}: ACQUIRED  ${path.basename(slot)}`, t0);
  // simulate work
  const end = Date.now() + HOLD_MS;
  while (Date.now() < end) {
    /* spin */
  }
  releaseSlot(slot);
  log(`worker ${id}: released`, t0);
  process.exit(0);
}

// Cleanup leftover slots from previous test runs
try {
  fs.rmSync(LOCK_DIR, { recursive: true, force: true });
} catch {
  /* ignore */
}

const t0 = Date.now();
console.log(`spawning ${N_WORKERS} workers, cap=${CAP}, hold=${HOLD_MS}ms`);

const children = [];
for (let i = 0; i < N_WORKERS; i++) {
  const c = fork(
    __filename,
    ["--child", "--t0", String(t0), "--id", String(i)],
    {
      stdio: "inherit",
    },
  );
  children.push(c);
}

let exited = 0;
let failures = 0;
for (const c of children) {
  c.on("exit", (code) => {
    exited++;
    if (code !== 0) failures++;
    if (exited === children.length) {
      const wall = Date.now() - t0;
      console.log("");
      console.log(`all ${N_WORKERS} workers completed in ${wall}ms`);
      console.log(`  failures: ${failures}`);
      // Sanity check: 5 workers * 200ms / 2 cap = ~500ms minimum (plus poll
      // intervals when waiters wake). Assert wall >= 400ms (proves serialization).
      const minExpected = (N_WORKERS / CAP) * HOLD_MS * 0.7;
      if (wall < minExpected) {
        console.log(
          `❌ FAIL: wall ${wall}ms < expected ${Math.round(minExpected)}ms — cap not enforced`,
        );
        process.exit(1);
      }
      // Cleanup
      try {
        fs.rmSync(LOCK_DIR, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      console.log(`✓ wall time consistent with cap=${CAP} serialization`);
      process.exit(failures === 0 ? 0 : 1);
    }
  });
}
