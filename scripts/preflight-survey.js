#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const STORE = path.resolve(
  __dirname,
  "../.claude/agents/02-oneshot/.system/store.json",
);
const MANIFEST = path.resolve(__dirname, "../.claude/manifest.json");

const s = JSON.parse(fs.readFileSync(STORE, "utf8"));
const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));

const foundation = m.fileOwnership?.foundation || [];
console.log("Foundation files:", foundation.length);

const features = Object.entries(s.features).filter(([n, f]) => !f.foundation);
console.log("\nFeatures (non-foundation):", features.length);

let totalFiles = 0,
  stubFiles = 0,
  nonStubFiles = 0,
  missing = [];
const nonStubByFeature = {};

for (const [name, f] of features) {
  if (!f.files) continue;
  for (const file of f.files) {
    totalFiles++;
    const abs = path.resolve(__dirname, "..", file);
    if (!fs.existsSync(abs)) {
      missing.push(file);
      continue;
    }
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      // Skip directories — count separately
      continue;
    }
    const content = fs.readFileSync(abs, "utf8");
    const lines = content.split(/\r?\n/).length;
    const hasSkel =
      /SKELETON/i.test(content) || /not implemented/i.test(content);
    const isStub = hasSkel || lines < 30;
    if (isStub) stubFiles++;
    else {
      nonStubFiles++;
      (nonStubByFeature[name] = nonStubByFeature[name] || []).push({
        file,
        lines,
      });
    }
  }
}

console.log("\nTotal files in features:", totalFiles);
console.log("Stub-like files:", stubFiles);
console.log("Non-stub files:", nonStubFiles);
console.log("Missing files:", missing.length);
if (missing.length) console.log("  Missing list:", missing.slice(0, 10));

console.log("\nNon-stub files by feature:");
for (const [feat, list] of Object.entries(nonStubByFeature)) {
  console.log(`  ${feat}: ${list.length} files`);
  list
    .slice(0, 5)
    .forEach((x) => console.log(`    - ${x.file} (${x.lines} lines)`));
}

console.log("\nKnownStubs in store:", (s.knownStubs || []).length);
