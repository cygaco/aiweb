#!/usr/bin/env node

/**
 * materialize-decisions.js
 * Reads .claude/project/events/events.jsonl and generates docs/DECISIONS.md
 * Groups events by change-set, auto-fills "Why" from trigger+source fields.
 */

const fs = require("fs");
const path = require("path");
const { query } = require("./hooks/lib/logger");

const PROJECT = process.env.CLAUDE_PROJECT_DIR || ".";
const DECISIONS_FILE = path.join(PROJECT, "docs", "DECISIONS.md");
const STALE_FILE = path.join(PROJECT, "docs", ".decisions", "STALE-FILES.md");

function readEvents() {
  // Read spec events from centralized log, map back to legacy shape
  const entries = query({ cat: "spec" });
  return entries.map((e) => ({
    id: e.id,
    ts: e.ts,
    file: e.data?.file || "",
    change: e.data?.change || "",
    direction: e.data?.direction || "unknown",
    group: e.data?.group || e.id,
    trigger: e.data?.trigger || "edit",
    source: e.data?.source || "Edit",
    stale_consumers: e.data?.stale_consumers || [],
    propagated: e.data?.propagated || false,
  }));
}

function inferWhy(evt) {
  const parts = [];
  if (evt.trigger && evt.trigger !== "edit") parts.push(evt.trigger);
  if (evt.source && evt.source !== "Edit" && evt.source !== "Write") {
    parts.push(`source: ${evt.source}`);
  }
  if (evt.direction && evt.direction !== "unknown") {
    parts.push(`${evt.direction} change`);
  }
  if (evt.stale_consumers?.length > 0) {
    parts.push(`→ ${evt.stale_consumers.length} file(s) marked stale`);
  }
  return parts.join(" | ") || "spec edit";
}

function propagationStatus(evt) {
  if (evt.propagated) return "✅";
  if (evt.stale_consumers?.length > 0) return "⏳";
  return "—";
}

function groupEvents(events) {
  const groups = new Map();
  for (const evt of events) {
    const key = evt.group || evt.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(evt);
  }
  return groups;
}

function renderDecisions(events) {
  const groups = groupEvents(events);

  let md = `# Decision Log

Auto-generated from \`.claude/project/events/events.jsonl\` by \`materialize-decisions.js\`.
Grouped by change-set. "Why" auto-filled from event metadata.

| Time | File | Change | Why | Status |
|---|---|---|---|---|
`;

  for (const [groupId, groupEvents] of groups) {
    for (const evt of groupEvents) {
      const time = (evt.ts || "").slice(0, 16);
      const file = evt.file || "";
      const change = (evt.change || "").replace(/\|/g, "\\|");
      const why = inferWhy(evt).replace(/\|/g, "\\|");
      const status = propagationStatus(evt);
      md += `| ${time} | ${file} | ${change} | ${why} | ${status} |\n`;
    }
  }

  return md;
}

function renderStaleFiles(events) {
  const staleSet = new Set();
  for (const evt of events) {
    if (evt.stale_consumers) {
      for (const c of evt.stale_consumers) {
        staleSet.add(c);
      }
    }
  }

  // Filter to only files that currently have STALE markers
  const currentlyStale = [];
  for (const file of staleSet) {
    const abs = path.join(PROJECT, file);
    try {
      const content = fs.readFileSync(abs, "utf8");
      if (content.includes("<!-- STALE:")) {
        currentlyStale.push(file);
      }
    } catch {
      // File doesn't exist, skip
    }
  }

  let md = `# Stale Files

Auto-generated. Files with unresolved \`<!-- STALE: -->\` markers.

`;

  if (currentlyStale.length === 0) {
    md += "**No stale files.** All changes propagated.\n";
  } else {
    md += `**${currentlyStale.length} file(s) need review:**\n\n`;
    for (const f of currentlyStale.sort()) {
      md += `- \`${f}\`\n`;
    }
  }

  return md;
}

// Main
const events = readEvents();
if (events.length === 0) {
  // No events yet, create empty decisions file
  fs.writeFileSync(
    DECISIONS_FILE,
    "# Decision Log\n\nNo events recorded yet. edit-watcher.js will populate this.\n",
    "utf8",
  );
} else {
  fs.writeFileSync(DECISIONS_FILE, renderDecisions(events), "utf8");
  fs.mkdirSync(path.dirname(STALE_FILE), { recursive: true });
  fs.writeFileSync(STALE_FILE, renderStaleFiles(events), "utf8");
}

console.log(`Materialized ${events.length} events → DECISIONS.md`);
