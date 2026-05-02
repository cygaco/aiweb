#!/usr/bin/env node
/**
 * preflight-7-8-sync.js — Pass 7.8 auto-sync helper.
 *
 * For each non-foundation feature, parse PRD Section 13 and compute the
 * file-list diff vs store.features[<feature>].files. If --apply is set,
 * patch the store. Otherwise dry-run.
 *
 * Usage:
 *   node scripts/preflight-7-8-sync.js          # dry-run
 *   node scripts/preflight-7-8-sync.js --apply  # patch store
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STORE = path.join(ROOT, ".claude/agents/02-oneshot/.system/store.json");
const FEATURES_DIR = path.join(ROOT, "requirements/05-features");

const APPLY = process.argv.includes("--apply");

const store = JSON.parse(fs.readFileSync(STORE, "utf8"));
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, ".claude/manifest.json"), "utf8"),
);
const foundationSet = new Set(manifest.fileOwnership?.foundation || []);

// Mapping from store feature name → docs dir name.
const FEATURE_TO_DIR = {
  shell: "shell",
  profile: "profile",
  auth: "auth",
  rockets: "rockets-economy",
  onboarding: "onboarding",
  "market-research": "market-research",
  extension: "extension",
  "deus-mechanicus": "deus-mechanicus",
  "skills-curation": "skills-curation",
  competitiveness: "competitiveness",
  "deep-dive-qa": "deep-dive-qa",
  "resume-generation": "resume-generation",
  "auto-apply": "auto-apply",
  linkedin: "linkedin",
  backend: "backend",
};

function parsePrdSection13(prdText) {
  // Find "## 13" header through the next "## " section.
  const lines = prdText.split(/\r?\n/);
  let inSection = false;
  const collected = [];
  for (const L of lines) {
    if (/^##\s+13\b/.test(L)) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s+\d+\b/.test(L)) break;
    if (inSection) collected.push(L);
  }
  const files = new Set();
  // Format A: markdown table rows — first column wraps a `path` in backticks.
  for (const L of collected) {
    if (!L.startsWith("|")) continue;
    if (/^\|\s*-+/.test(L)) continue;
    if (/^\|\s*File\b/i.test(L)) continue;
    const m = L.match(/^\|\s*([^|]+)\s*\|/);
    if (!m) continue;
    const cell = m[1].trim();
    const bt = cell.match(/`([^`]+)`/);
    if (!bt) continue;
    const p = bt[1].trim();
    if (!p || p === "File") continue;
    files.add(p);
  }
  // Format B: fenced code block listing one file per line (path may have
  // a comment after `—` or `--` or `#`).
  let inCode = false;
  for (const L of collected) {
    if (/^\s*```/.test(L)) {
      inCode = !inCode;
      continue;
    }
    if (!inCode) continue;
    const trimmed = L.trim();
    if (!trimmed) continue;
    // Take leading token until whitespace+separator, OR until first space.
    const m = trimmed.match(/^([^\s—#]+)/);
    if (!m) continue;
    const p = m[1].trim();
    if (!p) continue;
    // Heuristic: must look like a file path (contains . or /).
    if (!/[./]/.test(p)) continue;
    files.add(p);
  }
  return Array.from(files);
}

function isFoundation(filePath, foundationSet) {
  return foundationSet.has(filePath);
}
function isGlob(filePath) {
  return /[*?]/.test(filePath) || filePath.endsWith("/");
}

const diffs = {};
for (const [feat, fdef] of Object.entries(store.features)) {
  if (feat.startsWith("foundation-")) continue;
  const dirName = FEATURE_TO_DIR[feat] || feat;
  const prdPath = path.join(FEATURES_DIR, dirName, "PRD.md");
  if (!fs.existsSync(prdPath)) {
    diffs[feat] = { error: `PRD not found: ${prdPath}` };
    continue;
  }
  const prdText = fs.readFileSync(prdPath, "utf8");
  const prdFilesRaw = parsePrdSection13(prdText);
  // Filter: drop globs (can't be safely expanded) and foundation paths
  // (feature shouldn't own foundation files). Monorepo paths (services/backend,
  // packages/shared) are KEPT — PRDs are now authoritative for these.
  const filtered = {
    globs: prdFilesRaw.filter(isGlob),
    foundation: prdFilesRaw.filter(
      (p) => !isGlob(p) && isFoundation(p, foundationSet),
    ),
  };
  const prdFiles = new Set(
    prdFilesRaw.filter((p) => !isGlob(p) && !isFoundation(p, foundationSet)),
  );
  const storeFiles = new Set(fdef.files || []);
  const adds = [...prdFiles].filter((f) => !storeFiles.has(f));
  const removes = [...storeFiles].filter((f) => !prdFiles.has(f));
  if (adds.length || removes.length) {
    diffs[feat] = {
      prdFilesFiltered: [...prdFiles],
      storeFiles: [...storeFiles],
      adds,
      removes,
      droppedGlobs: filtered.globs,
      droppedFoundation: filtered.foundation,
    };
  } else {
    diffs[feat] = { synced: true };
  }
}

console.log(JSON.stringify(diffs, null, 2));

if (APPLY) {
  let changed = false;
  for (const [feat, d] of Object.entries(diffs)) {
    if (!d.adds && !d.removes) continue;
    if (d.error) continue;
    const next = new Set(store.features[feat].files || []);
    for (const a of d.adds) next.add(a);
    for (const r of d.removes) next.delete(r);
    store.features[feat].files = [...next].sort();
    changed = true;
    console.log(`[apply] ${feat}: +${d.adds.length} −${d.removes.length}`);
  }
  if (changed) {
    fs.writeFileSync(STORE, JSON.stringify(store, null, 2));
    console.log("[apply] store written");
  } else {
    console.log("[apply] nothing to change");
  }
}
