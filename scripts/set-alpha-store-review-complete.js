#!/usr/bin/env node
// Set cycleStep=review-complete in the alpha/adhoc store that merge-guard reads.
const fs = require("fs");
const path = require("path");
const { PATHS } = require("./hooks/lib/paths");
const STORE_PATH = path.resolve(__dirname, "..", PATHS.store);
const s = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
s.heartbeat.cycleStep = "review-complete";
fs.writeFileSync(STORE_PATH, JSON.stringify(s, null, 2));
console.log("alpha store cycleStep → review-complete");
