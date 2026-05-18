/**
 * tests/fetch-menu-html.test.ts — SP-20260517-005 / S-4 / AC-4.*.
 *
 *   AC-4.1: 3 candidates concurrently within 7s budget → concat with
 *           <!-- PAGE: url --> separators.
 *   AC-4.2: 1 of 3 candidates fails → remaining concatenated; failure
 *           recorded.
 *   AC-4.3: concat >25k truncates preserving page boundaries.
 *   AC-4.4: extraction success gate wired (covered indirectly — this
 *           test just asserts fetchMenuHtml returns a string blob that
 *           includes >=1 candidate page).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fetchMenuHtml } from "../src/lib/menu-discovery.js";

interface MockOpts {
  homepageHtml?: string;
  pages?: Record<string, string | { delayMs: number; html: string } | "fail">;
}

function startMock(opts: MockOpts): Promise<{
  base: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://x");
      const path = url.pathname;
      const send = (code: number, body: string) => {
        res.writeHead(code, {
          "Content-Type": "text/html",
          Connection: "close",
        });
        res.end(body);
      };
      if (path === "/" || path === "") {
        send(200, opts.homepageHtml ?? "");
        return;
      }
      const entry = opts.pages?.[path];
      if (entry === undefined) {
        send(404, "missing");
        return;
      }
      if (entry === "fail") {
        send(500, "boom");
        return;
      }
      if (typeof entry === "string") {
        send(200, entry);
        return;
      }
      setTimeout(() => send(200, entry.html), entry.delayMs);
    });
    server.unref();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const base = `http://127.0.0.1:${port}/`;
      resolve({
        base,
        close: () =>
          new Promise<void>((r) => {
            const s = server as http.Server & {
              closeAllConnections?: () => void;
            };
            s.closeAllConnections?.();
            server.close(() => r());
          }),
      });
    });
  });
}

test("AC-4.1: 3 candidates fetched concurrently, concat with PAGE separators", async () => {
  const mock = await startMock({
    homepageHtml: `
      <a href="/pizza/">Pizza</a>
      <a href="/eat/">Eat</a>
      <a href="/drink/">Drink</a>
    `,
    pages: {
      "/pizza": "<h1>PIZZA MENU CONTENT</h1>",
      "/eat": "<h1>EAT CATEGORIES</h1>",
      "/drink": "<h1>DRINK LIST</h1>",
    },
  });
  try {
    const r = await fetchMenuHtml(mock.base);
    assert.ok(r, "expected result, got null");
    assert.ok(r.html.includes("<!-- PAGE:"));
    assert.ok(r.html.includes("PIZZA MENU CONTENT"));
    assert.ok(r.html.includes("EAT CATEGORIES"));
    assert.ok(r.html.includes("DRINK LIST"));
    assert.equal(r.pagesFailed.length, 0);
    assert.ok(r.pagesFetched.length >= 4); // homepage + 3 candidates
  } finally {
    await mock.close();
  }
});

test("AC-4.2: 1 of 3 candidates fails (500) — remaining succeed, failure recorded", async () => {
  const mock = await startMock({
    homepageHtml: `
      <a href="/pizza/">Pizza</a>
      <a href="/eat/">Eat</a>
      <a href="/drink/">Drink</a>
    `,
    pages: {
      "/pizza": "<h1>PIZZA</h1>",
      "/eat": "fail",
      "/drink": "<h1>DRINK</h1>",
    },
  });
  try {
    const r = await fetchMenuHtml(mock.base);
    assert.ok(r);
    assert.ok(r.html.includes("PIZZA"));
    assert.ok(r.html.includes("DRINK"));
    // pagesFetched should be [homepage, /pizza, /drink] — 3 entries; /eat
    // is in pagesFailed instead.
    assert.equal(r.pagesFetched.length, 3);
    assert.equal(r.pagesFailed.length, 1);
    assert.ok(r.pagesFailed[0].includes("/eat"));
    // No PAGE: header for /eat (failed page must not appear as a fetched section).
    assert.ok(!r.html.includes(`<!-- PAGE: ${mock.base}eat`));
  } finally {
    await mock.close();
  }
});

test("AC-4.3: concat exceeding 25k chars truncates preserving page boundaries", async () => {
  const big = "X".repeat(12_000);
  const mock = await startMock({
    homepageHtml: `
      <a href="/pizza/">Pizza</a>
      <a href="/eat/">Eat</a>
      <a href="/drink/">Drink</a>
    `,
    pages: {
      "/pizza": big,
      "/eat": big,
      "/drink": big,
    },
  });
  try {
    const r = await fetchMenuHtml(mock.base);
    assert.ok(r);
    assert.ok(r.html.length <= 25_000, `expected <=25k, got ${r.html.length}`);
    // At least the homepage should be present, even if later pages were dropped.
    assert.ok(r.html.includes("<!-- PAGE: " + mock.base));
  } finally {
    await mock.close();
  }
});

test("homepage with zero menu-keyword anchors → returns homepage HTML alone (back-compat)", async () => {
  const mock = await startMock({
    homepageHtml: `<a href="/about">About</a><a href="/contact">Contact</a>`,
  });
  try {
    const r = await fetchMenuHtml(mock.base);
    assert.ok(r);
    assert.equal(r.pagesFailed.length, 0);
    assert.equal(r.pagesFetched.length, 1); // homepage only
  } finally {
    await mock.close();
  }
});

test("homepage 500 → null (caller treats as enrichment_unchanged)", async () => {
  // Start mock that always returns 500 for "/"
  const server = http.createServer((_, res) => {
    res.writeHead(500, { Connection: "close" });
    res.end("boom");
  });
  server.unref();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const url = `http://127.0.0.1:${port}/`;
  try {
    const r = await fetchMenuHtml(url);
    assert.equal(r, null);
  } finally {
    const s = server as http.Server & {
      closeAllConnections?: () => void;
    };
    s.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("only top-3 candidates fetched (cap respected)", async () => {
  const mock = await startMock({
    homepageHtml: `
      <a href="/menu">Menu</a>
      <a href="/food">Food</a>
      <a href="/eat">Eat</a>
      <a href="/order">Order</a>
      <a href="/lunch">Lunch</a>
      <a href="/dinner">Dinner</a>
    `,
    pages: {
      "/menu": "<h1>MENU</h1>",
      "/food": "<h1>FOOD</h1>",
      "/eat": "<h1>EAT</h1>",
      "/order": "<h1>ORDER</h1>",
      "/lunch": "<h1>LUNCH</h1>",
      "/dinner": "<h1>DINNER</h1>",
    },
  });
  try {
    const r = await fetchMenuHtml(mock.base);
    assert.ok(r);
    // homepage + top 3 candidates = 4 fetched pages
    assert.equal(r.pagesFetched.length, 4);
  } finally {
    await mock.close();
  }
});
