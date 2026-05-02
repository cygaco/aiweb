#!/usr/bin/env node
// preflight-update-known-stubs.js
// Update store.knownStubs from .gut-result.json AND any extra stubs created
// by the post-7.8 reconcile (preserves them rather than overwriting).
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STORE = path.join(ROOT, ".claude/agents/02-oneshot/.system/store.json");
const GUT = path.join(ROOT, ".gut-result.json");

const store = JSON.parse(fs.readFileSync(STORE, "utf8"));
const gut = JSON.parse(fs.readFileSync(GUT, "utf8"));

const set = new Set(store.knownStubs || []);
for (const g of gut.gutted || []) set.add(g.rel);

// Auto-detect: any file in a feature's files[] that exists, has SKELETON
// marker or is small (<30 lines), counts as a stub.
function isLikelyStub(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return false;
  try {
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) return false;
    const content = fs.readFileSync(abs, "utf8");
    if (/SKELETON/.test(content)) return true;
    if (content.split(/\r?\n/).length < 30) return true;
    return false;
  } catch {
    return false;
  }
}

for (const [name, f] of Object.entries(store.features)) {
  if (name.startsWith("foundation-")) continue;
  for (const file of f.files || []) {
    if (isLikelyStub(file)) set.add(file);
  }
}

store.knownStubs = [...set].sort();
fs.writeFileSync(STORE, JSON.stringify(store, null, 2));
console.log("knownStubs:", store.knownStubs.length);
