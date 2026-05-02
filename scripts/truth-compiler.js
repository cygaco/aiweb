#!/usr/bin/env node
/**
 * truth-compiler.js — Compile ground truth from the event log.
 *
 * Given a feature name, queries events.jsonl for all spec/code events,
 * builds a timeline, identifies propagation gaps, and recommends actions
 * for each STALE marker.
 *
 * Usage:
 *   node scripts/truth-compiler.js onboarding
 *   node scripts/truth-compiler.js skills-curation
 *   node scripts/truth-compiler.js --all
 *   node scripts/truth-compiler.js --file requirements/05-features/onboarding/PRD.md
 *
 * Callable from code:
 *   const { compileFeatureTruth, compileTruth } = require("./truth-compiler");
 */

const fs = require("fs");
const path = require("path");
const { query } = require("./hooks/lib/logger");

const PROJECT = path.resolve(__dirname, "..");
const FEATURES_DIR = path.join(PROJECT, "docs", "05-features");

const SPEC_LAYERS = [
  "PRD.md",
  "HL-STORIES.md",
  "STORIES.md",
  "INPUTS.md",
  "COPY.md",
];

// ── Drift Classification ───────────────────────────────

const PRECEDENCE = (() => {
  try {
    return JSON.parse(
      fs.readFileSync(
        path.join(PROJECT, "docs", "00-canonical", "PRECEDENCE.json"),
        "utf8",
      ),
    );
  } catch {
    return { cascade: [] };
  }
})();

const TIER_LABELS = ["CLEAR", "COSMETIC", "REVIEW", "DANGER"];

const { logEvent } = require("./hooks/lib/logger");
const crypto = require("crypto");

