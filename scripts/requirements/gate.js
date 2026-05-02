/**
 * gate.js — Freshness Gate. Refuses merge / phase advance when requirements drift is unresolved.
 *
 * Phase 3F + 3K artifact. Wired into:
 *   - post-Adhoc gauntlet
 *   - post-Oneshot phase
 *   - pre-merge merge-guard
 *   - /preflight:run
 *   - CI (.github/workflows/test.yml — Phase 5M)
 *
 * Exit codes:
 *   0 — green, all gates pass
 *   1 — yellow (warnings only, allowed-with-marker situations)
 *   2 — red, blocking
 *
 * Usage:
 *   node scripts/requirements/gate.js                # full gate
 *   node scripts/requirements/gate.js --staged-only  # only check pre-commit staged files
 *   node scripts/requirements/gate.js --json         # machine-readable
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { GRAPH_FILE } = require("./config");
const { loadGraph } = require("./graph-load");
const { listOpen, listByClass } = require("./apply-rco");

function gitStagedFiles() {
  try {
    return execSync("git diff --cached --name-only", { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function checkGraphPresent() {
  if (!fs.existsSync(GRAPH_FILE)) {
    return {
      ok: false,
      severity: "red",
      message:
        "Requirements graph missing. Run: node scripts/requirements/graph-build.js",
    };
  }
  const g = loadGraph();
  if (!g) {
    return {
      ok: false,
      severity: "red",
      message: "Requirements graph unreadable.",
    };
  }
  if (!g.counts || g.counts.requirements === 0) {
    return {
      ok: false,
      severity: "red",
      message:
        "Requirements graph has zero requirements — coverage cannot be measured.",
    };
  }
  return {
    ok: true,
    severity: "green",
    message: `Graph OK: ${g.counts.requirements} requirements across ${g.counts.features} features.`,
  };
}

function checkGraphFresh() {
  // Compare graph SHA snapshot vs current PRD/STORIES/HL-STORIES SHAs
  const g = loadGraph();
  if (!g)
    return { ok: true, severity: "green", message: "no graph; covered above" };

  // Fix-forward (gemini Phase 3 review 2026-04-30): integrity check on the
  // graph file itself. A hand-edited or partially-written graph.json that
  // happens to have current spec SHAs would otherwise pass. We require the
  // graph to declare its expected counts and validate them against what's
  // actually in the document. Catches casual tampering and partial writes.
  if (
    !g.counts ||
    typeof g.counts.requirements !== "number" ||
    typeof g.counts.features !== "number" ||
    typeof g.counts.mappedFiles !== "number"
  ) {
    return {
      ok: false,
      severity: "red",
      message:
        "Requirements graph missing or malformed counts envelope — refuse to trust. Re-run scripts/requirements/graph-build.js",
    };
  }
  const actualReqs = Object.keys(g.requirements || {}).length;
  const actualFeats = Object.keys(g.features || {}).length;
  const actualFiles = Object.keys(g.files || {}).length;
  if (
    actualReqs !== g.counts.requirements ||
    actualFeats !== g.counts.features ||
    actualFiles !== g.counts.mappedFiles
  ) {
    return {
      ok: false,
      severity: "red",
      message: `Requirements graph integrity mismatch: counts say ${g.counts.requirements}/${g.counts.features}/${g.counts.mappedFiles} but document holds ${actualReqs}/${actualFeats}/${actualFiles}. Re-run scripts/requirements/graph-build.js`,
    };
  }

  const stale = [];
  const crypto = require("crypto");
  for (const [name, rec] of Object.entries(g.features)) {
    const dir = path.resolve(__dirname, "..", "..", rec.specDir);
    for (const [file, snap] of [
      ["PRD.md", rec.prdSha],
      ["STORIES.md", rec.storiesSha],
      ["HL-STORIES.md", rec.hlStoriesSha],
    ]) {
      const full = path.join(dir, file);
      if (!snap) continue;
      if (!fs.existsSync(full)) continue;
      const cur = crypto
        .createHash("sha256")
        .update(fs.readFileSync(full))
        .digest("hex");
      if (cur !== snap) stale.push(`${name}/${file}`);
    }
  }
  if (stale.length === 0) {
    return {
      ok: true,
      severity: "green",
      message: "Graph is fresh against spec content hashes.",
    };
  }
  return {
    ok: false,
    severity: "red",
    message:
      "Spec content has changed since graph was built. Re-run scripts/requirements/graph-build.js",
    details: stale,
  };
}

function checkOpenClassC() {
  const open = listByClass("C").filter(
    (e) => e.status === "open" || e.status === undefined,
  );
  if (open.length === 0)
    return { ok: true, severity: "green", message: "No open Class C RCOs." };
  return {
    ok: false,
    severity: "red",
    message: `${open.length} open Class C RCO(s) require human resolution before merge.`,
    details: open.map((e) => ({ id: e.id, summary: e.summary || e.reason })),
  };
}

function checkStaleRequirementsHaveRCO() {
  const g = loadGraph();
  if (!g) return { ok: true, severity: "green", message: "no graph" };
  // Verification status is dynamic and lives in requirements.status.json,
  // not in the graph (which is a snapshot of spec content). Read both: the
  // graph supplies any baseline `verificationStatus` written at build time,
  // the status file supplies live updates from edit-watcher / markStale.
  const { loadStatus } = require("./status");
  const statusFile = loadStatus();
  const persisted = statusFile.requirements || {};
  const allReqs = Object.values(g.requirements);
  const stalePending = allReqs.filter((r) => {
    const live = (persisted[r.id] || {}).verificationStatus;
    return (
      live === "stale_pending_review" ||
      r.verificationStatus === "stale_pending_review"
    );
  });
  if (stalePending.length === 0) {
    return {
      ok: true,
      severity: "green",
      message: "No stale_pending_review requirements.",
    };
  }
  const open = listOpen();
  const coveredIds = new Set();
  for (const e of open) {
    for (const id of e.impactedRequirements || []) coveredIds.add(id);
  }
  const uncovered = stalePending.filter((r) => !coveredIds.has(r.id));
  if (uncovered.length === 0) {
    return {
      ok: true,
      severity: "green",
      message: `${stalePending.length} stale requirements all have RCOs.`,
    };
  }
  return {
    ok: false,
    severity: "red",
    message: `${uncovered.length} stale_pending_review requirement(s) have no RCO.`,
    details: uncovered.map((r) => r.id),
  };
}

function checkUnmappedStaged(stagedFiles) {
  // Code files that fall outside the graph's file index → unmapped warning
  // Allow markers: any file containing `// requirements-unmapped-allowed: <reason>` or
  // `<!-- requirements-unmapped-allowed: <reason> -->` in its content.
  const g = loadGraph();
  if (!g) return { ok: true, severity: "green", message: "no graph" };
  const codePatterns = [/\.tsx?$/, /\.jsx?$/];
  const concerning = [];
  for (const f of stagedFiles) {
    if (!codePatterns.some((re) => re.test(f))) continue;
    const norm = f.replace(/\\/g, "/");
    if (g.files[norm]) continue;
    // Heuristic substring match
    let matched = false;
    for (const k of Object.keys(g.files)) {
      if (norm.startsWith(k.replace(/\/$/, "") + "/") || k === norm) {
        matched = true;
        break;
      }
    }
    if (matched) continue;
    // Check for allow-marker
    let content = "";
    try {
      content = fs.readFileSync(f, "utf8");
    } catch {
      // file may have been staged-and-deleted
    }
    if (/requirements-unmapped-allowed/.test(content)) continue;
    concerning.push(f);
  }
  if (concerning.length === 0) {
    return {
      ok: true,
      severity: "green",
      message: "All staged code files map to requirements.",
    };
  }
  return {
    ok: false,
    severity: "yellow",
    message: `${concerning.length} staged code file(s) are not in any feature's implementation map.`,
    details: concerning,
  };
}

function runGate(opts) {
  const stagedOnly = opts && opts.stagedOnly;
  const checks = [
    { name: "graph_present", run: checkGraphPresent },
    { name: "graph_fresh", run: checkGraphFresh },
    { name: "open_class_c", run: checkOpenClassC },
    { name: "stale_requirements_have_rco", run: checkStaleRequirementsHaveRCO },
  ];
  if (stagedOnly) {
    const staged = gitStagedFiles();
    checks.push({
      name: "unmapped_staged",
      run: () => checkUnmappedStaged(staged),
    });
  }

  const results = [];
  let red = 0;
  let yellow = 0;
  for (const c of checks) {
    let r;
    try {
      r = c.run();
    } catch (e) {
      r = {
        ok: false,
        severity: "red",
        message: `${c.name} threw: ${e.message}`,
      };
    }
    results.push({ name: c.name, ...r });
    if (r.severity === "red") red += 1;
    if (r.severity === "yellow") yellow += 1;
  }

  const summary = {
    ok: red === 0,
    red,
    yellow,
    green: results.length - red - yellow,
    results,
  };
  return summary;
}

function format(summary) {
  const lines = [];
  for (const r of summary.results) {
    const flag =
      r.severity === "red" ? "RED " : r.severity === "yellow" ? "YEL " : "GRN ";
    lines.push(`[${flag}] ${r.name}: ${r.message}`);
    if (r.details) {
      const ds = Array.isArray(r.details) ? r.details : [r.details];
      for (const d of ds.slice(0, 10)) {
        lines.push(
          `        - ${typeof d === "string" ? d : JSON.stringify(d)}`,
        );
      }
      if (ds.length > 10) lines.push(`        ... (${ds.length - 10} more)`);
    }
  }
  lines.push(
    `\nSummary: ${summary.green} green, ${summary.yellow} yellow, ${summary.red} red — gate ${summary.ok ? "PASS" : "FAIL"}`,
  );
  return lines.join("\n");
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const stagedOnly = args.includes("--staged-only");
  const summary = runGate({ stagedOnly });
  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(format(summary));
  }
  process.exit(summary.red > 0 ? 2 : summary.yellow > 0 ? 1 : 0);
}

module.exports = {
  runGate,
  format,
};
