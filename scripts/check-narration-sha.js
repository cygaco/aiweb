#!/usr/bin/env node
"use strict";
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const BLOCKS = [
  {
    name: "NARRATION INTEGRITY",
    start: "NARRATION INTEGRITY:",
    endHint: "Brand-equivalent substitutions",
  },
  {
    name: "UPSELL TURN",
    start: "UPSELL TURN (one concise turn",
    endHint: "call confirmation is for unknowns",
  },
];

const SURFACES = [
  { file: "src/server.ts", label: "mcp" },
  { file: "webapp/app/api/chat/route.ts", label: "webapp" },
  { file: "src/a2a/executor.ts", label: "a2a" },
];

function extractBlock(src, block) {
  const startIdx = src.indexOf(block.start);
  if (startIdx === -1) {
    return { ok: false, reason: `${block.name} start sentinel not found` };
  }
  const endHintIdx = src.indexOf(block.endHint, startIdx);
  if (endHintIdx === -1) {
    return { ok: false, reason: `${block.name} end sentinel not found` };
  }
  // End at the first newline AFTER the end-hint paragraph. A single \n is
  // enough — different surfaces may or may not have a trailing blank line
  // before unrelated content (e.g. a2a template-literal closes with `\n`;`).
  const eol = src.indexOf("\n", endHintIdx);
  const text = src.slice(startIdx, eol === -1 ? src.length : eol).trim();
  const sha = crypto.createHash("sha256").update(text).digest("hex");
  return { ok: true, sha, length: text.length };
}

const report = {};
let anyFail = false;

for (const block of BLOCKS) {
  const perSurface = SURFACES.map((s) => {
    const src = fs.readFileSync(path.join(ROOT, s.file), "utf8");
    const result = extractBlock(src, block);
    return { label: s.label, ...result };
  });
  report[block.name] = perSurface;

  const missing = perSurface.filter((r) => !r.ok);
  if (missing.length > 0) {
    console.error(`FAIL: ${block.name} missing on some surface`);
    anyFail = true;
    continue;
  }
  const shas = new Set(perSurface.map((r) => r.sha));
  if (shas.size !== 1) {
    console.error(`FAIL: ${block.name} block diverges across surfaces`);
    anyFail = true;
  } else {
    console.log(
      `OK: ${block.name} block byte-identical across ${SURFACES.length} surfaces. SHA:`,
      [...shas][0],
    );
  }
}

console.log(JSON.stringify(report, null, 2));

if (anyFail) {
  process.exit(1);
}
