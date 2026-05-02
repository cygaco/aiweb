// scripts/one-off-update-known-stubs.js
// Update store.knownStubs from .gut-result.json
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const d = require(path.join(ROOT, ".gut-result.json"));
const sp = path.join(ROOT, ".claude/agents/02-oneshot/.system/store.json");
const s = JSON.parse(fs.readFileSync(sp, "utf8"));
const stubFiles = d.gutted.map((g) => g.rel).sort();
s.knownStubs = stubFiles;
fs.writeFileSync(sp, JSON.stringify(s, null, 2));
console.log("knownStubs updated:", s.knownStubs.length);
