// SP-20260517-005 / S-9 / AC-9.* — googleMapsUri FIELD_MASK + link-following hop.
// Targets the SSRF guard, blocked-host filter, and Maps URI fallback path.
// Live enrichEvidence integration is covered by tests/menu-discovery.test.ts and
// the Sprint Goal Test; this file targets the helpers + edge cases the redteam
// plan flagged (threat 3 — SSRF, threat — bot-blocked aggregators).

import { test } from "node:test";
import assert from "node:assert/strict";
import { isSafeMapsUri, isBlockedHost } from "../src/lib/menu-discovery.js";

// ─── isSafeMapsUri (SSRF guard, redteam threat 3) ───────────────────────────

test("isSafeMapsUri: legitimate google.com/maps/place URLs pass", () => {
  assert.equal(
    isSafeMapsUri(
      "https://www.google.com/maps/place/Kaleidoscope+Pizzeria/@42.358,-122.838,17z",
    ),
    true,
  );
  assert.equal(
    isSafeMapsUri("https://google.com/maps/place/Tonys+Pizza"),
    true,
  );
});

test("isSafeMapsUri: refuses internal/admin URLs (SSRF defense)", () => {
  assert.equal(isSafeMapsUri("http://internal-admin/leak"), false);
  assert.equal(isSafeMapsUri("https://internal-admin/leak"), false);
  assert.equal(isSafeMapsUri("https://10.0.0.1/secret"), false);
  assert.equal(isSafeMapsUri("https://localhost/x"), false);
  assert.equal(isSafeMapsUri("https://169.254.169.254/metadata"), false);
});

test("isSafeMapsUri: refuses non-https schemes", () => {
  assert.equal(isSafeMapsUri("http://google.com/maps/place/X"), false);
  assert.equal(isSafeMapsUri("file:///etc/passwd"), false);
  assert.equal(isSafeMapsUri("ftp://google.com/maps/place/X"), false);
});

test("isSafeMapsUri: refuses google subdomains and non-maps paths", () => {
  assert.equal(isSafeMapsUri("https://google.com/search?q=pizza"), false);
  assert.equal(isSafeMapsUri("https://maps.google.com/place/X"), false);
  assert.equal(isSafeMapsUri("https://google.evil.com/maps/place/X"), false);
  assert.equal(isSafeMapsUri("https://google.com/"), false);
  assert.equal(isSafeMapsUri("https://google.com/foo/maps/place"), false);
});

test("isSafeMapsUri: handles malformed input gracefully", () => {
  assert.equal(isSafeMapsUri(""), false);
  assert.equal(isSafeMapsUri("not a url"), false);
  assert.equal(isSafeMapsUri("javascript:alert(1)"), false);
});

// ─── isBlockedHost (bot-blocked aggregator filter) ──────────────────────────

test("isBlockedHost: identifies known bot-blocked aggregators", () => {
  assert.equal(isBlockedHost("toasttab.com"), true);
  assert.equal(isBlockedHost("order.toasttab.com"), true);
  assert.equal(isBlockedHost("www.doordash.com"), true);
  assert.equal(isBlockedHost("ubereats.com"), true);
  assert.equal(isBlockedHost("grubhub.com"), true);
  assert.equal(isBlockedHost("seamless.com"), true);
});

test("isBlockedHost: blocks google.com (Maps URI hop already happened)", () => {
  assert.equal(isBlockedHost("google.com"), true);
  assert.equal(isBlockedHost("www.google.com"), true);
});

test("isBlockedHost: allows restaurant-owned sites", () => {
  assert.equal(isBlockedHost("kaleidoscopepizza.com"), false);
  assert.equal(isBlockedHost("tonyspizza.com"), false);
  assert.equal(isBlockedHost("example.com"), false);
});

test("isBlockedHost: case-insensitive", () => {
  assert.equal(isBlockedHost("TOASTTAB.COM"), true);
  assert.equal(isBlockedHost("Order.DoorDash.com"), true);
});

test("isBlockedHost: blocked-domain substring must be a host suffix, not random match", () => {
  // doordash-clone.example.com should NOT be blocked just because it contains "doordash"
  assert.equal(isBlockedHost("doordash-clone.example.com"), false);
  // not-doordash.com is its own domain; .doordash.com suffix not present
  assert.equal(isBlockedHost("not-doordash.com"), false);
});
