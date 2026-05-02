#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const MANIFEST = path.resolve(__dirname, "../.claude/manifest.json");
const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const foundation = m.fileOwnership?.foundation || [];

console.log("Foundation files (count=" + foundation.length + "):");
for (const f of foundation) console.log("  " + f);
