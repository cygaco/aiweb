// scripts/one-off-gut-stubs.js
// Regenerate non-foundation feature files as skeleton stubs.
// - Components (.tsx in src/components/): <25 lines, default-export name preserved, "use client" preserved
// - API routes (route.ts under src/app/.../api/): each detected HTTP method returns 501 SKELETON
// - Libs (.ts in src/lib/): preserve type/interface/const exports; function exports throw "SKELETON: <name> not implemented"
// - Extension files: tiny placeholder
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const store = require(
  path.join(ROOT, ".claude/agents/02-oneshot/.system/store.json"),
);

const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}
function write(rel, content) {
  const abs = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function extractTypeExports(txt) {
  // Returns { blocks: preservedBlocks[], names: Set<typeName> }.
  // Captures interface, type, enum declarations whether exported or not.
  // Adds `export ` prefix when re-emitting so callers can `import type`.
  const lines = txt.split(/\r?\n/);
  const preserved = [];
  const names = new Set();
  function captureBlock(startIdx) {
    let depth = 0;
    let i = startIdx;
    const buf = [];
    let started = false;
    while (i < lines.length) {
      const L = lines[i];
      buf.push(L);
      for (const ch of L) {
        if (ch === "{") {
          depth++;
          started = true;
        } else if (ch === "}") {
          depth--;
        }
      }
      i++;
      if (started && depth === 0) break;
    }
    return { block: buf.join("\n"), nextIdx: i };
  }
  function ensureExport(block) {
    // If block doesn't start with `export`, prepend it.
    return /^\s*export\s/.test(block)
      ? block
      : "export " + block.replace(/^\s*/, "");
  }
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    let m = L.match(/^\s*(?:export\s+)?interface\s+(\w+)/);
    if (m) {
      const { block, nextIdx } = captureBlock(i);
      preserved.push(ensureExport(block));
      names.add(m[1]);
      i = nextIdx - 1;
      continue;
    }
    m = L.match(/^\s*(?:export\s+)?enum\s+(\w+)/);
    if (m) {
      const { block, nextIdx } = captureBlock(i);
      preserved.push(ensureExport(block));
      names.add(m[1]);
      i = nextIdx - 1;
      continue;
    }
    // Top-level type declarations: must have = or < (generic) on the same line.
    // Excludes type-only imports like `  type ReactNode,` inside braces.
    m = L.match(/^(?:export\s+)?type\s+(\w+)\s*[<=]/);
    if (m) {
      let depth = 0;
      let buf = [];
      let j = i;
      let done = false;
      while (j < lines.length && !done) {
        const LL = lines[j];
        buf.push(LL);
        for (const ch of LL) {
          if (ch === "{" || ch === "(" || ch === "[" || ch === "<") depth++;
          else if (ch === "}" || ch === ")" || ch === "]" || ch === ">")
            depth--;
        }
        if (depth <= 0 && /;\s*(\/\/.*)?$/.test(LL)) done = true;
        j++;
      }
      preserved.push(ensureExport(buf.join("\n")));
      names.add(m[1]);
      i = j - 1;
      continue;
    }
  }
  return { blocks: preserved, names };
}

