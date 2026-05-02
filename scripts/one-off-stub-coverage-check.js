#!/usr/bin/env node
// One-off: stub coverage check for /oneshot:start prep.
// Q1: do all manifest features have store entries with files[]?
// Q2: do those files exist on disk?
// Q3: are they stubs (small, with SKELETON markers) or real?
// Q4: special focus on `backend` (added this session, code dirs don't exist yet)
const fs = require("fs");
const path = require("path");
const { PATHS } = require("./hooks/lib/paths");

const manifest = JSON.parse(fs.readFileSync(PATHS.manifest, "utf8"));
const store = JSON.parse(fs.readFileSync(PATHS.oneshotStore, "utf8"));

const manifestFeatureIds = (manifest.build?.features || []).map((f) => f.id);
const storeFeatureKeys = Object.keys(store.features || {});

console.log("=== Q1: Manifest feature IDs vs store.features keys ===\n");
const missingFromStore = manifestFeatureIds.filter(
  (id) => !(id in (store.features || {})),
);
const orphanInStore = storeFeatureKeys.filter(
  (id) => !manifestFeatureIds.includes(id),
);

console.log("Manifest features:", manifestFeatureIds.length);
console.log("Store features:", storeFeatureKeys.length);
console.log("Missing from store:", missingFromStore.length, missingFromStore);
console.log(
  "Orphan in store (not in manifest):",
  orphanInStore.length,
  orphanInStore,
);

console.log("\n=== Q2/Q3: Per-feature file existence + stub status ===\n");

const SKELETON_RE = /SKELETON|stub|throw new Error\(["']\s*not implemented/i;

let fileCount = 0;
let missingFiles = [];
let nonStubFiles = [];
let realFiles = [];

for (const id of manifestFeatureIds) {
  const entry = (store.features || {})[id];
  if (!entry) {
    console.log(`[${id}] NO STORE ENTRY`);
    continue;
  }
  const files = entry.files || [];
  if (files.length === 0) {
    console.log(`[${id}] STORE ENTRY has 0 files listed`);
    continue;
  }
  for (const f of files) {
    fileCount++;
    if (!fs.existsSync(f)) {
      missingFiles.push({ feature: id, file: f });
      continue;
    }
    const stat = fs.statSync(f);
    if (stat.isDirectory()) continue;
    const content = fs.readFileSync(f, "utf8");
    const isStub = SKELETON_RE.test(content) || content.length < 600;
    if (!isStub) {
      realFiles.push({
        feature: id,
        file: f,
        lines: content.split("\n").length,
      });
    } else {
      // is stub — fine
    }
  }
}

console.log(`Total files in store: ${fileCount}`);
console.log(`Missing on disk: ${missingFiles.length}`);
console.log(`Real (non-stub): ${realFiles.length}`);
console.log(`Stubs: ${fileCount - missingFiles.length - realFiles.length}`);

if (missingFiles.length > 0) {
  console.log("\n--- MISSING FILES (per feature) ---");
  const byFeat = {};
  for (const m of missingFiles) {
    byFeat[m.feature] = byFeat[m.feature] || [];
    byFeat[m.feature].push(m.file);
  }
  for (const [feat, files] of Object.entries(byFeat)) {
    console.log(`  [${feat}] ${files.length} missing:`);
    files.slice(0, 5).forEach((f) => console.log(`    - ${f}`));
    if (files.length > 5) console.log(`    ... +${files.length - 5} more`);
  }
}

if (realFiles.length > 0) {
  console.log(
    "\n--- NON-STUB FILES (real implementations on a skeleton branch) ---",
  );
  realFiles.slice(0, 20).forEach((r) => {
    console.log(`  [${r.feature}] ${r.file} (${r.lines} lines)`);
  });
  if (realFiles.length > 20)
    console.log(`  ... +${realFiles.length - 20} more`);
}

console.log("\n=== Q4: Backend feature focus ===\n");
const backendEntry = (store.features || {}).backend;
if (!backendEntry) {
  console.log(
    "NO STORE ENTRY for 'backend' — feature added to manifest but store not synced.",
  );
  const manifestBackend = (manifest.build?.features || []).find(
    (f) => f.id === "backend",
  );
  if (manifestBackend) {
    console.log("Manifest has:", JSON.stringify(manifestBackend));
  }
} else {
  console.log("Store entry for backend:");
  console.log(`  status: ${backendEntry.status || "unset"}`);
  console.log(`  files: ${(backendEntry.files || []).length}`);
  if ((backendEntry.files || []).length > 0) {
    backendEntry.files.slice(0, 8).forEach((f) => {
      const exists = fs.existsSync(f);
      console.log(`    ${exists ? "✓" : "✗"} ${f}`);
    });
    if (backendEntry.files.length > 8) {
      console.log(`    ... +${backendEntry.files.length - 8} more`);
    }
  }
}

console.log("\n=== Q5: Stub-scaffold sub-agent existence ===\n");
const stubScaffoldPath =
  ".claude/agents/02-oneshot/stub-scaffold/stub-scaffold.md";
if (fs.existsSync(stubScaffoldPath)) {
  const content = fs.readFileSync(stubScaffoldPath, "utf8");
  console.log("✓ stub-scaffold sub-agent exists at", stubScaffoldPath);
  console.log(
    "  description:",
    (content.match(/description:\s*"([^"]+)"/) || [])[1] || "(none)",
  );
} else {
  console.log("✗ stub-scaffold sub-agent NOT FOUND");
}
