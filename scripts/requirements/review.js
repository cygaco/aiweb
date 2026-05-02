/**
 * review.js — backing engine for /check:requirements.
 *
 * Phase 3K artifact. The slash command becomes a thin wrapper that prints this
 * module's output. Existing /check:requirements consumers should call this.
 */

const fs = require("fs");
const path = require("path");
const { loadGraph } = require("./graph-load");
const { listOpen, listByClass } = require("./apply-rco");
const { GRAPH_FILE, COVERAGE_FILE, STATUS_FILE } = require("./config");

function review(opts) {
  const out = {
    generatedAt: new Date().toISOString(),
    graphPresent: fs.existsSync(GRAPH_FILE),
    coveragePresent: fs.existsSync(COVERAGE_FILE),
    statusPresent: fs.existsSync(STATUS_FILE),
    counts: null,
    openRCOs: 0,
    classCOpen: 0,
    stalePending: 0,
    deprecated: 0,
    orphans: [],
    duplicates: [],
    coverageByFeature: {},
  };
  const g = loadGraph();
  if (!g) return out;
  out.counts = g.counts;
  const open = listOpen();
  out.openRCOs = open.length;
  out.classCOpen = listByClass("C").filter(
    (e) => e.status === "open" || e.status === undefined,
  ).length;

  const reqs = Object.values(g.requirements);
  out.stalePending = reqs.filter(
    (r) => r.verificationStatus === "stale_pending_review",
  ).length;
  out.deprecated = reqs.filter((r) => r.status === "deprecated").length;

  // Orphans: requirements with no implementedBy AND no verifiedBy
  out.orphans = reqs
    .filter(
      (r) =>
        r.type === "granular_story" &&
        (!r.implementedBy || r.implementedBy.length === 0) &&
        (!r.verifiedBy || r.verifiedBy.length === 0),
    )
    .map((r) => r.id);

  // Duplicates: same title across different IDs within a feature
  const seen = new Map();
  for (const r of reqs) {
    const key = `${r.feature}::${(r.title || "").toLowerCase().trim()}`;
    if (!key.endsWith("::")) {
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(r.id);
    }
  }
  for (const [k, ids] of seen.entries()) {
    if (ids.length > 1) out.duplicates.push({ key: k, ids });
  }

  // Per-feature coverage
  for (const [name, rec] of Object.entries(g.features)) {
    const featureReqs = reqs.filter((r) => r.feature === name);
    const total = featureReqs.length;
    const verified = featureReqs.filter(
      (r) =>
        r.verificationStatus === "verified_by_test" ||
        r.verificationStatus === "verified_by_manual_check",
    ).length;
    out.coverageByFeature[name] = {
      total,
      verified,
      ratio: total === 0 ? 0 : Number((verified / total).toFixed(3)),
      filesInMap: (rec.implementedBy || []).length,
    };
  }

  return out;
}

if (require.main === module) {
  const json = process.argv.includes("--json");
  const r = review();
  if (json) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  console.log(`Requirements review @ ${r.generatedAt}`);
  console.log(`  graph present: ${r.graphPresent}`);
  if (r.counts) {
    console.log(
      `  features: ${r.counts.features}, requirements: ${r.counts.requirements}, files: ${r.counts.mappedFiles}`,
    );
  }
  console.log(`  open RCOs: ${r.openRCOs}  (class C: ${r.classCOpen})`);
  console.log(`  stale_pending_review: ${r.stalePending}`);
  console.log(`  deprecated: ${r.deprecated}`);
  console.log(`  orphans: ${r.orphans.length}`);
  console.log(`  duplicates: ${r.duplicates.length}`);
  console.log(`\n  per-feature coverage:`);
  for (const [name, c] of Object.entries(r.coverageByFeature)) {
    console.log(
      `    ${name.padEnd(22)} ${c.verified}/${c.total} (${(c.ratio * 100).toFixed(0)}%)  files=${c.filesInMap}`,
    );
  }
}

module.exports = { review };
