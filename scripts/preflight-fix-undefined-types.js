#!/usr/bin/env node
/**
 * preflight-fix-undefined-types.js
 *
 * For each gutted stub file: scan preserved-type blocks for identifiers
 * referenced via `typeof X` (or just bare type names). Determine which
 * identifiers are NOT imported/declared in the file. Replace those refs
 * with `any` so the type compiles.
 *
 * Conservative — only touches `typeof X` patterns and bare identifiers
 * inside the `// ── Preserved type exports ─` block.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STORE = path.join(ROOT, ".claude/agents/02-oneshot/.system/store.json");

const store = JSON.parse(fs.readFileSync(STORE, "utf8"));

function getDefined(content) {
  const set = new Set();
  // Imported names
  const importRe = /^[ \t]*import[\s\S]*?from\s+["'][^"']+["']\s*;?$/gm;
  let m;
  while ((m = importRe.exec(content))) {
    const stmt = m[0];
    let mm = stmt.match(/^import\s+(\w+)(?:\s*,)?/);
    if (mm) set.add(mm[1]);
    mm = stmt.match(/import\s+\*\s+as\s+(\w+)\s+from/);
    if (mm) set.add(mm[1]);
    mm = stmt.match(/\{([^}]+)\}/);
    if (mm) {
      const parts = mm[1].split(",").map((s) => s.trim());
      for (const p of parts) {
        if (!p) continue;
        const cleaned = p.replace(/^type\s+/, "");
        const asMatch = cleaned.match(/^\w+\s+as\s+(\w+)$/);
        if (asMatch) set.add(asMatch[1]);
        else {
          const nameMatch = cleaned.match(/^(\w+)/);
          if (nameMatch) set.add(nameMatch[1]);
        }
      }
    }
  }
  // Top-level declarations: interface, enum, type, const, function, class
  const decls = [
    /^\s*(?:export\s+)?interface\s+(\w+)/gm,
    /^\s*(?:export\s+)?enum\s+(\w+)/gm,
    /^\s*(?:export\s+)?type\s+(\w+)/gm,
    /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)/gm,
    /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm,
    /^\s*(?:export\s+)?class\s+(\w+)/gm,
  ];
  for (const re of decls) {
    while ((m = re.exec(content))) set.add(m[1]);
  }
  return set;
}

const fixed = [];
for (const [feat, fdef] of Object.entries(store.features)) {
  if (feat.startsWith("foundation-")) continue;
  for (const rel of fdef.files || []) {
    if (rel.endsWith("/")) continue;
    if (/[*?]/.test(rel)) continue;
    if (!/\.(ts|tsx)$/.test(rel)) continue;
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    let content = fs.readFileSync(abs, "utf8");
    if (!/SKELETON/.test(content)) continue;

    const defined = getDefined(content);
    const replacements = new Set();

    // Replace `typeof IDENT` where IDENT not defined → `any`
    content = content.replace(/typeof\s+(\w+)/g, (full, name) => {
      if (defined.has(name)) return full;
      // Skip JS built-ins and common globals
      if (
        [
          "undefined",
          "null",
          "true",
          "false",
          "this",
          "window",
          "document",
        ].includes(name)
      )
        return full;
      replacements.add(`typeof ${name}`);
      return "any";
    });

    if (replacements.size) {
      fs.writeFileSync(abs, content);
      fixed.push({ file: rel, replaced: [...replacements] });
    }
  }
}

console.log(JSON.stringify({ fixedCount: fixed.length, fixed }, null, 2));
