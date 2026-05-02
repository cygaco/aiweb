#!/usr/bin/env node
/**
 * delta-build-fix-brief.js — assemble a unified fix brief from all 4 reviewer
 * outputs for a feature. Filters findings to those in the feature's owned
 * files where possible, and flags out-of-scope findings as cross-feature.
 *
 * Usage: node scripts/delta-build-fix-brief.js <feature> > brief.md
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STORE = path.join(
  ROOT,
  ".claude",
  "agents",
  "02-oneshot",
  ".system",
  "store.json",
);

const feature = process.argv[2];
if (!feature) {
  console.error("usage: delta-build-fix-brief.js <feature>");
  process.exit(1);
}

const store = JSON.parse(fs.readFileSync(STORE, "utf8"));
const featData = store.features[feature];
if (!featData) {
  console.error(`feature '${feature}' not in store`);
  process.exit(1);
}

const ownedFiles = new Set(featData.files || []);
const REV_DIR = path.join(ROOT, ".claude", "runtime", "dispatch", "reviewers");

function readEnv(role) {
  const file = path.join(REV_DIR, `${feature}-${role}-output.json`);
  if (!fs.existsSync(file)) return null;
  let body = fs.readFileSync(file, "utf8");
  body = body.replace(/^\[parseProviderJson\][^\n]*\n/, "");
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function parseInner(env) {
  if (!env || !env.output) return null;
  const i = env.output.lastIndexOf("```json");
  if (i < 0) return null;
  const after = env.output.slice(i + "```json".length);
  const close = after.indexOf("```");
  const inner = close < 0 ? after : after.slice(0, close);
  try {
    return JSON.parse(inner.trim());
  } catch {
    return null;
  }
}

function isInScope(filePath) {
  if (!filePath) return null;
  const norm = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  for (const owned of ownedFiles) {
    if (norm === owned || norm.startsWith(owned + "/")) return true;
  }
  // Check if it's a known foundation file (always out of scope for builders)
  return false;
}

const sections = [];
sections.push(
  `# Fix Brief — ${feature} (Run 12 fix cycle 1)\n\n## Owned files (only fix these):\n${[...ownedFiles].map((f) => `- ${f}`).join("\n")}\n`,
);

// Reviewer (legacy filename "evaluator" still searched first for transition compat)
const evalEnv = readEnv("reviewer") || readEnv("evaluator");
const evalInner = parseInner(evalEnv);
if (evalInner) {
  sections.push(
    `\n## Reviewer (score: ${evalInner.score ?? "?"}, pass: ${evalInner.pass})\n`,
  );
  if (evalInner.violations?.length) {
    sections.push("**Violations:**");
    for (const v of evalInner.violations) sections.push(`- ${v}`);
    sections.push("");
  }
  if (evalInner.warnings?.length) {
    sections.push("**Warnings:**");
    for (const w of evalInner.warnings) sections.push(`- ${w}`);
    sections.push("");
  }
  if (evalInner.groundingFailures?.length) {
    sections.push("**Grounding failures:**");
    for (const g of evalInner.groundingFailures) sections.push(`- ${g}`);
    sections.push("");
  }
}

// Compliance
const compEnv = readEnv("compliance");
const compInner = parseInner(compEnv);
if (compInner) {
  sections.push(`\n## Compliance (pass: ${compInner.pass})\n`);
  for (const cat of [
    "droppedRequirements",
    "phantomCompletions",
    "hardcodedValues",
    "missingEdgeCases",
    "cosmeticViolations",
  ]) {
    const items = compInner[cat] || [];
    if (items.length) {
      sections.push(`**${cat}:**`);
      for (const i of items) {
        if (typeof i === "string") {
          sections.push(`- ${i}`);
        } else if (i && typeof i === "object") {
          // compliance reviewers often emit {file,line,description,...}
          const file = i.file || i.path || "";
          const line = i.line ? `:${i.line}` : "";
          const desc =
            i.description ||
            i.detail ||
            i.evidence ||
            i.story ||
            JSON.stringify(i);
          sections.push(`- ${file}${line} — ${desc}`);
        }
      }
      sections.push("");
    }
  }
}

// QA
const qaEnv = readEnv("qa");
const qaInner = parseInner(qaEnv);
if (qaInner) {
  const findings = qaInner.findings || [];
  const inScope = findings.filter((f) => isInScope(f.file));
  const outOfScope = findings.filter((f) => isInScope(f.file) === false);
  sections.push(
    `\n## QA (${findings.length} total findings; ${inScope.length} in scope)\n`,
  );
  for (const f of inScope) {
    sections.push(
      `- [${f.severity}] ${f.persona || ""} ${f.file}:${f.line || "?"} — ${f.title || f.evidence || "?"}`,
    );
  }
  if (outOfScope.length) {
    sections.push(
      `\n_${outOfScope.length} findings out-of-scope (cross-feature) — do NOT fix:_`,
    );
    for (const f of outOfScope) {
      sections.push(`- [${f.severity}] ${f.file} — ${f.title || "?"}`);
    }
  }
  sections.push("");
}

// Redteam
const rtEnv = readEnv("redteam");
const rtInner = parseInner(rtEnv);
if (rtInner) {
  const vulns = rtInner.vulnerabilities || [];
  const inScope = vulns.filter((v) => isInScope(v.file));
  const outOfScope = vulns.filter((v) => isInScope(v.file) === false);
  sections.push(
    `\n## Red Team (${vulns.length} total vulns; ${inScope.length} in scope; pass: ${rtInner.pass})\n`,
  );
  for (const v of inScope) {
    sections.push(
      `- [${v.severity}] ${v.category || v.check || ""} ${v.file}:${v.line || "?"} — ${v.description || "?"}`,
    );
    if (v.recommendation) sections.push(`  → ${v.recommendation}`);
  }
  if (outOfScope.length) {
    sections.push(
      `\n_${outOfScope.length} vulnerabilities out-of-scope (cross-feature) — do NOT fix:_`,
    );
    for (const v of outOfScope) {
      sections.push(`- [${v.severity}] ${v.file} — ${v.description || "?"}`);
    }
  }
  sections.push("");
}

sections.push(`\n## Constraints
- Only modify files in your owned set above
- Do NOT touch foundation files (src/lib/types.ts, src/lib/api.ts, etc.)
- Do NOT touch other features' files (cross-feature findings are noted but you cannot address them — that's the learner's job to flag for the next phase)
- Run \`node node_modules/typescript/bin/tsc --noEmit\` after every major edit
- Commit to branch \`agent/fix/${feature}\` with a single commit
- This is fix attempt 1 of 3
`);

console.log(sections.join("\n"));
