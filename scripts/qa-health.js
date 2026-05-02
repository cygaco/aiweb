#!/usr/bin/env node
"use strict";

/**
 * qa-health.js — QA infrastructure health report for Jobzooka.
 *
 * Run: node scripts/qa-health.js
 *
 * 8 checks:
 *   1. Events Pipeline Freshness
 *   2. Memory Guard Activity
 *   3. Edit Watcher Spec Events
 *   4. Learnings Store Health
 *   5. Systems Manifest Validity
 *   6. Hook Registration
 *   7. STALE Marker Count
 *   8. Orphan Worktrees
 *
 * Exit 0 = OK/WARN only. Exit 1 = any FAIL.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

let query, queryCategory, PROJECT;

try {
  ({ query, queryCategory } = require("./hooks/lib/logger"));
  ({ PROJECT } = require("./hooks/lib/paths"));
} catch (err) {
  console.error(
    "\x1b[31m✗ FAIL\x1b[0m  Cannot import logger/paths:",
    err.message,
  );
  process.exit(1);
}

const OK = "\x1b[32m✓ OK  \x1b[0m";
const WARN = "\x1b[33m⚠ WARN\x1b[0m";
const FAIL = "\x1b[31m✗ FAIL\x1b[0m";

const results = { ok: 0, warn: 0, fail: 0 };

function report(level, msg) {
  const prefix = level === "ok" ? OK : level === "warn" ? WARN : FAIL;
  console.log(`  ${prefix} ${msg}`);
  results[level]++;
}

// ── 1. Events Pipeline Freshness ────────────────────────────────────────────

async function checkEventsFreshness() {
  try {
    const now = Date.now();
    const since24h = now - 86400000;
    const since1h = now - 3600000;

    const recent24 = query({ since: since24h });
    if (!recent24 || recent24.length === 0) {
      report("fail", "events.jsonl: no events in last 24h");
      return;
    }

    const total = query({});
    const totalCount = total ? total.length : 0;

    const lastEvent = recent24[recent24.length - 1];
    const lastTs = new Date(lastEvent.ts).getTime();
    const ageMin = Math.round((now - lastTs) / 60000);

    const recent1h = query({ since: since1h });
    if (!recent1h || recent1h.length === 0) {
      report(
        "warn",
        `events.jsonl: ${totalCount} events total, last event ${ageMin}min ago (>1h stale)`,
      );
    } else {
      report(
        "ok",
        `events.jsonl: ${totalCount} events total, last ${ageMin}min ago`,
      );
    }
  } catch (err) {
    report("fail", `events pipeline check failed: ${err.message}`);
  }
}

// ── 2. Memory Guard Activity ─────────────────────────────────────────────────

async function checkMemoryGuard() {
  try {
    const since24h = Date.now() - 86400000;

    // memory-guard logs to audit category
    const auditEvents = query({
      cat: "audit",
      since: since24h,
      search: "memory-guard",
    });

    if (!auditEvents || auditEvents.length === 0) {
      report("fail", "memory-guard: no activity in last 24h");
      return;
    }

    let blocks = 0;
    let allows = 0;
    for (const ev of auditEvents) {
      const d = ev.data || {};
      const action = (d.action || "").toLowerCase();
      const detail = (d.detail || "").toLowerCase();
      if (action.includes("block") || detail.includes("block")) {
        blocks++;
      } else {
        allows++;
      }
    }

    if (blocks === 0 && allows > 0) {
      report(
        "warn",
        `memory-guard: ${allows} allows, 0 blocks in 24h (no blocks seen)`,
      );
    } else {
      report("ok", `memory-guard: ${blocks} blocks, ${allows} allows in 24h`);
    }
  } catch (err) {
    report("fail", `memory-guard check failed: ${err.message}`);
  }
}

// ── 3. Edit Watcher Spec Events ──────────────────────────────────────────────

async function checkEditWatcher() {
  try {
    const specEvents = queryCategory("spec", { limit: 1 });
    if (!specEvents || specEvents.length === 0) {
      report("warn", "edit-watcher: no spec events found in log");
      return;
    }

    const lastSpecEvent = specEvents[specEvents.length - 1];
    const lastSpecTs = new Date(lastSpecEvent.ts).getTime();

    // Find most recently modified .md in requirements/05-features/
    const docsDir = path.join(PROJECT, "docs", "05-features");
    let latestMtime = 0;
    let latestFile = null;

    if (fs.existsSync(docsDir)) {
      function walkDir(dir) {
        let entries;
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walkDir(full);
          } else if (entry.isFile() && entry.name.endsWith(".md")) {
            try {
              const stat = fs.statSync(full);
              if (stat.mtimeMs > latestMtime) {
                latestMtime = stat.mtimeMs;
                latestFile = full;
              }
            } catch {
              /* skip */
            }
          }
        }
      }
      walkDir(docsDir);
    }

    if (!latestFile) {
      report("warn", "edit-watcher: no .md files found in requirements/05-features/");
      return;
    }

    const rel = latestFile
      .replace(PROJECT, "")
      .replace(/\\/g, "/")
      .replace(/^\//, "");
    const gapMs = latestMtime - lastSpecTs;

    if (gapMs > 300000) {
      // Most recent doc edit is >5min newer than last spec event — watcher may have missed it
      const gapMin = Math.round(gapMs / 60000);
      report(
        "warn",
        `edit-watcher: latest edit (${rel}) is ${gapMin}min newer than last spec event`,
      );
    } else {
      const ageMin = Math.round((Date.now() - lastSpecTs) / 60000);
      report(
        "ok",
        `edit-watcher: last spec event ${ageMin}min ago, matches recent edit`,
      );
    }
  } catch (err) {
    report("fail", `edit-watcher check failed: ${err.message}`);
  }
}

