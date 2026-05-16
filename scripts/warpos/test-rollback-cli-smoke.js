#!/usr/bin/env node
/**
 * scripts/warpos/test-rollback-cli-smoke.js — manual smoke for the
 * `--rollback <txId>` CLI handler in update.js.
 *
 * Builds a synthetic target tree with a real transaction envelope (via
 * transaction.js#beginTransaction), simulates a mid-apply state mutation,
 * then invokes `node scripts/warpos/update.js --rollback <txId> --target <tmp>`
 * out-of-process and asserts:
 *   - Exit code is 0 for a clean full rollback.
 *   - stdout contains the OK status line + counts.
 *   - The pre-apply content was restored.
 *   - The added file was unlinked.
 *   - Negative path 1: bad txId returns exit code 4 with a useful error.
 *   - Negative path 2: --rollback=<txId> (equals form) parses correctly.
 *   - Negative path 3: --json output is parseable JSON.
 *
 * Linked: SP-20260513-005 / T-20260513-062 (CLI handler wire-up).
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const tx = require("./transaction");

function log(name, ok, extra) {
  const tag = ok ? "PASS" : "FAIL";
  console.log(`  ${tag} ${name}${extra ? " — " + extra : ""}`);
  if (!ok) process.exitCode = 1;
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "warpos-rb-cli-smoke-"));
console.log(`[smoke] tmpRoot = ${tmpRoot}`);

const updateScript = path.resolve(__dirname, "update.js");

// ── Fixture build ──────────────────────────────────────────
// Same shape as test-transaction-smoke.js: one UPDATE_SAFE (pre-existing)
// + one ADD_SAFE (new). Begin the transaction, then mutate state mid-flight,
// then leave the lock taken so the CLI handler picks up a realistic post-
// crash situation.
const preFile = path.join(tmpRoot, "dir-a", "file.md");
fs.mkdirSync(path.dirname(preFile), { recursive: true });
fs.writeFileSync(preFile, "PRE-APPLY CONTENT\n");

const decisions = [
  {
    id: "asset-1",
    dest: "dir-a/file.md",
    kind: "skill",
    owner: "framework",
    category: "UPDATE_SAFE",
    reason: "test",
  },
  {
    id: "asset-2",
    dest: "dir-b/new.md",
    kind: "skill",
    owner: "framework",
    category: "ADD_SAFE",
    reason: "test new",
  },
];

const t = tx.beginTransaction({
  targetRoot: tmpRoot,
  sourceTreeRoot: tmpRoot,
  fromVersion: "0.4.4",
  toVersion: "0.5.0",
  decisions,
  skipFastPreflight: true,
  capsule: { dir: "/fake", release: { version: "0.5.0" } },
});
console.log(`[smoke] beginTransaction.txId = ${t.txId}`);

// Simulate the apply phase: overwrite + create. Operator then decides to
// roll back via the CLI.
fs.writeFileSync(preFile, "POST-APPLY (new version)\n");
const newFile = path.join(tmpRoot, "dir-b", "new.md");
fs.mkdirSync(path.dirname(newFile), { recursive: true });
fs.writeFileSync(newFile, "NEW FILE FROM CAPSULE\n");

// ── Test 1: positional form (clean rollback) ───────────────
const r1 = spawnSync(
  process.execPath,
  [updateScript, "--rollback", t.txId, "--target", tmpRoot],
  { encoding: "utf8", timeout: 30_000 },
);
log(
  "CLI --rollback positional: exit 0",
  r1.status === 0,
  `status=${r1.status}`,
);
log(
  "CLI stdout contains [OK]",
  r1.stdout.includes("[OK] rollback"),
  r1.stdout.split("\n")[0],
);
log(
  "CLI stdout reports restored=1 unlinked=1",
  r1.stdout.includes("restored=1") && r1.stdout.includes("unlinked=1"),
);
log(
  "Pre-apply content restored on disk",
  fs.readFileSync(preFile, "utf8") === "PRE-APPLY CONTENT\n",
);
log("Added file unlinked on disk", !fs.existsSync(newFile));
log(
  "result.json outcome=rolled-back",
  JSON.parse(fs.readFileSync(path.join(t.txDir, "result.json"), "utf8"))
    .outcome === "rolled-back",
);
log(
  "rollback trigger=operator",
  JSON.parse(fs.readFileSync(path.join(t.txDir, "result.json"), "utf8"))
    .rollback.trigger === "operator",
);

// ── Test 2: bad txId → exit 4 ──────────────────────────────
const r2 = spawnSync(
  process.execPath,
  [updateScript, "--rollback", "no-such-txid", "--target", tmpRoot],
  { encoding: "utf8", timeout: 30_000 },
);
log("CLI bad txId: exit 4", r2.status === 4, `status=${r2.status}`);
log(
  "CLI bad txId stderr mentions 'not found'",
  /not found/i.test(r2.stderr || ""),
);

// ── Test 3: --rollback=<txId> (equals form) ────────────────
// Build a fresh transaction for this test (the first one is already in
// rolled-back state).
fs.writeFileSync(preFile, "PRE-APPLY CONTENT 2\n");
const t3 = tx.beginTransaction({
  targetRoot: tmpRoot,
  sourceTreeRoot: tmpRoot,
  fromVersion: "0.4.4",
  toVersion: "0.5.0",
  decisions,
  skipFastPreflight: true,
  capsule: { dir: "/fake", release: { version: "0.5.0" } },
});
fs.writeFileSync(preFile, "MID-FLIGHT CONTENT 2\n");
fs.writeFileSync(newFile, "MID-FLIGHT NEW 2\n");
const r3 = spawnSync(
  process.execPath,
  [updateScript, `--rollback=${t3.txId}`, "--target", tmpRoot],
  { encoding: "utf8", timeout: 30_000 },
);
log(
  "CLI --rollback=<txId> equals form: exit 0",
  r3.status === 0,
  `status=${r3.status}`,
);
log(
  "CLI equals form restored content",
  fs.readFileSync(preFile, "utf8") === "PRE-APPLY CONTENT 2\n",
);

// ── Test 4: --json output is parseable ─────────────────────
fs.writeFileSync(preFile, "PRE-APPLY CONTENT 3\n");
const t4 = tx.beginTransaction({
  targetRoot: tmpRoot,
  sourceTreeRoot: tmpRoot,
  fromVersion: "0.4.4",
  toVersion: "0.5.0",
  decisions,
  skipFastPreflight: true,
  capsule: { dir: "/fake", release: { version: "0.5.0" } },
});
fs.writeFileSync(preFile, "MID-FLIGHT 3\n");
fs.writeFileSync(newFile, "MID-FLIGHT NEW 3\n");
const r4 = spawnSync(
  process.execPath,
  [updateScript, "--rollback", t4.txId, "--target", tmpRoot, "--json"],
  { encoding: "utf8", timeout: 30_000 },
);
log("CLI --json: exit 0", r4.status === 0, `status=${r4.status}`);
let parsed = null;
try {
  parsed = JSON.parse(r4.stdout);
} catch (_e) {
  /* parsed stays null */
}
log("CLI --json output is valid JSON", parsed !== null);
log(
  "CLI --json reports ok=true mode=rollback",
  parsed && parsed.ok === true && parsed.mode === "rollback",
);
log(
  "CLI --json reports restoredCount=1 unlinkedCount=1",
  parsed && parsed.restoredCount === 1 && parsed.unlinkedCount === 1,
);

// ── Test 5: missing argument after --rollback → exit 2 ─────
const r5 = spawnSync(process.execPath, [updateScript, "--rollback"], {
  encoding: "utf8",
  timeout: 30_000,
});
log(
  "CLI --rollback with no arg: exit 2 (usage)",
  r5.status === 2,
  `status=${r5.status}`,
);

console.log(
  process.exitCode === 1
    ? "\n[smoke] SOME ASSERTIONS FAILED"
    : "\n[smoke] ALL ASSERTIONS PASSED",
);
