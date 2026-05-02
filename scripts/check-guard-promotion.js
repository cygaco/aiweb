#!/usr/bin/env node
/**
 * check-guard-promotion.js
 *
 * Scans `scripts/hooks/*-guard.js` for `PROMOTION_TRIGGER` comment blocks and
 * counts matching `cat:"audit"` events from the last 7 days in
 * `paths.eventsFile`. Reports which warn-only guards are candidates for
 * promotion to hard-block.
 *
 * Usage:
 *   node scripts/check-guard-promotion.js            # pretty table
 *   node scripts/check-guard-promotion.js --json     # JSON output
 *
 * Status values:
 *   OK              count == 0
 *   NEAR_THRESHOLD  1 <= count < threshold
 *   CANDIDATE       count >= threshold
 *   OVERDUE         next_review date is in the past
 *
 * Exit code: 0 always (informational — no gating).
 */

const fs = require("fs");
const path = require("path");

const { PROJECT, PATHS } = require("./hooks/lib/paths");

const WINDOW_DAYS = 7;
const THRESHOLD = 5;
// PATHS values from lib/paths are already absolute; fall back to project-relative joins.
const HOOKS_DIR = PATHS.hooks || path.join(PROJECT, "scripts", "hooks");
const EVENTS_FILE =
  PATHS.eventsFile ||
  path.join(PROJECT, ".claude", "project", "events", "events.jsonl");

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");

// --- parse PROMOTION_TRIGGER blocks from a guard file ---------------------
function parsePromotionTrigger(filePath) {
  let body = "";
  try {
    body = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  // Match the first /** ... PROMOTION_TRIGGER: ... */ comment block
  const blockRe = /\/\*\*[\s\S]*?PROMOTION_TRIGGER:[\s\S]*?\*\//;
  const m = body.match(blockRe);
  if (!m) return null;
  const block = m[0];

  const out = {
    file: filePath,
    actor: null,
    actions: [],
    nextReview: null,
    threshold: THRESHOLD,
  };

  // actor: "name"
  const actorMatch = block.match(/actor:\s*["']([^"']+)["']/);
  if (actorMatch) out.actor = actorMatch[1];

  // action: ["a", "b"] — tolerant of line wraps / // trailing comments
  const actionMatch = block.match(/action:\s*\[([\s\S]*?)\]/);
  if (actionMatch) {
    const inner = actionMatch[1];
    const names = [...inner.matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
    out.actions = names;
  } else {
    // single action: "foo"
    const single = block.match(/action:\s*["']([^"']+)["']/);
    if (single) out.actions = [single[1]];
  }

  const review = block.match(/next_review:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/);
  if (review) out.nextReview = review[1];

  return out;
}

// --- count matching audit events in the time window -----------------------
function countWindowEvents(triggers) {
  // Build a lookup: actor → Set(action)
  const byActor = new Map();
  for (const t of triggers) {
    if (!t.actor || !t.actions.length) continue;
    if (!byActor.has(t.actor)) byActor.set(t.actor, new Set());
    const set = byActor.get(t.actor);
    for (const a of t.actions) set.add(a);
  }

  const cutoff = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const counts = new Map(); // `${actor}::${action}` → count
  const latestByKey = new Map();

  let raw = "";
  try {
    raw = fs.readFileSync(EVENTS_FILE, "utf8");
  } catch {
    return { counts, latestByKey };
  }

  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.indexOf('"cat":"audit"') === -1) continue;
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (evt.cat !== "audit") continue;
    const ts = Date.parse(evt.ts || "");
    if (!isFinite(ts) || ts < cutoff) continue;

    const actor = evt.actor || "";
    const action = (evt.data && evt.data.action) || "";
    if (!actor || !action) continue;

    const set = byActor.get(actor);
    if (!set || !set.has(action)) continue;

    const key = `${actor}::${action}`;
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!latestByKey.has(key) || ts > latestByKey.get(key)) {
      latestByKey.set(key, ts);
    }
  }

  return { counts, latestByKey };
}

