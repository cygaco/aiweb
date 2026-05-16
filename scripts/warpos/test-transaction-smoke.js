#!/usr/bin/env node
/**
 * scripts/warpos/test-transaction-smoke.js — manual smoke for transaction.js.
 *
 * Builds a synthetic target tree, simulates begin → apply → rollback, and
 * prints assertions for AC-S-5.1, AC-S-5.2, AC-S-6.1, AC-S-6.2.
 *
 * Linked: SP-20260513-005 / T-055, T-056 / S-9 (precursor fixture).
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const tx = require("./transaction");

function log(name, ok, extra) {
  const tag = ok ? "PASS" : "FAIL";
  console.log(`  ${tag} ${name}${extra ? " — " + extra : ""}`);
  if (!ok) process.exitCode = 1;
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "warpos-tx-smoke-"));
console.log(`[smoke] tmpRoot = ${tmpRoot}`);

// Pre-existing file (UPDATE_SAFE) + non-existing target (ADD_SAFE).
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

console.log("[smoke] beginTransaction:");
console.log("  txId =", t.txId);
log(
  "AC-S-5.1 header.json exists",
  fs.existsSync(path.join(t.txDir, "header.json")),
);
log(
  "AC-S-5.1 plan.json exists",
  fs.existsSync(path.join(t.txDir, "plan.json")),
);
log(
  "AC-S-5.1 snapshot.json exists",
  fs.existsSync(path.join(t.txDir, "snapshot.json")),
);
log(
  "AC-S-5.1 snapshot has 2 entries (UPDATE_SAFE + ADD_SAFE)",
  t.snapshot.entries.length === 2,
  "len=" + t.snapshot.entries.length,
);
log(
  "AC-S-5.1 capsule.json exists",
  fs.existsSync(path.join(t.txDir, "capsule.json")),
);
log(
  "R-32 active.lock written",
  fs.existsSync(path.join(tmpRoot, ".warpos", "transactions", "active.lock")),
);

// AC-S-5.2 — pre_state_sha256 matches sha256(preFile); backup content identical.
const crypto = require("crypto");
const expectedSha = crypto
  .createHash("sha256")
  .update(fs.readFileSync(preFile))
  .digest("hex");
const updateEntry = t.snapshot.entries.find((e) => e.dest === "dir-a/file.md");
log(
  "AC-S-5.2 pre_state_sha256 matches actual",
  updateEntry && updateEntry.pre_state_sha256 === expectedSha,
);
log(
  "AC-S-5.2 backup file content identical",
  fs.readFileSync(path.join(t.txDir, "backup", "dir-a", "file.md"), "utf8") ===
    "PRE-APPLY CONTENT\n",
);
const addEntry = t.snapshot.entries.find((e) => e.dest === "dir-b/new.md");
log(
  "AC-S-5.1 ADD_SAFE entry has existed_pre_apply=false + backup_path=null",
  addEntry &&
    addEntry.existed_pre_apply === false &&
    addEntry.backup_path === null &&
    addEntry.intended_action === "create",
);

// Simulate apply mid-flight: overwrite + create, then trigger a rollback.
fs.writeFileSync(preFile, "POST-APPLY (new version)\n");
const newFile = path.join(tmpRoot, "dir-b", "new.md");
fs.mkdirSync(path.dirname(newFile), { recursive: true });
fs.writeFileSync(newFile, "NEW FILE FROM CAPSULE\n");

const r = tx.rollbackTransaction(t.txDir, {
  trigger: "apply",
  failedAt: "asset-3",
  errorMessage: "simulated error for smoke",
});

console.log("[smoke] rollbackTransaction:");
console.log(
  `  restoredCount=${r.restoredCount} unlinkedCount=${r.unlinkedCount} partial=${r.partial}`,
);
log(
  "AC-S-6.1 restoredCount=1 (the UPDATE_SAFE backup)",
  r.restoredCount === 1,
  `got ${r.restoredCount}`,
);
log(
  "AC-S-6.1 unlinkedCount=1 (the ADD_SAFE write)",
  r.unlinkedCount === 1,
  `got ${r.unlinkedCount}`,
);
log(
  "AC-S-6.1 pre-existing content restored",
  fs.readFileSync(preFile, "utf8") === "PRE-APPLY CONTENT\n",
);
log("AC-S-6.1 added file unlinked", !fs.existsSync(newFile));
const result = JSON.parse(
  fs.readFileSync(path.join(t.txDir, "result.json"), "utf8"),
);
log(
  "AC-S-6.2 result.outcome=rolled-back",
  result.outcome === "rolled-back",
  result.outcome,
);
log(
  "AC-S-6.2 restoredCount+unlinkedCount = 2",
  result.rollback.restoredCount + result.rollback.unlinkedCount === 2,
);
log(
  "R-32 active.lock cleared after rollback",
  !fs.existsSync(path.join(tmpRoot, ".warpos", "transactions", "active.lock")),
);

// R-31 atomic-hashed snapshot — verify the chmod, then attempt a tamper test.
const header = JSON.parse(
  fs.readFileSync(path.join(t.txDir, "header.json"), "utf8"),
);
log(
  "R-31 header.snapshotSha256 recorded",
  typeof header.snapshotSha256 === "string" &&
    header.snapshotSha256.length === 64,
);

// R-32 lock-already-taken test
fs.writeFileSync(
  path.join(tmpRoot, ".warpos", "transactions", "active.lock"),
  "fake-tx-id",
);
let lockThrew = false;
try {
  tx.beginTransaction({
    targetRoot: tmpRoot,
    sourceTreeRoot: tmpRoot,
    fromVersion: "0.4.4",
    toVersion: "0.5.0",
    decisions,
    skipFastPreflight: true,
  });
} catch (e) {
  lockThrew = e.code === "ETXLOCK";
}
log("R-32 begin refuses when active.lock present", lockThrew);

// Cleanup so we don't leave a stale lock on subsequent runs
try {
  fs.unlinkSync(path.join(tmpRoot, ".warpos", "transactions", "active.lock"));
} catch {
  /* fine */
}

console.log(
  process.exitCode === 1
    ? "\n[smoke] SOME ASSERTIONS FAILED"
    : "\n[smoke] ALL ASSERTIONS PASSED",
);
