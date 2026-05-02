#!/usr/bin/env node
/**
 * oneshot-store-file-sync.js — Sync per-feature file scopes in the oneshot
 * store from each feature's PRD Section 13 (Implementation Map).
 *
 * Phase 4.2 genericization (2026-04-30): the original v9 hardcoded
 * jobzooka-specific paths (src/app/api/auth/reset/route.ts → auth feature,
 * src/lib/rockets.ts → foundation). Per §4.2 of BACKLOG, that script
 * was project-specific and not safe to ship to WarpOS. This generic version
 * derives scopes from the PRDs themselves — no per-project file paths in
 * the script. Project-specific one-off patches now live at
 * `scripts/jobzooka-file-sync-v9.js`.
 *
 * Algorithm:
 *   1. For each feature in `requirements/05-features/<feature>/`:
 *      - parse PRD Section 13 implementation map → list of files
 *      - find feature's file scope in store.features[<feature>].files
 *      - any file in PRD §13 not in store → add (with log)
 *   2. Idempotent — re-running is a no-op when already synced.
 *
 * Usage:
 *   node scripts/oneshot-store-file-sync.js          # apply
 *   node scripts/oneshot-store-file-sync.js --dry    # plan only
 */

const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const storePath = path.join(
  projectRoot,
  ".claude",
  "agents",
  "02-oneshot",
  ".system",
  "store.json",
);
const specsRoot = path.join(projectRoot, "requirements", "05-features");

const dryRun = process.argv.includes("--dry");

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

// Reuse the requirements engine's parser. Keeps a single source of truth
// for "what does PRD Section 13 actually look like."
let extractImplementationMapFiles;
try {
  ({ extractImplementationMapFiles } = require("./requirements/graph-build"));
} catch {
  // Fallback parser if the requirements engine isn't installed yet.
  extractImplementationMapFiles = function (prd) {
    if (!prd) return [];
    const sectionMatch = prd.match(
      /^#{2,3}\s*13\.\s*Implementation Map[\s\S]*?(?=^#{2,3}\s*1[4-9]\.|\Z)/m,
    );
    if (!sectionMatch) return [];
    const files = new Set();
    const re = /`([^`]+)`/g;
    let m;
    while ((m = re.exec(sectionMatch[0])) !== null) {
      let token = m[1]
        .trim()
        .replace(/\s*\([^)]*\)\s*$/, "")
        .trim();
      if (
        /[\\/]/.test(token) ||
        /\.(ts|tsx|js|jsx|json|md|css|scss|sql|sh|py|env|toml|yaml|yml)$/i.test(
          token,
        )
      ) {
        files.add(token.replace(/\/\*+$/, ""));
      }
    }
    return Array.from(files).sort();
  };
}

function listFeatures() {
  if (!fs.existsSync(specsRoot)) return [];
  return fs
    .readdirSync(specsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name)
    .sort();
}

function syncFeature(store, feature, plan) {
  if (!store.features || !store.features[feature]) return false;
  const prdPath = path.join(specsRoot, feature, "PRD.md");
  const prd = safeRead(prdPath);
  if (!prd) return false;
  const declared = extractImplementationMapFiles(prd);
  if (declared.length === 0) return false;

  const current = new Set(store.features[feature].files || []);
  const additions = [];
  for (const f of declared) {
    if (!current.has(f)) additions.push(f);
  }
  if (additions.length === 0) return false;
  plan.push({ feature, additions });
  if (dryRun) return false;
  store.features[feature].files = [...current, ...additions].sort();
  return true;
}

function main() {
  if (!fs.existsSync(storePath)) {
    console.log(
      "[store] no oneshot store found at " + storePath + " — nothing to sync.",
    );
    return;
  }
  const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
  const plan = [];
  let mutated = false;
  for (const feature of listFeatures()) {
    if (syncFeature(store, feature, plan)) mutated = true;
  }
  if (plan.length === 0) {
    console.log(
      "[store] all per-feature file scopes already synced from PRD Section 13.",
    );
    return;
  }
  for (const p of plan) {
    console.log(
      `[store] ${p.feature}.files += ${p.additions.length} from PRD §13:`,
    );
    for (const a of p.additions.slice(0, 5)) console.log(`         + ${a}`);
    if (p.additions.length > 5)
      console.log(`         + ... (${p.additions.length - 5} more)`);
  }
  if (dryRun) {
    console.log(
      "[store] DRY-RUN — no changes written. Re-run without --dry to apply.",
    );
    return;
  }
  if (mutated) {
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
    console.log(
      `[store] wrote ${storePath} with ${plan.length} feature(s) updated.`,
    );
  }
}

main();
