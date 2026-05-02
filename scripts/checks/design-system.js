#!/usr/bin/env node
/**
 * Design-system checker.
 *
 * Default mode reports violations and exits 0 so existing products can adopt it
 * incrementally. Use --strict to make violations fail the command.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const ALLOWLIST = path.join(__dirname, "design-system.allowlist.json");
const STRICT = process.argv.includes("--strict");
const JSON_MODE = process.argv.includes("--json");

const SRC_DIRS = ["src/components", "src/app"];
const DOCS = [
  "docs/01-design-system/COMPONENT_LIBRARY.md",
  "docs/01-design-system/COLOR_SEMANTICS.md",
  "docs/01-design-system/UX_PRINCIPLES.md",
  "docs/01-design-system/FEEDBACK_PATTERNS.md",
];

function loadAllowlist() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ALLOWLIST, "utf8"));
    return new Set((parsed.allow || []).map((x) => `${x.file}:${x.rule}`));
  } catch {
    return new Set();
  }
}

function walk(dir, out) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return;
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    const full = path.join(abs, ent.name);
    const rel = path.relative(ROOT, full).replace(/\\/g, "/");
    if (ent.isDirectory()) {
      if (ent.name === "legacy") continue;
      walk(rel, out);
    } else if (/\.(tsx|jsx)$/.test(ent.name)) {
      out.push(rel);
    }
  }
}

function add(findings, allow, file, line, rule, message) {
  if (allow.has(`${file}:${rule}`)) return;
  findings.push({ file, line, rule, message });
}

function scanFile(file, allow, findings) {
  const body = fs.readFileSync(path.join(ROOT, file), "utf8");
  const lines = body.split(/\r?\n/);
  const inUiPrimitive = file.startsWith("src/components/ui/");
  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    if (/(className|style=|color|background|border)/.test(line) && /#[0-9a-fA-F]{3,8}\b/.test(line)) {
      add(findings, allow, file, lineNo, "no-hex-literal", "use design tokens or CSS variables instead of hex literals");
    }
    if (/\b(text|bg|border|ring)-(blue|red|green|amber|yellow|purple|pink|indigo|emerald|teal|cyan|sky|rose|violet|fuchsia)-\d{2,3}\b/.test(line)) {
      add(findings, allow, file, lineNo, "no-tailwind-theme-color", "use tokenized colors instead of raw Tailwind theme color utilities");
    }
    if (!inUiPrimitive && /<(button|input|select|textarea)\b/.test(line)) {
      add(findings, allow, file, lineNo, "use-ui-primitive", "use the local UI primitive unless this is an accessibility-controlled wrapper");
    }
    if (/\b(any)\b/.test(line) && /Props|ComponentProps|React\.FC/.test(line)) {
      add(findings, allow, file, lineNo, "no-any-props", "component props should be typed");
    }
  });
}

function checkDocs() {
  return DOCS.map((rel) => ({ file: rel, exists: fs.existsSync(path.join(ROOT, rel)) }));
}

function check() {
  const allow = loadAllowlist();
  const files = [];
  for (const dir of SRC_DIRS) walk(dir, files);
  const findings = [];
  for (const file of files) scanFile(file, allow, findings);
  const docs = checkDocs();
  for (const d of docs) {
    if (!d.exists) findings.push({ file: d.file, line: 0, rule: "missing-design-doc", message: "required design-system doc is missing" });
  }
  return {
    ok: findings.length === 0,
    strict: STRICT,
    filesScanned: files.length,
    findings,
    docs,
  };
}

if (require.main === module) {
  const result = check();
  if (JSON_MODE) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`design-system: ${result.findings.length} finding(s), ${result.filesScanned} files scanned${STRICT ? " (strict)" : ""}`);
    for (const f of result.findings.slice(0, 50)) {
      const loc = f.line ? `${f.file}:${f.line}` : f.file;
      console.log(`  ${loc}: ${f.rule}: ${f.message}`);
    }
    if (result.findings.length > 50) console.log(`  ... and ${result.findings.length - 50} more`);
  }
  process.exit(STRICT && !result.ok ? 2 : 0);
}

module.exports = { check };
