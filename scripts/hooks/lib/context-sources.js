/**
 * context-sources.js — Shared data loaders for smart-context hook
 *
 * Loads learnings, traces, β decisions, system state, and inbox
 * from their respective stores. No scoring or filtering — the
 * smart-context hook sends everything to Haiku for intelligent curation.
 */

const fs = require("fs");
const path = require("path");
const { PROJECT, PATHS } = require("./paths");

// All paths from paths.json — portable across projects
const MEMORY_DIR =
  PATHS.memory || path.join(PROJECT, ".claude", "project", "memory");
const AGENTS_DIR = PATHS.agents || path.join(PROJECT, ".claude", "agents");
const LEARNINGS_FILE = path.join(MEMORY_DIR, "learnings.jsonl");
const TRACES_FILE = path.join(MEMORY_DIR, "traces.jsonl");

// Beta decisions file — uses project-config if available, falls back to "alex"
let BETA_DECISIONS_FILE;
try {
  const { getAgentName } = require("./project-config");
  BETA_DECISIONS_FILE = path.join(
    AGENTS_DIR,
    getAgentName(),
    ".workspace",
    "beta",
    "events.jsonl",
  );
} catch {
  BETA_DECISIONS_FILE = path.join(
    AGENTS_DIR,
    "alex",
    ".workspace",
    "beta",
    "events.jsonl",
  );
}

// ── Parse JSONL helper ──────────────────────────────────

function parseJsonl(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return [];
    return raw
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ── Learnings ───────────────────────────────────────────

function loadAllLearnings() {
  return parseJsonl(LEARNINGS_FILE);
}

// ── Reasoning Traces ────────────────────────────────────

function loadAllTraces() {
  return parseJsonl(TRACES_FILE);
}

// ── β Decisions ─────────────────────────────────────────

function loadAllBetaDecisions() {
  return parseJsonl(BETA_DECISIONS_FILE);
}

// ── Cross-Session Inbox ─────────────────────────────────

function loadInbox() {
  try {
    const { query } = require("./logger");
    const INBOX_TTL_MS = 24 * 60 * 60 * 1000;
    const entries = query({
      cat: "inbox",
      since: Date.now() - INBOX_TTL_MS,
      limit: 10,
    });
    return entries.map((e) => ({
      ts: e.ts,
      session_id: e.session,
      from: e.data?.from || "unknown",
      message: e.data?.message || "",
    }));
  } catch {
    return [];
  }
}

// ── System State ────────────────────────────────────────

function getSystemState() {
  const state = [];

  // Recent spec events
  try {
    const { query } = require("./logger");
    const recent = query({ cat: "spec", limit: 3 });
    if (recent.length > 0) {
      const formatted = recent
        .map((e) => `${e.data?.file || "?"}: ${e.data?.change || "?"}`)
        .join(" | ");
      state.push({
        type: "recent_changes",
        content: formatted,
        ts: recent[0]?.ts,
      });
    }
  } catch {
    /* skip */
  }

  // Spec drift
  try {
    const {
      compileAllTruth,
      checkFixtureDrift,
    } = require("../../../scripts/truth-compiler");
    const results = compileAllTruth();
    const totals = { danger: 0, review: 0, cosmetic: 0 };
    for (const r of results) {
      totals.danger += r.summary.danger || 0;
      totals.review += r.summary.review || 0;
      totals.cosmetic += r.summary.cosmetic || 0;
    }
    if (totals.danger > 0 || totals.review > 0) {
      const parts = [];
      if (totals.danger > 0) parts.push(`${totals.danger} DANGER`);
      if (totals.review > 0) parts.push(`${totals.review} REVIEW`);
      if (totals.cosmetic > 0) parts.push(`${totals.cosmetic} COSMETIC`);
      state.push({
        type: "spec_drift",
        content: `Spec drift: ${parts.join(", ")}`,
        ts: new Date().toISOString(),
      });
    }

    // Fixture drift
    try {
      const fixtureDrift = checkFixtureDrift();
      if (fixtureDrift.length > 0) {
        state.push({
          type: "fixture_drift",
          content: `Fixture drift: ${fixtureDrift.length} (holdout, boss-only)`,
          ts: new Date().toISOString(),
        });
      }
    } catch {
      /* optional */
    }

    // Code without specs
    const { query } = require("./logger");
    const codeEvents = query({ cat: "code", limit: 20 });
    // RT-011 fix: exclude paths in manifest.fileOwnership.foundation. UI
    // primitives (src/components/ui/**) and shared libs are foundation —
    // they legitimately have no feature-spec folder and were false-flagged
    // as "code without specs" across run-7/8/9. See traces.jsonl RT-011.
    //
    // 2026-04-29 fix: previously we built specFeatures from recent cat:"spec"
    // events (limit 50). Features whose specs hadn't been touched recently
    // got flagged as orphan code (Step8Skills, Step13Apply in run-12).
    // Now we check the filesystem: a feature has a spec iff its
    // requirements/05-features/<feature>/PRD.md exists.
    let foundationSet = new Set();
    let specsDir = path.join(PROJECT, "docs", "05-features");
    try {
      const manifestPath = path.join(PROJECT, ".claude", "manifest.json");
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        foundationSet = new Set(manifest?.fileOwnership?.foundation ?? []);
        const projectSpecs = manifest?.projectPaths?.specs;
        if (projectSpecs) {
          specsDir = path.isAbsolute(projectSpecs)
            ? projectSpecs
            : path.join(PROJECT, projectSpecs);
        }
      }
    } catch {
      /* no manifest — treat as empty foundation, default specs dir */
    }
    function featureHasSpec(feature) {
      if (!feature) return false;
      try {
        return fs.existsSync(path.join(specsDir, feature, "PRD.md"));
      } catch {
        return false;
      }
    }
    const unmatchedCode = codeEvents.filter((e) => {
      if (!e.data?.feature || featureHasSpec(e.data.feature)) return false;
      const file = e.data?.file;
      if (typeof file === "string" && foundationSet.has(file)) return false;
      return true;
    });
    if (unmatchedCode.length > 0) {
      const files = [...new Set(unmatchedCode.map((e) => e.data?.file))].slice(
        0,
        3,
      );
      state.push({
        type: "code_without_specs",
        content: `Code without specs: ${files.join(", ")}`,
        ts: new Date().toISOString(),
      });
    }
  } catch {
    /* skip */
  }

  // Stale maps
  try {
    const mapsDir =
      PATHS.maps || path.join(PROJECT, ".claude", "project", "maps");
    const staleFile = path.join(mapsDir, ".stale.json");
    if (fs.existsSync(staleFile)) {
      const stale = JSON.parse(fs.readFileSync(staleFile, "utf8"));
      const staleNames = Object.keys(stale);
      if (staleNames.length > 0) {
        state.push({
          type: "stale_maps",
          content: `Stale maps: ${staleNames.join(", ")}`,
          ts: new Date().toISOString(),
        });
      }
    }
  } catch {
    /* skip */
  }

  return state;
}

// ── Strip system tags from prompt ───────────────────────

function stripSystemTags(raw) {
  return raw
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "")
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, "")
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, "")
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, "")
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
    .trim();
}

module.exports = {
  loadAllLearnings,
  loadAllTraces,
  loadAllBetaDecisions,
  loadInbox,
  getSystemState,
  stripSystemTags,
};
