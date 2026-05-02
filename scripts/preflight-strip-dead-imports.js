#!/usr/bin/env node
/**
 * preflight-strip-dead-imports.js
 *
 * After re-gut, walk every stub component/lib/route file and remove any import
 * statement whose target module path doesn't resolve on disk. Stubs don't need
 * those imports — preserved type blocks may reference imported value identifiers,
 * but if the module is gone we can't preserve those types anyway. Goal: pass
 * the build without re-stubbing the import targets.
 *
 * Resolution rules:
 *  - "@/x/y" → "src/x/y" (per tsconfig paths)
 *  - "./x", "../x" → relative to the file's dir
 *  - Bare specifiers ("react", "next/navigation", "next/server") → leave as-is
 *  - File ext: try .ts, .tsx, .js, .jsx, .json — if none exist, prune
 *
 * Also: when an import is pruned, check if any preserved-type block references
 * an identifier that came from it; if so, replace those references with `any`.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STORE = path.join(ROOT, ".claude/agents/02-oneshot/.system/store.json");

const store = JSON.parse(fs.readFileSync(STORE, "utf8"));

function isStub(content) {
  return /\bSKELETON\b/.test(content);
}

function isBare(spec) {
  return !spec.startsWith(".") && !spec.startsWith("@/");
}

function resolveImport(spec, fileAbs) {
  if (isBare(spec)) return "BARE";
  let abs;
  if (spec.startsWith("@/")) {
    abs = path.join(ROOT, "src", spec.slice(2));
  } else {
    abs = path.resolve(path.dirname(fileAbs), spec);
  }
  // Check candidates
  const candidates = [
    abs,
    abs + ".ts",
    abs + ".tsx",
    abs + ".js",
    abs + ".jsx",
    abs + ".json",
    path.join(abs, "index.ts"),
    path.join(abs, "index.tsx"),
    path.join(abs, "index.js"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return "RESOLVED";
  }
  return "MISSING";
}

function parseImportNames(stmt) {
  // Returns Set of identifier names imported (default + named).
  const names = new Set();
  // import Default from "..."
  let m = stmt.match(/^import\s+(\w+)(?:\s*,)?/);
  if (m) names.add(m[1]);
  // import * as Ns from "..."
  m = stmt.match(/import\s+\*\s+as\s+(\w+)\s+from/);
  if (m) names.add(m[1]);
  // import { a, b as c, type d } from "..."
  m = stmt.match(/\{([^}]+)\}/);
  if (m) {
    const parts = m[1].split(",").map((s) => s.trim());
    for (const p of parts) {
      if (!p) continue;
      const cleaned = p.replace(/^type\s+/, "");
      const asMatch = cleaned.match(/^\w+\s+as\s+(\w+)$/);
      if (asMatch) names.add(asMatch[1]);
      else {
        const nameMatch = cleaned.match(/^(\w+)/);
        if (nameMatch) names.add(nameMatch[1]);
      }
    }
  }
  return names;
}

const stripped = [];
const seenFiles = new Set();
for (const [feat, fdef] of Object.entries(store.features)) {
  if (feat.startsWith("foundation-")) continue;
  for (const rel of fdef.files || []) {
    if (rel.endsWith("/")) continue;
    if (/[*?]/.test(rel)) continue;
    if (!/\.(ts|tsx|js|jsx)$/.test(rel)) continue;
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    if (seenFiles.has(abs)) continue;
    seenFiles.add(abs);
    let content = fs.readFileSync(abs, "utf8");
    if (!isStub(content)) continue;

    const importRe = /^[ \t]*import[\s\S]*?from\s+["']([^"']+)["']\s*;?$/gm;
    const removed = [];
    const removedNames = new Set();
    let newContent = content.replace(importRe, (full, spec) => {
      const status = resolveImport(spec, abs);
      if (status === "MISSING") {
        const names = parseImportNames(full);
        for (const n of names) removedNames.add(n);
        removed.push(spec);
        return ""; // drop the import
      }
      return full;
    });

    if (!removed.length) continue;

    // For any identifier that was removed, replace bare references in the
    // remaining content with `any`. Conservative — only does word-boundary
    // matches outside of strings (heuristic).
    for (const name of removedNames) {
      const re = new RegExp(`\\b${name}\\b`, "g");
      newContent = newContent.replace(re, "any");
    }

    // Collapse multiple blank lines.
    newContent = newContent.replace(/\n{3,}/g, "\n\n");

    fs.writeFileSync(abs, newContent);
    stripped.push({ file: rel, removed, replacedIds: [...removedNames] });
  }
}

console.log(
  JSON.stringify({ strippedCount: stripped.length, stripped }, null, 2),
);
