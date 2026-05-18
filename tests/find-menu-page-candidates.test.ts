/**
 * tests/find-menu-page-candidates.test.ts — SP-20260517-005 / S-3 / AC-3.*.
 *
 * Covers:
 *   AC-3.1: typical homepage with /pizza/, /eat/, /order toasttab — all 3
 *           returned, deduped, ≤50ms.
 *   AC-3.2: tel:/mailto: anchors excluded.
 *   AC-3.3: zero menu-keyword anchors → empty array (falls through path).
 *   AC-3.4: live Kaleidoscope fixture → /pizza/ in candidates.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { findMenuPageCandidates } from "../src/lib/menu-discovery.js";

const BASE = "https://example.com/";

test("AC-3.1: returns /pizza/, /eat/, /order toasttab; deduped; ≤50ms", () => {
  const html = `
    <html><body>
      <a href="/pizza/">Pizza</a>
      <a href="/eat/">Eat</a>
      <a href="https://order.toasttab.com/online/example">Order Online</a>
      <a href="/pizza/">Pizza again</a>      <!-- duplicate -->
      <a href="/PIZZA/">Pizza upper</a>      <!-- duplicate via normalization -->
    </body></html>
  `;
  const t0 = Date.now();
  const candidates = findMenuPageCandidates(html, BASE);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed <= 50, `expected <=50ms, got ${elapsed}ms`);
  // The 3 distinct URLs we expect (normalization-aware).
  assert.ok(candidates.some((u) => u.endsWith("/pizza")));
  assert.ok(candidates.some((u) => u.endsWith("/eat")));
  assert.ok(
    candidates.some((u) => u.startsWith("https://order.toasttab.com/")),
  );
  assert.equal(candidates.length, 3, candidates.join(", "));
});

test("AC-3.2: tel:/mailto:/fragment anchors excluded", () => {
  const html = `
    <a href="tel:5551234">Call us about our menu</a>
    <a href="mailto:hi@x.com">Email about food</a>
    <a href="#menu">Menu (fragment-only)</a>
    <a href="/menu">Menu (real link)</a>
  `;
  const candidates = findMenuPageCandidates(html, BASE);
  assert.equal(candidates.length, 1);
  assert.ok(candidates[0].endsWith("/menu"));
});

test("AC-3.3: zero menu-keyword anchors returns empty array", () => {
  const html = `
    <a href="/about/">About Us</a>
    <a href="/team/">Team</a>
    <a href="/contact/">Contact</a>
    <a href="https://twitter.com/example">Follow on Twitter</a>
  `;
  const candidates = findMenuPageCandidates(html, BASE);
  assert.deepEqual(candidates, []);
});

test("AC-3.4: Kaleidoscope-style homepage exposes /pizza/", () => {
  // Tiny inline fixture mirroring the live anchor set we validated
  // against kaleidoscopepizza.com on 2026-05-16.
  const html = `
    <nav>
      <a href="https://kaleidoscopepizza.com/eat/">Eat</a>
      <a href="https://kaleidoscopepizza.com/pizza/">Pizza</a>
      <a href="https://kaleidoscopepizza.com/drink/">Drink</a>
      <a href="https://order.toasttab.com/online/kaleidoscope-pizzeria-pub-3084-crater-lake-hwy">Order Online</a>
      <a href="https://www.doordash.com/store/36524661">Order on DoorDash</a>
      <a href="https://www.ubereats.com/store/kaleidoscope-pizzeria-pub/X">Order on UberEats</a>
    </nav>
  `;
  const candidates = findMenuPageCandidates(
    html,
    "https://kaleidoscopepizza.com/",
  );
  assert.ok(
    candidates.some((u) => u.toLowerCase().includes("/pizza")),
    `pizza link absent: ${candidates.join(", ")}`,
  );
  // Should also surface /eat/, /drink/, and the third-party order links.
  assert.ok(candidates.some((u) => u.toLowerCase().includes("/eat")));
  assert.ok(candidates.some((u) => u.toLowerCase().includes("/drink")));
  assert.ok(candidates.some((u) => u.includes("toasttab.com")));
  // 6 distinct candidates, ordered with shortest-depth first.
  assert.equal(candidates.length, 6);
});

test("relative hrefs resolve against baseUrl", () => {
  const html = `<a href="./menu/lunch.html">Lunch menu</a>`;
  const candidates = findMenuPageCandidates(html, "https://x.com/sub/");
  assert.deepEqual(candidates, ["https://x.com/sub/menu/lunch.html"]);
});

test("non-http(s) schemes rejected (no javascript:, no file:)", () => {
  const html = `
    <a href="javascript:alert('menu')">Menu via JS</a>
    <a href="file:///etc/menu">Menu via file</a>
    <a href="ftp://example.com/menu">Menu via FTP</a>
    <a href="/menu">Real menu</a>
  `;
  const candidates = findMenuPageCandidates(html, BASE);
  assert.equal(candidates.length, 1);
});

test("shortest path depth first (top-level sections before deep leaves)", () => {
  const html = `
    <a href="/menu/category/sub/pepperoni">Pepperoni</a>
    <a href="/menu/">Menu</a>
    <a href="/menu/category/">Category</a>
  `;
  const candidates = findMenuPageCandidates(html, BASE);
  assert.equal(candidates.length, 3);
  // First should be /menu (depth 1), then /menu/category (depth 2), then /menu/category/sub/pepperoni (depth 4)
  assert.ok(candidates[0].endsWith("/menu"));
  assert.ok(candidates[1].endsWith("/menu/category"));
});

test("anchor text alone (no href keyword) is enough", () => {
  // The href is /m1, /m2, /m3 (no keyword), but the text contains "menu" /
  // "food" / "order" — should still match.
  const html = `
    <a href="/m1">Our Menu</a>
    <a href="/m2">FOOD</a>
    <a href="/m3">Order online</a>
  `;
  const candidates = findMenuPageCandidates(html, BASE);
  assert.equal(candidates.length, 3);
});

test("href alone (no text keyword) is enough", () => {
  // The visible text is generic but href is /menu, /pizza, /drinks.
  const html = `
    <a href="/menu">Click here</a>
    <a href="/pizza">►</a>
    <a href="/drinks">View list</a>
  `;
  const candidates = findMenuPageCandidates(html, BASE);
  assert.equal(candidates.length, 3);
});