function getLevel(filePath) {
  const rel = filePath.replace(/\\/g, "/");
  for (const entry of PRECEDENCE.cascade) {
    const pattern = entry.pattern;
    const re = new RegExp(
      "^" +
        pattern
          .replace(/\./g, "\\.")
          .replace(/\*\*/g, "##GLOBSTAR##")
          .replace(/\*/g, "[^/]+")
          .replace(/##GLOBSTAR##/g, ".*") +
        "$",
    );
    if (re.test(rel)) return entry.level;
  }
  return 99; // unknown
}

// Identify source/consumer type from file path
function getDocType(filePath) {
  const rel = filePath.replace(/\\/g, "/");
  if (rel.includes("GLOSSARY.md")) return "glossary";
  if (rel.includes("fixtures/")) return "fixture";
  if (rel.endsWith("/PRD.md")) return "prd";
  if (rel.endsWith("/HL-STORIES.md")) return "hl-stories";
  if (rel.endsWith("/STORIES.md")) return "stories";
  if (rel.endsWith("/INPUTS.md")) return "inputs";
  if (rel.endsWith("/COPY.md")) return "copy";
  if (rel.includes("00-canonical/")) return "canonical";
  if (rel.includes("04-architecture/")) return "architecture";
  return "unknown";
}

function classifyGap(gap, allGaps) {
  if (gap.resolvedByEvent) return { tier: 0, label: "CLEAR" };

  const sourceType = getDocType(gap.staleFrom);
  const consumerType = getDocType(gap.file);
  const sourceHow = gap._sourceHow || "edit";

  // Count consumers stale from the same source
  const sameSourceCount = allGaps.filter(
    (g) => !g.resolvedByEvent && g.staleFrom === gap.staleFrom,
  ).length;

  // Wide blast radius is always DANGER
  if (sameSourceCount >= 3) return { tier: 3, label: "DANGER" };

  // Source-type-aware rules (most specific first)

  // GLOSSARY → anything = COSMETIC (vocabulary updates)
  if (sourceType === "glossary") return { tier: 1, label: "COSMETIC" };

  // COPY source with edit = COSMETIC
  if (sourceType === "copy" && sourceHow === "edit")
    return { tier: 1, label: "COSMETIC" };

  // Fixture → anything = DANGER (holdout test truth diverged)
  if (sourceType === "fixture") return { tier: 3, label: "DANGER" };

  // STORIES → PRD (upstream contradiction) = DANGER
  if (sourceType === "stories" && consumerType === "prd")
    return { tier: 3, label: "DANGER" };

  // STORIES → INPUTS or COPY = DANGER (contract changed)
  if (
    sourceType === "stories" &&
    (consumerType === "inputs" || consumerType === "copy")
  )
    return { tier: 3, label: "DANGER" };

  // PRD rewrite → anything = DANGER
  if (sourceType === "prd" && sourceHow === "rewrite")
    return { tier: 3, label: "DANGER" };

  // PRD edit → downstream = REVIEW
  if (sourceType === "prd" && sourceHow === "edit")
    return { tier: 2, label: "REVIEW" };

  // HL-STORIES → STORIES = REVIEW
  if (sourceType === "hl-stories" && consumerType === "stories")
    return { tier: 2, label: "REVIEW" };

  // Default: REVIEW
  return { tier: 2, label: "REVIEW" };
}

// ── Fixture Drift (holdout-safe) ───────────────────────

function hashFile(absPath) {
  try {
    const content = fs.readFileSync(absPath);
    return crypto.createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

function checkFixtureDrift() {
  const fixturesDir = path.join(PROJECT, "docs", "00-canonical", "fixtures");
  if (!fs.existsSync(fixturesDir)) return [];

  const fixtureFiles = fs
    .readdirSync(fixturesDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(fixturesDir, f));

  const driftGaps = [];
  const allSpecEvents = query({ cat: "spec", limit: 500 });

  for (const absPath of fixtureFiles) {
    const rel = path.relative(PROJECT, absPath).replace(/\\/g, "/");
    const currentHash = hashFile(absPath);
    if (!currentHash) continue;

    // Find last fixture_hash event for this file
    const hashEvents = allSpecEvents.filter(
      (e) => e.data?.type === "fixture_hash" && e.data?.file === rel,
    );
    const lastHash =
      hashEvents.length > 0 ? hashEvents[hashEvents.length - 1] : null;

    // Find last edit event for this fixture
    const editEvents = allSpecEvents.filter(
      (e) => e.data?.file === rel && e.data?.type !== "fixture_hash",
    );
    const lastEdit =
      editEvents.length > 0 ? editEvents[editEvents.length - 1] : null;

    if (!lastEdit) continue; // No recorded edits, skip

    const fixtureChangeTime = new Date(lastEdit.ts).getTime();

    // Check if any STORIES.md files were edited after the fixture change
    const storyEditsAfter = allSpecEvents.filter((e) => {
      const file = e.data?.file || "";
      return (
        file.endsWith("/STORIES.md") &&
        new Date(e.ts).getTime() > fixtureChangeTime
      );
    });

    if (storyEditsAfter.length === 0) {
      driftGaps.push({
        file: rel,
        staleFrom: rel,
        changedAt: lastEdit.ts,
        tier: 3,
        label: "DANGER",
        holdout: true,
        recommendation:
          "DANGER — fixture changed, stories not reviewed (holdout data)",
      });
    }
  }

  return driftGaps;
}

// ── Confidence Tracking ────────────────────────────────

function getConfidence(sourceType, consumerType) {
  const resolutions = query({ cat: "spec", limit: 1000 }).filter(
    (e) => e.data?.type === "gap_resolved",
  );

  const matching = resolutions.filter((e) => {
    const src = getDocType(e.data?.staleFrom || "");
    const con = getDocType(e.data?.file || "");
    return src === sourceType && con === consumerType;
  });

  if (matching.length < 5) {
    return { accuracy: null, samples: matching.length };
  }

  // "correct" = tier matched outcome: noise→tier was COSMETIC/CLEAR, content_updated→REVIEW/DANGER
  const correct = matching.filter((e) => {
    const res = e.data?.resolution;
    const tier = e.data?.initialTier;
    if (res === "cleared_as_noise") return tier <= 1; // cosmetic/clear was right
    if (res === "content_updated") return tier >= 2; // review/danger was right
    if (res === "escalated") return tier >= 3; // danger was right
    return false;
  }).length;

  return {
    accuracy: Math.round((correct / matching.length) * 100),
    samples: matching.length,
  };
}

// ── Resolution Logging ─────────────────────────────────

function logResolution(gap, outcome) {
  logEvent("spec", {
    type: "gap_resolved",
    file: gap.file,
    staleFrom: gap.staleFrom,
    initialTier: gap.tier,
    initialLabel: gap.label,
    resolution: outcome, // "cleared_as_noise" | "content_updated" | "escalated"
    resolvedBy: "user",
  });
}

// ── Helpers ─────────────────────────────────────────────

function relPath(absPath) {
  return path.relative(PROJECT, absPath).replace(/\\/g, "/");
}

function parseStaleMarkers(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const markers = [];
    for (const line of content.split("\n")) {
      const m = line.match(
        /<!-- STALE: (.+?) changed at (.+?) — review needed -->/,
      );
      if (m) markers.push({ source: m[1], changedAt: m[2] });
    }
    return markers;
  } catch {
    return [];
  }
}

// ── Core: compile truth for one feature ─────────────────

function compileFeatureTruth(feature) {
  const featureDir = path.join(FEATURES_DIR, feature);
  if (!fs.existsSync(featureDir)) return null;

  // Gather all spec events mentioning this feature's files
  const featurePrefix = `requirements/05-features/${feature}/`;
  const allSpecEvents = query({ cat: "spec", limit: 500 });

  const featureEvents = allSpecEvents.filter((e) => {
    const file = e.data?.file || "";
    return file.includes(featurePrefix) || file.includes(feature);
  });

  // Build per-layer state
  const layers = {};
  for (const layer of SPEC_LAYERS) {
    const filePath = path.join(featureDir, layer);
    const rel = `requirements/05-features/${feature}/${layer}`;
    const exists = fs.existsSync(filePath);
    const staleMarkers = exists ? parseStaleMarkers(filePath) : [];
    const events = featureEvents.filter((e) => (e.data?.file || "") === rel);
    const lastEvent = events.length > 0 ? events[events.length - 1] : null;

    layers[layer] = {
      exists,
      staleMarkers,
      eventCount: events.length,
      lastChange: lastEvent?.ts || null,
      lastHow: lastEvent?.data?.how || null,
      propagated: lastEvent?.data?.propagated ?? null,
      direction: lastEvent?.data?.direction || null,
    };
  }

  // Determine propagation gaps
  const gaps = [];
  for (const layer of SPEC_LAYERS) {
    const info = layers[layer];
    if (!info.exists) continue;
    for (const marker of info.staleMarkers) {
      // Check if the source change has a newer event that resolved it
      const sourceEvents = featureEvents.filter(
        (e) => (e.data?.file || "") === marker.source,
      );
      const markerTime = new Date(marker.changedAt).getTime();
      const layerEvents = featureEvents.filter((e) => {
        const file = e.data?.file || "";
        return file.endsWith(layer) && new Date(e.ts).getTime() > markerTime;
      });

      // Find the source event's "how" for classification
      const lastSourceEvent =
        sourceEvents.length > 0 ? sourceEvents[sourceEvents.length - 1] : null;

      gaps.push({
        file: `requirements/05-features/${feature}/${layer}`,
        staleFrom: marker.source,
        changedAt: marker.changedAt,
        resolvedByEvent: layerEvents.length > 0,
        _sourceHow: lastSourceEvent?.data?.how || "edit",
      });
    }
  }

  // Classify all gaps (needs full list for same-source counting)
  for (const gap of gaps) {
    const { tier, label } = classifyGap(gap, gaps);
    gap.tier = tier;
    gap.label = label;
    gap.recommendation =
      tier === 0
        ? "CLEAR — downstream was updated after upstream change"
        : tier === 1
          ? "COSMETIC — low-impact change, review when convenient"
          : tier === 2
            ? "REVIEW — check if content needs updating to match upstream"
            : "DANGER — high-impact upstream change, review immediately";
  }

  return {
    feature,
    layers,
    gaps,
    totalEvents: featureEvents.length,
    summary: {
      staleCount: gaps.length,
      clear: gaps.filter((g) => g.tier === 0).length,
      cosmetic: gaps.filter((g) => g.tier === 1).length,
      review: gaps.filter((g) => g.tier === 2).length,
      danger: gaps.filter((g) => g.tier === 3).length,
    },
  };
}

// ── Compile truth for all features ──────────────────────

function compileAllTruth() {
  const features = fs
    .readdirSync(FEATURES_DIR)
    .filter((d) => fs.statSync(path.join(FEATURES_DIR, d)).isDirectory());
  return features.map((f) => compileFeatureTruth(f)).filter(Boolean);
}

// ── Compile truth for a specific file pair ──────────────

function compileTruth(fileA, fileB) {
  const allSpecEvents = query({ cat: "spec", limit: 500 });
  const relA = relPath(path.resolve(PROJECT, fileA));
  const relB = relPath(path.resolve(PROJECT, fileB));

  const eventsA = allSpecEvents.filter((e) =>
    (e.data?.file || "").includes(relA),
  );
  const eventsB = allSpecEvents.filter((e) =>
    (e.data?.file || "").includes(relB),
  );

  const lastA = eventsA.length > 0 ? eventsA[eventsA.length - 1] : null;
  const lastB = eventsB.length > 0 ? eventsB[eventsB.length - 1] : null;

  const newer = !lastA
    ? "B"
    : !lastB
      ? "A"
      : new Date(lastA.ts) > new Date(lastB.ts)
        ? "A"
        : "B";

  return {
    fileA: {
      path: relA,
      lastChange: lastA?.ts,
      events: eventsA.length,
      how: lastA?.data?.how,
    },
    fileB: {
      path: relB,
      lastChange: lastB?.ts,
      events: eventsB.length,
      how: lastB?.data?.how,
    },
    newer,
    recommendation:
      newer === "A"
        ? `${relA} changed more recently — ${relB} may need updating`
        : `${relB} changed more recently — ${relA} may need updating`,
  };
}

// ── CLI ─────────────────────────────────────────────────

if (require.main === module) {
  const arg = process.argv[2];
  if (!arg) {
    console.log(
      "Usage: node scripts/truth-compiler.js <feature|--all|--file path>",
    );
    process.exit(1);
  }

  if (arg === "--all") {
    const results = compileAllTruth();
    const totals = { clear: 0, cosmetic: 0, review: 0, danger: 0 };
    const TIER_ICONS = { CLEAR: "✓", COSMETIC: "·", REVIEW: "→", DANGER: "✗" };

    // Show DANGER features first, then REVIEW, then COSMETIC
    const ranked = results
      .filter((r) => r.summary.staleCount > 0)
      .sort(
        (a, b) =>
          b.summary.danger - a.summary.danger ||
          b.summary.review - a.summary.review,
      );

    for (const r of ranked) {
      const parts = [];
      if (r.summary.danger > 0) parts.push(`${r.summary.danger} DANGER`);
      if (r.summary.review > 0) parts.push(`${r.summary.review} REVIEW`);
      if (r.summary.cosmetic > 0) parts.push(`${r.summary.cosmetic} COSMETIC`);
      if (r.summary.clear > 0) parts.push(`${r.summary.clear} CLEAR`);
      console.log(`\n${r.feature}: ${parts.join(", ")}`);
      for (const gap of r.gaps) {
        const icon = TIER_ICONS[gap.label] || "?";
        const srcType = getDocType(gap.staleFrom);
        const conType = getDocType(gap.file);
        const conf = getConfidence(srcType, conType);
        const confStr =
          conf.accuracy !== null
            ? ` ${conf.accuracy}%`
            : conf.samples > 0
              ? ` ??% (${conf.samples})`
              : "";
        console.log(
          `  ${icon} [${gap.label}${confStr}] ${gap.file} ← ${gap.staleFrom}`,
        );
      }
      totals.clear += r.summary.clear;
      totals.cosmetic += r.summary.cosmetic;
      totals.review += r.summary.review;
      totals.danger += r.summary.danger;
    }

    // Fixture drift (holdout-safe)
    const fixtureDrift = checkFixtureDrift();
    if (fixtureDrift.length > 0) {
      console.log(`\nFIXTURE DRIFT (holdout, boss-only):`);
      for (const fg of fixtureDrift) {
        console.log(`  [DANGER] ${fg.file} — changed ${fg.changedAt}`);
      }
      totals.danger += fixtureDrift.length;
    }

    const total =
      totals.clear + totals.cosmetic + totals.review + totals.danger;
    console.log(
      `\nTOTAL: ${total} gaps | ${totals.danger} DANGER | ${totals.review} REVIEW | ${totals.cosmetic} COSMETIC | ${totals.clear} CLEAR`,
    );
  } else if (arg === "--file") {
    const fileA = process.argv[3];
    const fileB = process.argv[4];
    if (!fileA || !fileB) {
      console.log(
        "Usage: node scripts/truth-compiler.js --file <pathA> <pathB>",
      );
      process.exit(1);
    }
    console.log(JSON.stringify(compileTruth(fileA, fileB), null, 2));
  } else {
    const result = compileFeatureTruth(arg);
    if (!result) {
      console.log(`Feature "${arg}" not found in ${FEATURES_DIR}`);
      process.exit(1);
    }
    console.log(`\n${result.feature} — ${result.totalEvents} spec events`);
    const sp = [];
    if (result.summary.danger > 0) sp.push(`${result.summary.danger} DANGER`);
    if (result.summary.review > 0) sp.push(`${result.summary.review} REVIEW`);
    if (result.summary.cosmetic > 0)
      sp.push(`${result.summary.cosmetic} COSMETIC`);
    if (result.summary.clear > 0) sp.push(`${result.summary.clear} CLEAR`);
    console.log(
      `STALE: ${result.summary.staleCount} (${sp.join(", ") || "none"})\n`,
    );

    for (const [layer, info] of Object.entries(result.layers)) {
      if (!info.exists) continue;
      const status =
        info.staleMarkers.length > 0
          ? `STALE(${info.staleMarkers.length})`
          : "OK";
      const last = info.lastChange
        ? info.lastChange.substring(0, 19)
        : "no events";
      console.log(
        `  ${layer.padEnd(18)} ${status.padEnd(10)} last: ${last}  events: ${info.eventCount}`,
      );
    }

    if (result.gaps.length > 0) {
      console.log("\nGaps:");
      for (const gap of result.gaps) {
        console.log(`  [${gap.label}] ${gap.file}`);
        console.log(`         ← ${gap.staleFrom} changed ${gap.changedAt}`);
      }
    }
  }
}

module.exports = {
  compileFeatureTruth,
  compileAllTruth,
  compileTruth,
  classifyGap,
  getLevel,
  getDocType,
  getConfidence,
  checkFixtureDrift,
  logResolution,
  TIER_LABELS,
};
