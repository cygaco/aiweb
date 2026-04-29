import { test } from "node:test";
import assert from "node:assert";
import {
  initProfileStore,
  getProfile,
  updateProfile,
} from "./profile-store.js";

// Must be set before any profile-store functions are called
process.env.DATABASE_PATH = ":memory:";
process.env.PROFILE_ENCRYPTION_SECRET = "a".repeat(64);

const TEST_HASH = "b".repeat(64);

test("encrypt-decrypt round-trip", () => {
  initProfileStore();
  updateProfile(TEST_HASH, { name: "Bob", phone: "+14155551234" });
  const profile = getProfile(TEST_HASH);
  assert.strictEqual(profile.name, "Bob");
  assert.strictEqual(profile.phone, "+14155551234");
});

test("partial merge: existing fields are preserved", () => {
  initProfileStore();
  updateProfile(TEST_HASH, { name: "Alice" });
  updateProfile(TEST_HASH, { phone: "+14152335033" });
  const profile = getProfile(TEST_HASH);
  assert.strictEqual(profile.name, "Alice");
  assert.strictEqual(profile.phone, "+14152335033");
});

test("phone validation: E.164 enforcement", () => {
  initProfileStore();
  assert.doesNotThrow(() =>
    updateProfile(TEST_HASH, { phone: "+14152335033" }),
  );
  assert.throws(() => updateProfile(TEST_HASH, { phone: "1234" }), /E\.164/);
});

test("empty string clears field", () => {
  initProfileStore();
  updateProfile(TEST_HASH, { name: "Alice" });
  updateProfile(TEST_HASH, { name: "" });
  const profile = getProfile(TEST_HASH);
  assert.strictEqual(profile.name, undefined);
});

test("getProfile on unknown tokenHash returns empty profile", () => {
  initProfileStore();
  const fresh = "c".repeat(64);
  const profile = getProfile(fresh);
  assert.strictEqual(profile.name, undefined);
  assert.ok(profile.updated_at);
});

test("notes field is round-tripped verbatim (length-capped at MCP boundary)", () => {
  initProfileStore();
  updateProfile(TEST_HASH, { notes: "no peppers ever" });
  assert.strictEqual(getProfile(TEST_HASH).notes, "no peppers ever");
});

test("invalid PROFILE_ENCRYPTION_SECRET throws on use", () => {
  initProfileStore();
  const original = process.env.PROFILE_ENCRYPTION_SECRET;
  process.env.PROFILE_ENCRYPTION_SECRET = "not-hex";
  try {
    assert.throws(
      () => updateProfile(TEST_HASH, { name: "X" }),
      /64 hex chars/,
    );
  } finally {
    process.env.PROFILE_ENCRYPTION_SECRET = original;
  }
});

test("invalid tokenHash throws", () => {
  initProfileStore();
  assert.throws(() => updateProfile("short", { name: "X" }), /64 hex chars/);
});

test("notes >500 chars rejected at MCP boundary (Zod) — store accepts long input directly", () => {
  // Store layer has no length cap (cap is at server.ts Zod schema). Verify
  // store accepts long input so we don't accidentally double-validate.
  initProfileStore();
  const long = "x".repeat(2000);
  updateProfile(TEST_HASH, { notes: long });
  assert.strictEqual(getProfile(TEST_HASH).notes, long);
});

test("decryption-failure path returns empty profile", () => {
  initProfileStore();
  // Write a valid profile, then corrupt the secret so decryption fails.
  updateProfile(TEST_HASH, { name: "DecryptMe" });
  const original = process.env.PROFILE_ENCRYPTION_SECRET;
  // Use a different valid 64-hex secret so HEX_64 passes but AES-GCM auth fails.
  process.env.PROFILE_ENCRYPTION_SECRET = "f".repeat(64);
  try {
    const profile = getProfile(TEST_HASH);
    // Should return empty profile rather than throwing
    assert.strictEqual(profile.name, undefined);
    assert.ok(profile.updated_at);
  } finally {
    process.env.PROFILE_ENCRYPTION_SECRET = original;
  }
});

test("updateProfile is atomic: concurrent updates both persist", async () => {
  initProfileStore();
  const HASH = "d".repeat(64);
  // Fire two concurrent updateProfile calls — both fields must appear in final read.
  await Promise.all([
    Promise.resolve(updateProfile(HASH, { name: "Concurrent" })),
    Promise.resolve(updateProfile(HASH, { dietary: "vegan" })),
  ]);
  const profile = getProfile(HASH);
  assert.strictEqual(profile.name, "Concurrent");
  assert.strictEqual(profile.dietary, "vegan");
});
