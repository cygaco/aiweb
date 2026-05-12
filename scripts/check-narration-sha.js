#!/usr/bin/env node
"use strict";
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const SENTINEL_START = "NARRATION INTEGRITY:";
const SENTINEL_END_HINT = "Brand-equivalent substitutions";
const ROOT = path.resolve(__dirname, "..");

function extractBlock(filePath, label) {
  const src = fs.readFileSync(filePath, "utf8");
  const startIdx = src.indexOf(SENTINEL_START);
  if (startIdx === -1) {
    return {
      label,
      ok: false,
      reason: "NARRATION INTEGRITY sentinel not found",
    };
  }
  const endHintIdx = src.indexOf(SENTINEL_END_HINT, startIdx);
  if (endHintIdx === -1) {
    return { label, ok: false, reason: "End sentinel hint not found" };
  }
  // Closing block boundary: next double-newline after the closing paragraph.
  const tail = src.indexOf("\n\n", endHintIdx);
  const block = src.slice(startIdx, tail === -1 ? src.length : tail).trim();
  const sha = crypto.createHash("sha256").update(block).digest("hex");
  return { label, ok: true, sha, length: block.length };
}

const surfaces = [
  { file: "src/server.ts", label: "mcp" },
  { file: "webapp/app/api/chat/route.ts", label: "webapp" },
  { file: "src/a2a/executor.ts", label: "a2a" },
];

const results = surfaces.map((s) =>
  extractBlock(path.join(ROOT, s.file), s.label),
);
console.log(JSON.stringify(results, null, 2));

const errs = results.filter((r) => !r.ok);
if (errs.length > 0) {
  console.error("FAIL: missing NARRATION block on some surface");
  process.exit(1);
}
const shas = new Set(results.map((r) => r.sha));
if (shas.size !== 1) {
  console.error("FAIL: NARRATION blocks diverge across surfaces");
  console.error(JSON.stringify(results, null, 2));
  process.exit(1);
}
console.log(
  "OK: NARRATION INTEGRITY block byte-identical across 3 surfaces. SHA:",
  [...shas][0],
);