// ── 4. Learnings Store Health ────────────────────────────────────────────────

async function checkLearnings() {
  try {
    const learningsPath = path.join(
      PROJECT,
      ".claude",
      "memory",
      "learnings.jsonl",
    );
    if (!fs.existsSync(learningsPath)) {
      report("fail", "learnings.jsonl: file not found");
      return;
    }

    const raw = fs.readFileSync(learningsPath, "utf8").trim();
    const lines = raw ? raw.split("\n").filter(Boolean) : [];
    const total = lines.length;

    const counts = { logged: 0, validated: 0, implemented: 0, other: 0 };
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const status = entry.status || "other";
        if (status in counts) counts[status]++;
        else counts.other++;
      } catch {
        /* skip malformed */
      }
    }

    const rangeOk = total >= 30 && total <= 100;
    const hasValidated = counts.validated > 0;

    if (total === 0) {
      report("fail", "learnings.jsonl: empty");
    } else if (!rangeOk || !hasValidated) {
      const rangeNote = !rangeOk ? ` (out of 30-100 range)` : "";
      const validNote = !hasValidated ? ", 0 validated" : "";
      report(
        "warn",
        `learnings.jsonl: ${total} entries${rangeNote}${validNote} (logged:${counts.logged} validated:${counts.validated} implemented:${counts.implemented})`,
      );
    } else {
      report(
        "ok",
        `learnings.jsonl: ${total} entries (logged:${counts.logged} validated:${counts.validated} implemented:${counts.implemented})`,
      );
    }
  } catch (err) {
    report("fail", `learnings check failed: ${err.message}`);
  }
}

// ── 5. Systems Manifest Validity ─────────────────────────────────────────────

async function checkSystems() {
  try {
    const systemsPath = path.join(
      PROJECT,
      ".claude",
      "memory",
      "systems.jsonl",
    );
    if (!fs.existsSync(systemsPath)) {
      report("fail", "systems.jsonl: file not found");
      return;
    }

    const raw = fs.readFileSync(systemsPath, "utf8").trim();
    const lines = raw ? raw.split("\n").filter(Boolean) : [];

    let parseErrors = 0;
    let brokenWithoutNotes = 0;
    let total = lines.length;

    for (const line of lines) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        parseErrors++;
        continue;
      }
      if (entry.status === "broken") {
        const notes = entry.notes || entry.diagnose || "";
        if (!notes || notes === "") {
          brokenWithoutNotes++;
        }
      }
    }

    if (parseErrors > 0) {
      report(
        "fail",
        `systems.jsonl: ${parseErrors} parse error(s) in ${total} entries`,
      );
    } else if (brokenWithoutNotes > 0) {
      report(
        "warn",
        `systems.jsonl: ${total} entries valid, ${brokenWithoutNotes} broken without diagnostic notes`,
      );
    } else {
      report(
        "ok",
        `systems.jsonl: all ${total} entries valid JSON, 0 broken without notes`,
      );
    }
  } catch (err) {
    report("fail", `systems check failed: ${err.message}`);
  }
}