function gutComponent(rel) {
  const txt = read(rel);
  const useClient = /^["']use client["'];?/m.test(txt);
  // detect default export name
  const baseName = path.basename(rel, ".tsx");
  let exportName = baseName;
  const m1 = txt.match(/export default function\s+(\w+)/);
  const m2 = txt.match(/export default\s+(\w+)\s*;?/);
  if (m1) exportName = m1[1];
  else if (m2) exportName = m2[1];
  // Detect named exports the rest of the codebase may import.
  const namedExportSet = new Set();
  const funcRe = /export\s+(?:async\s+)?function\s+(\w+)/g;
  const constRe = /export\s+(?:const|let|var)\s+(\w+)/g;
  const classRe = /export\s+class\s+(\w+)/g;
  let mm;
  while ((mm = funcRe.exec(txt))) namedExportSet.add(mm[1]);
  while ((mm = constRe.exec(txt))) namedExportSet.add(mm[1]);
  while ((mm = classRe.exec(txt))) namedExportSet.add(mm[1]);
  // Always emit a named alias matching the baseName.
  namedExportSet.add(baseName);
  // The default-export name should also be available as a named export.
  namedExportSet.add(exportName);
  // Preserve all type/interface/enum declarations (exported or not).
  const { blocks: preservedTypes, names: preservedNames } =
    extractTypeExports(txt);
  // Always preserve import statements when ANY types are preserved.
  const importLines = [];
  if (preservedTypes.length) {
    const importRe = /^[ \t]*import[\s\S]*?from\s+["'][^"']+["']\s*;?$/gm;
    let m;
    while ((m = importRe.exec(txt))) {
      const stmt = m[0].trim();
      if (/^import\s+["']/.test(stmt)) continue; // side-effect
      if (/^import\s+React\b/.test(stmt)) continue;
      importLines.push(stmt);
    }
  }
  const lines = [];
  if (useClient) lines.push('"use client";');
  lines.push(`// SKELETON: not implemented — ${exportName}`);
  lines.push(`import React from "react";`);
  for (const L of importLines) lines.push(L);
  lines.push("");
  if (preservedTypes.length) {
    lines.push(
      "// ── Preserved type exports ─────────────────────────────────",
    );
    lines.push(preservedTypes.join("\n\n"));
    lines.push("");
  }
  // For each named export, prefer <Name>Props as the prop type if it exists.
  for (const name of namedExportSet) {
    const propsName = `${name}Props`;
    const propType = preservedNames.has(propsName) ? propsName : "any";
    const defaultExpr = propType === "any" ? " = {}" : "";
    lines.push(
      `export function ${name}(_props: ${propType}${defaultExpr}) {\n  return <div data-skeleton="${name}">SKELETON: ${name}</div>;\n}`,
    );
  }
  lines.push(`export default ${exportName};`);
  lines.push("");
  return lines.join("\n");
}

function gutRoute(rel) {
  const txt = read(rel);
  // detect which methods are exported
  const found = [];
  for (const m of HTTP_METHODS) {
    const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\b`);
    if (re.test(txt)) found.push(m);
  }
  // fallback: at least GET if nothing detected
  if (found.length === 0) found.push("GET");
  const lines = [];
  lines.push(`// SKELETON: route not implemented`);
  lines.push(`import { NextResponse } from "next/server";`);
  lines.push("");
  for (const m of found) {
    lines.push(`export async function ${m}() {`);
    lines.push(
      `  return NextResponse.json({ error: "SKELETON" }, { status: 501 });`,
    );
    lines.push(`}`);
  }
  lines.push("");
  return lines.join("\n");
}

function gutLib(rel) {
  const txt = read(rel);
  // extract:
  //   - import statements (preserve)
  //   - export interface/type/enum blocks
  //   - export const NAME = ... (literal-ish — keep)
  //   - export function/async function names → stub as throw
  //   - export const NAME = (...) => ... → stub as throw

  // Easier: keep imports, keep all `export interface ... { ... }` and `export type ... = ...;` and `export enum ... { ... }`. Stub the rest.
  const out = [];
  const fileBase = path.basename(rel, ".ts");
  out.push(`// SKELETON: lib not implemented — ${fileBase}`);

  // 1. Preserve imports (multi-line aware). Use the same regex strategy as components.
  const lines = txt.split(/\r?\n/);
  const importLines = [];
  {
    const importRe = /^[ \t]*import[\s\S]*?from\s+["'][^"']+["']\s*;?$/gm;
    let m;
    while ((m = importRe.exec(txt))) {
      const stmt = m[0].trim();
      if (/^import\s+["']/.test(stmt)) continue; // side-effect imports skipped
      importLines.push(stmt);
    }
  }
  out.push(importLines.join("\n"));
  out.push("");

  // 2. Extract exported interfaces / types / enums (multiline-aware).
  // Strategy: regex with brace counting for interface and enum blocks; type aliases end at semicolon at brace level 0.
  const preserved = [];

  function captureBlock(startIdx) {
    // Starting at startIdx (line of `export interface X {` or `export enum X {`), accumulate until brace balance returns to 0.
    let depth = 0;
    let i = startIdx;
    const buf = [];
    let started = false;
    while (i < lines.length) {
      const L = lines[i];
      buf.push(L);
      for (const ch of L) {
        if (ch === "{") {
          depth++;
          started = true;
        } else if (ch === "}") {
          depth--;
        }
      }
      i++;
      if (started && depth === 0) break;
    }
    return { block: buf.join("\n"), nextIdx: i };
  }

  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    // export interface X<...> { ... }
    if (/^\s*export\s+interface\s+\w/.test(L)) {
      const { block, nextIdx } = captureBlock(i);
      preserved.push(block);
      i = nextIdx - 1;
      continue;
    }
    // export enum X { ... }
    if (/^\s*export\s+enum\s+\w/.test(L)) {
      const { block, nextIdx } = captureBlock(i);
      preserved.push(block);
      i = nextIdx - 1;
      continue;
    }
    // export type X = ...; (single-line) OR multi-line ending with `;` at depth 0
    if (/^\s*export\s+type\s+\w/.test(L)) {
      // find end: if line has `;` at depth 0 ignoring strings, easy heuristic = collect until we find a line ending in `;` or until brace balance returns to 0 AND we see `;`
      let depth = 0;
      let buf = [];
      let j = i;
      let done = false;
      while (j < lines.length && !done) {
        const LL = lines[j];
        buf.push(LL);
        for (const ch of LL) {
          if (ch === "{" || ch === "(" || ch === "[" || ch === "<") depth++;
          else if (ch === "}" || ch === ")" || ch === "]" || ch === ">")
            depth--;
        }
        if (depth <= 0 && /;\s*(\/\/.*)?$/.test(LL)) done = true;
        j++;
      }
      preserved.push(buf.join("\n"));
      i = j - 1;
      continue;
    }
  }

  if (preserved.length) {
    out.push("// ── Preserved type exports ─────────────────────────────────");
    out.push(preserved.join("\n\n"));
    out.push("");
  }

  // 3. Stub all other exported function-like names.
  // Detect names of exported functions / consts that are likely functions (=> or function expression).
  const funcNames = new Set();
  for (const L of lines) {
    // export function foo / export async function foo
    let m = L.match(/^\s*export\s+(?:async\s+)?function\s+(\w+)/);
    if (m) {
      funcNames.add(m[1]);
      continue;
    }
    // export const foo = ( … ) =>     OR   export const foo = function(
    m = L.match(/^\s*export\s+const\s+(\w+)\s*[:=]/);
    if (m) {
      // skip if it's a known preserved literal (we can't easily tell; just stub as fn — safer: emit a throwing function with same name)
      funcNames.add(m[1]);
    }
  }

  if (funcNames.size) {
    out.push("// ── Stubbed exports ────────────────────────────────────────");
    for (const name of funcNames) {
      out.push(
        `export const ${name}: any = ((..._args: unknown[]): any => {\n  throw new Error("SKELETON: ${name} not implemented");\n});`,
      );
    }
    out.push("");
  }

  return out.join("\n");
}

function gutExtension(rel) {
  if (rel.endsWith(".html")) {
    return `<!-- SKELETON: not implemented -->\n<!DOCTYPE html>\n<html><head><title>SKELETON</title></head><body><p>SKELETON</p></body></html>\n`;
  }
  if (rel.endsWith(".css")) {
    return `/* SKELETON: not implemented */\n`;
  }
  if (rel.endsWith(".json")) {
    // extension/manifest.json — preserve "manifest_version" minimally
    return (
      JSON.stringify(
        {
          manifest_version: 3,
          name: "SKELETON",
          version: "0.0.0",
          _comment: "SKELETON: not implemented",
        },
        null,
        2,
      ) + "\n"
    );
  }
  // .js
  return `// SKELETON: not implemented\n`;
}

const gutted = [];
const skipped = [];
const failed = [];

for (const [feat, fdef] of Object.entries(store.features)) {
  if (feat.startsWith("foundation-")) continue;
  if (feat === "backend") continue; // greenfield
  for (const rel of fdef.files || []) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      skipped.push({ feat, rel, reason: "missing-on-disk" });
      continue;
    }
    try {
      let content;
      const isComp =
        /src[\\/]components[\\/]/.test(rel) && rel.endsWith(".tsx");
      const isRoute = /route\.ts$/.test(rel);
      const isLib = /src[\\/]lib[\\/]/.test(rel) && rel.endsWith(".ts");
      const isExt = /^extension[\\/]/.test(rel);
      if (isComp) content = gutComponent(rel);
      else if (isRoute) content = gutRoute(rel);
      else if (isLib) content = gutLib(rel);
      else if (isExt) content = gutExtension(rel);
      else {
        skipped.push({ feat, rel, reason: "unknown-type" });
        continue;
      }
      write(rel, content);
      gutted.push({ feat, rel });
    } catch (e) {
      failed.push({ feat, rel, error: String(e.message || e) });
    }
  }
}

console.log(
  JSON.stringify(
    {
      guttedCount: gutted.length,
      skippedCount: skipped.length,
      failedCount: failed.length,
      gutted,
      skipped,
      failed,
    },
    null,
    2,
  ),
);