// --- classify status ------------------------------------------------------
function classify(trigger, totalCount) {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = trigger.nextReview && trigger.nextReview < today;
  if (totalCount >= trigger.threshold) return "CANDIDATE";
  if (overdue) return "OVERDUE";
  if (totalCount > 0) return "NEAR_THRESHOLD";
  return "OK";
}

// --- main -----------------------------------------------------------------
function main() {
  let entries;
  try {
    entries = fs
      .readdirSync(HOOKS_DIR)
      .filter((f) => f.endsWith("-guard.js"))
      .map((f) => path.join(HOOKS_DIR, f));
  } catch (e) {
    console.error(
      `check-guard-promotion: cannot read ${HOOKS_DIR}: ${e.message}`,
    );
    process.exit(0);
  }

  const triggers = [];
  for (const fp of entries) {
    const t = parsePromotionTrigger(fp);
    if (t) triggers.push(t);
  }

  const { counts, latestByKey } = countWindowEvents(triggers);

  const rows = triggers.map((t) => {
    let total = 0;
    let latest = 0;
    for (const a of t.actions) {
      const key = `${t.actor}::${a}`;
      total += counts.get(key) || 0;
      const ts = latestByKey.get(key) || 0;
      if (ts > latest) latest = ts;
    }
    const status = classify(t, total);
    return {
      guard: path.basename(t.file),
      actor: t.actor || "(none)",
      actions: t.actions,
      count_7d: total,
      threshold: t.threshold,
      next_review: t.nextReview || "(none)",
      latest_event: latest ? new Date(latest).toISOString() : "(none)",
      status,
    };
  });

  rows.sort((a, b) => {
    const order = { CANDIDATE: 0, OVERDUE: 1, NEAR_THRESHOLD: 2, OK: 3 };
    return (order[a.status] ?? 9) - (order[b.status] ?? 9);
  });

  if (asJson) {
    process.stdout.write(
      JSON.stringify(
        { window_days: WINDOW_DAYS, threshold: THRESHOLD, rows },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  if (rows.length === 0) {
    console.log(
      "check-guard-promotion: no guards with PROMOTION_TRIGGER blocks found.",
    );
    return;
  }

  // Pretty table
  const headers = ["guard", "count_7d", "threshold", "next_review", "status"];
  const widths = headers.map((h) => h.length);
  for (const r of rows) {
    widths[0] = Math.max(widths[0], r.guard.length);
    widths[1] = Math.max(widths[1], String(r.count_7d).length);
    widths[2] = Math.max(widths[2], String(r.threshold).length);
    widths[3] = Math.max(widths[3], String(r.next_review).length);
    widths[4] = Math.max(widths[4], r.status.length);
  }
  const pad = (s, w) => String(s).padEnd(w);
  const line = (cells) =>
    "| " + cells.map((c, i) => pad(c, widths[i])).join(" | ") + " |";

  const title = `Guard promotion status — last ${WINDOW_DAYS}d, threshold ${THRESHOLD}`;
  console.log(title);
  console.log("=".repeat(title.length));
  console.log(line(headers));
  console.log("|" + widths.map((w) => "-".repeat(w + 2)).join("|") + "|");
  for (const r of rows) {
    console.log(
      line([r.guard, r.count_7d, r.threshold, r.next_review, r.status]),
    );
  }

  const candidates = rows.filter((r) => r.status === "CANDIDATE");
  if (candidates.length) {
    console.log("");
    console.log(`PROMOTION CANDIDATES (${candidates.length}):`);
    for (const c of candidates) {
      console.log(
        `  - ${c.guard}: ${c.count_7d} warnings in ${WINDOW_DAYS}d (actions: ${c.actions.join(", ")}). ` +
          `Consider removing the STRICT env gate.`,
      );
    }
  }
}

try {
  main();
} catch (e) {
  console.error(`check-guard-promotion: fatal: ${e.message}`);
  process.exit(0); // informational — never fail builds
}
