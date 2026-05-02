#!/usr/bin/env node
/**
 * delta-aggregate-reviews.js — read all reviewer output JSONs in
 * .claude/runtime/dispatch/reviewers/ and produce a pass/fail summary
 * per feature × per role.
 */
const fs = require("fs");
const path = require("path");

const DIR = path.join(
  __dirname,
  "..",
  ".claude",
  "runtime",
  "dispatch",
  "reviewers",
);

const ALL = [
  "auth",
  "rockets",
  "extension",
  "deus-mechanicus",
  "shell",
  "profile",
  "backend",
  "onboarding",
  "market-research",
  "deep-dive-qa",
  "skills-curation",
  "competitiveness",
  "resume-generation",
  "linkedin",
  "auto-apply",
];
const argv = process.argv.slice(2).filter(Boolean);
const FEATURES = argv.length ? argv : ALL;
const ROLES = ["reviewer", "compliance", "qa", "redteam"];

function readEnvelope(file) {
  try {
    let body = fs.readFileSync(file, "utf8");
    // Strip parseProviderJson prose-leak warnings on first line
    body = body.replace(/^\[parseProviderJson\][^\n]*\n/, "");
    const env = JSON.parse(body);
    return env;
  } catch (e) {
    return { ok: false, error: "file unreadable: " + e.message };
  }
}

function parseInnerJson(output) {
  if (!output) return null;
  // Find last ```json fence
  const lastFence = output.lastIndexOf("```json");
  if (lastFence < 0) return null;
  const after = output.slice(lastFence + "```json".length);
  const closeFence = after.indexOf("```");
  if (closeFence < 0) return null;
  const inner = after.slice(0, closeFence).trim();
  try {
    return JSON.parse(inner);
  } catch {
    return null;
  }
}

const summary = {};
for (const feat of FEATURES) {
  summary[feat] = {};
  for (const role of ROLES) {
    const file = path.join(DIR, `${feat}-${role}-output.json`);
    if (!fs.existsSync(file)) {
      summary[feat][role] = {
        status: "missing",
        bytes: 0,
        ok: false,
      };
      continue;
    }
    const bytes = fs.statSync(file).size;
    const env = readEnvelope(file);
    if (!env.ok) {
      summary[feat][role] = {
        status: "dispatch-failed",
        bytes,
        error: (env.error || "").slice(0, 80),
      };
      continue;
    }
    const inner = parseInnerJson(env.output);
    let pass = null;
    let counts = "";
    if (inner) {
      // Per role, look for pass/fail signals
      if (role === "reviewer") {
        pass = inner.pass === true;
        counts = `score=${inner.score ?? "?"} viol=${(inner.violations || []).length}`;
      } else if (role === "compliance") {
        pass = inner.pass === true;
        const dropped = (inner.droppedRequirements || []).length;
        const phantom = (inner.phantomCompletions || []).length;
        counts = `dropped=${dropped} phantom=${phantom}`;
      } else if (role === "qa") {
        const findings = inner.findings || [];
        const high = findings.filter((f) => f.severity === "high").length;
        const med = findings.filter((f) => f.severity === "medium").length;
        const low = findings.filter((f) => f.severity === "low").length;
        pass = high === 0;
        counts = `H=${high} M=${med} L=${low}`;
      } else if (role === "redteam") {
        pass = inner.pass === true;
        const vulns = inner.vulnerabilities || [];
        const crit = vulns.filter(
          (v) => v.severity === "critical" || v.severity === "high",
        ).length;
        counts = `vulns=${vulns.length} crit-or-high=${crit}`;
      }
    }
    summary[feat][role] = {
      status: pass === null ? "parse-fail" : pass ? "PASS" : "FAIL",
      bytes,
      ok: env.ok,
      counts,
      provider: env.provider,
      model: env.actualModel || env.model,
    };
  }
}

// Print table
console.log(
  "Feature".padEnd(18) + "Role".padEnd(11) + "Status".padEnd(15) + "Counts",
);
console.log("-".repeat(80));
for (const feat of FEATURES) {
  for (const role of ROLES) {
    const r = summary[feat][role];
    const flag = r.status === "PASS" ? "✓" : "✗";
    console.log(
      feat.padEnd(18) +
        role.padEnd(11) +
        (flag + " " + r.status).padEnd(15) +
        (r.counts || r.error || ""),
    );
  }
  console.log("");
}

// Overall pass per feature
console.log("\n=== Overall pass per feature ===");
for (const feat of FEATURES) {
  const allPass = ROLES.every((r) => summary[feat][r].status === "PASS");
  console.log(`${feat.padEnd(18)} ${allPass ? "GATE PASS" : "GATE FAIL"}`);
}

// Write JSON to runtime
fs.writeFileSync(
  path.join(__dirname, "..", ".claude", "runtime", "phase-1-gauntlet.json"),
  JSON.stringify(summary, null, 2),
);
