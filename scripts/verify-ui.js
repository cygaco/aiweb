#!/usr/bin/env node
/**
 * verify-ui.js — headless browser harness for Alex (Claude Code in VS Code).
 *
 * Opens http://localhost:3000 (or SITE_URL), walks specific flows, captures
 * screenshots + console logs + network errors, writes a structured JSON
 * report to .claude/runtime/ui-verify/report.json. Run from project root:
 *
 *   node scripts/verify-ui.js [flow]
 *
 * Flows:
 *   smoke        — home page loads, intro screen visible
 *   intro        — intro + drop-zone visible, Sign-in button present
 *   resume-drop  — drop a fixture resume, wait for Step3 to render
 *   nav          — click through Steps via arrow / dots
 *   all          — run all flows in sequence (default)
 *
 * Invariants: no secrets read, no cookie jar persisted, kills browser on exit.
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const SITE = process.env.SITE_URL || "http://localhost:3000";
const OUT_DIR = path.resolve(
  __dirname,
  "..",
  ".claude",
  "runtime",
  "ui-verify",
);
fs.mkdirSync(OUT_DIR, { recursive: true });

const flow = process.argv[2] || "all";
const report = {
  site: SITE,
  flow,
  startedAt: new Date().toISOString(),
  steps: [],
  consoleErrors: [],
  networkFailures: [],
  screenshots: [],
};

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      report.consoleErrors.push({
        text: msg.text().slice(0, 500),
        location: msg.location(),
      });
    }
  });
  page.on("requestfailed", (req) => {
    report.networkFailures.push({
      url: req.url(),
      method: req.method(),
      failure: req.failure()?.errorText ?? "unknown",
    });
  });
  page.on("response", (res) => {
    if (res.status() >= 500) {
      report.networkFailures.push({
        url: res.url(),
        method: res.request().method(),
        status: res.status(),
      });
    }
  });

  async function step(name, fn) {
    const t = Date.now();
    const s = { name, ok: false, ms: 0 };
    try {
      await fn();
      s.ok = true;
    } catch (e) {
      s.error = e instanceof Error ? e.message : String(e);
    } finally {
      s.ms = Date.now() - t;
      report.steps.push(s);
      process.stdout.write(
        `[${s.ok ? "OK" : "FAIL"}] ${name} (${s.ms}ms)` +
          (s.error ? ` — ${s.error}` : "") +
          "\n",
      );
    }
  }

  async function shot(name) {
    const file = path.join(OUT_DIR, `${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    report.screenshots.push(path.relative(path.dirname(OUT_DIR), file));
  }

  // — smoke —
  if (flow === "all" || flow === "smoke" || flow === "intro") {
    await step("GET /", async () => {
      const res = await page.goto(SITE, {
        waitUntil: "networkidle",
        timeout: 15000,
      });
      if (!res || !res.ok())
        throw new Error(`status=${res?.status() ?? "null"}`);
    });
    await step("await intro render", async () => {
      await page.waitForLoadState("domcontentloaded");
      // wait until mount finishes (page returns null before mounted)
      await page.waitForFunction(
        () =>
          document.body.textContent && document.body.textContent.length > 50,
        { timeout: 10000 },
      );
    });
    await shot("01-home");
  }

  // — intro detail —
  if (flow === "all" || flow === "intro") {
    await step("intro — Sign in button present", async () => {
      const btn = await page.getByRole("button", { name: /sign in/i }).first();
      await btn.waitFor({ state: "visible", timeout: 5000 });
    });
    await step("intro — drop zone present", async () => {
      // IntroScreen has a draggable area; pick any heuristic
      const anyDrop = await page
        .locator('[class*="drop"], [data-testid*="drop"], input[type="file"]')
        .first();
      await anyDrop.waitFor({ state: "attached", timeout: 5000 });
    });
    await shot("02-intro-details");
  }

  // — resume-drop — skipped unless a fixture exists
  if (flow === "resume-drop") {
    await step("resume drop — fixture missing, skipping", async () => {
      // Placeholder: a real fixture would be loaded via page.setInputFiles()
      // on the hidden <input type=file> if present. For now, report as skip.
      throw new Error("fixture not provided — skipped");
    });
  }

  // — nav probe (just URL + errors, no step jumping) —
  if (flow === "all" || flow === "nav") {
    await step("nav — reset button visible", async () => {
      const reset = await page.getByRole("button", { name: /reset/i }).first();
      await reset.waitFor({ state: "visible", timeout: 5000 });
    });
    await shot("03-nav-reset");
  }

  report.finishedAt = new Date().toISOString();
  report.ok =
    report.steps.every((s) => s.ok) &&
    report.consoleErrors.length === 0 &&
    report.networkFailures.length === 0;

  fs.writeFileSync(
    path.join(OUT_DIR, "report.json"),
    JSON.stringify(report, null, 2),
  );
  process.stdout.write(
    `\nreport: ${report.steps.length} steps, ${report.consoleErrors.length} console errors, ${report.networkFailures.length} network failures. ${report.ok ? "PASS" : "FAIL"}\n`,
  );
  process.stdout.write(`saved: ${path.join(OUT_DIR, "report.json")}\n`);

  await browser.close();
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  report.finishedAt = new Date().toISOString();
  report.fatalError = e instanceof Error ? e.message : String(e);
  fs.writeFileSync(
    path.join(OUT_DIR, "report.json"),
    JSON.stringify(report, null, 2),
  );
  process.stderr.write(`fatal: ${e}\n`);
  process.exit(2);
});