// ── 6. Hook Registration ─────────────────────────────────────────────────────

async function checkHookRegistration() {
  try {
    const hooksDir = path.join(PROJECT, "scripts", "hooks");
    const libDir = path.join(hooksDir, "lib");

    if (!fs.existsSync(hooksDir)) {
      report("fail", "hook registration: scripts/hooks/ directory not found");
      return;
    }

    // List .js files directly in hooks/ (not lib/)
    const hookFiles = fs.readdirSync(hooksDir).filter((f) => {
      const full = path.join(hooksDir, f);
      return f.endsWith(".js") && fs.statSync(full).isFile();
    });

    // Load settings
    const settingsPath = path.join(PROJECT, ".claude", "settings.json");
    const settingsLocalPath = path.join(
      PROJECT,
      ".claude",
      "settings.local.json",
    );

    let settingsRaw = "";
    if (fs.existsSync(settingsPath)) {
      settingsRaw += fs.readFileSync(settingsPath, "utf8");
    }
    if (fs.existsSync(settingsLocalPath)) {
      settingsRaw += fs.readFileSync(settingsLocalPath, "utf8");
    }

    if (!settingsRaw) {
      report("warn", "hook registration: no settings.json found");
      return;
    }

    const unregistered = [];
    for (const hookFile of hookFiles) {
      if (!settingsRaw.includes(hookFile)) {
        unregistered.push(hookFile);
      }
    }

    if (unregistered.length > 0) {
      report(
        "warn",
        `hook registration: ${unregistered.length} unregistered: ${unregistered.join(", ")}`,
      );
    } else {
      report(
        "ok",
        `hook registration: all ${hookFiles.length} hooks registered`,
      );
    }
  } catch (err) {
    report("fail", `hook registration check failed: ${err.message}`);
  }
}

// ── 7. STALE Marker Count ────────────────────────────────────────────────────

async function checkStaleMarkers() {
  try {
    const docsDir = path.join(PROJECT, "docs");
    if (!fs.existsSync(docsDir)) {
      report("warn", "STALE markers: docs/ directory not found");
      return;
    }

    let staleCount = 0;

    function walkDocs(dir) {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDocs(full);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          try {
            const content = fs.readFileSync(full, "utf8");
            const matches = content.match(/<!--\s*STALE:/g);
            if (matches) staleCount += matches.length;
          } catch {
            /* skip */
          }
        }
      }
    }

    walkDocs(docsDir);

    if (staleCount === 0) {
      report("ok", "STALE markers: 0 found in docs/");
    } else if (staleCount <= 20) {
      report("warn", `STALE markers: ${staleCount} found in docs/`);
    } else {
      report("fail", `STALE markers: ${staleCount} found in docs/ (>20)`);
    }
  } catch (err) {
    report("fail", `STALE marker check failed: ${err.message}`);
  }
}

// ── 8. Orphan Worktrees ──────────────────────────────────────────────────────

async function checkOrphanWorktrees() {
  try {
    const output = execSync("git worktree list", {
      cwd: PROJECT,
      encoding: "utf8",
      timeout: 10000,
    });

    const lines = output.trim().split("\n").filter(Boolean);
    // First line is always the main worktree
    const orphans = lines.length - 1;

    if (orphans === 0) {
      report("ok", "worktrees: no orphan worktrees");
    } else {
      report(
        "warn",
        `worktrees: ${orphans} additional worktree(s) beyond main`,
      );
    }
  } catch (err) {
    report("fail", `worktree check failed: ${err.message}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n  QA HEALTH REPORT");
  console.log(`  ${new Date().toISOString()}`);
  console.log("  " + "\u2500".repeat(42) + "\n");

  console.log("  EVENTS PIPELINE");
  await checkEventsFreshness();
  await checkMemoryGuard();
  await checkEditWatcher();

  console.log("\n  MEMORY STORES");
  await checkLearnings();
  await checkSystems();

  console.log("\n  HOOKS & CONFIG");
  await checkHookRegistration();
  await checkStaleMarkers();
  await checkOrphanWorktrees();

  console.log("\n  " + "\u2500".repeat(42));
  console.log(
    `  ${results.ok} OK  ${results.warn} WARN  ${results.fail} FAIL  (8 checks)\n`,
  );

  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
