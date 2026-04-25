#!/usr/bin/env node

/**
 * ref-checker.js — Cross-file reference integrity validator
 *
 * Crawls .claude/ and docs/ to find every file path reference,
 * then validates each one resolves to a real file on disk.
 *
 * Reports:
 *   - Broken refs: file A references file B, but B doesn't exist
 *   - Orphaned files: files nothing references (potential dead weight)
 *   - Stale SPEC_GRAPH edges: edges pointing to nonexistent files
 *
 * Invocation:
 *   node scripts/hooks/ref-checker.js              # full scan, JSON output
 *   node scripts/hooks/ref-checker.js --summary    # human-readable summary
 *   node scripts/hooks/ref-checker.js --fix        # remove broken STALE banners
 *
 * Integrates with centralized logger (events.jsonl) for audit trail.
 */

const fs = require("fs");
const path = require("path");
const { PROJECT, relPath } = require("./lib/paths");
const { log: centralLog } = require("./lib/logger");

// ── Config ──────────────────────────────────────────────

const SCAN_DIRS = [
  path.join(PROJECT, ".claude"),
  path.join(PROJECT, "docs"),
  path.join(PROJECT, "scripts", "hooks"),
];

const SCAN_EXTENSIONS = new Set([
  ".md",
  ".js",
  ".json",
  ".jsonl",
  ".ts",
  ".tsx",
]);

// Files/dirs to skip
const SKIP_PATTERNS = [
  /node_modules/,
  /\.git[/\\]/,
  /\.obsidian/,
  /\.next/,
  /dist[/\\]/,
];

// ── Reference extraction patterns ───────────────────────

// Markdown links: [text](path) or [text](path "title")
const MD_LINK = /\[([^\]]*)\]\(([^)\s"]+)(?:\s+"[^"]*")?\)/g;

// Markdown reference-style images/links: ![alt][ref] or [text][ref]
// (skip these — they resolve to definitions, not files)

// Require/import in JS: require("./path") or require("../path")
const JS_REQUIRE = /require\(["'](\.[^"']+)["']\)/g;

// Import statements: import ... from "./path"
const JS_IMPORT = /from\s+["'](\.[^"']+)["']/g;

// JSONL/JSON file path references: "file":"path" or "path":"..."
const JSON_PATH =
  /"(?:file|path|from|to|scan_dir)":\s*"([^"]+\.(?:md|js|json|jsonl|ts|tsx))"/g;

// Bare file paths in markdown (e.g., `.claude/project/maps/skills.jsonl`)
const BARE_PATH =
  /(?:^|\s|`)((?:\.claude|docs|scripts|src)[/\\][a-zA-Z0-9_./-]+\.[a-z]+)/gm;

// YAML frontmatter references (tools, depends-on, etc.)
const YAML_REF = /^(?:tools|depends-on|source|implemented_by):\s*(.+)$/gm;

// STALE banner: <!-- STALE: path changed at ... -->
const STALE_BANNER = /<!--\s*STALE:\s*([^\s]+)\s+changed\s+at/g;

// ── File discovery ──────────────────────────────────────

function walkDir(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = relPath(full);
    if (SKIP_PATTERNS.some((p) => p.test(rel))) continue;
    if (entry.isDirectory()) {
      walkDir(full, fileList);
    } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      fileList.push(full);
    }
  }
  return fileList;
}

// ── Reference extraction ────────────────────────────────

function extractRefs(filePath, content) {
  const refs = [];
  const ext = path.extname(filePath);
  const rel = relPath(filePath);

  // Markdown links
  if (ext === ".md") {
    let m;
    while ((m = MD_LINK.exec(content)) !== null) {
      const target = m[2];
      // Skip URLs, anchors, mailto
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      refs.push({ from: rel, to: target, type: "md-link" });
    }
    // Reset lastIndex for reuse
    MD_LINK.lastIndex = 0;

    // STALE banners
    while ((m = STALE_BANNER.exec(content)) !== null) {
      refs.push({ from: rel, to: m[1], type: "stale-banner" });
    }
    STALE_BANNER.lastIndex = 0;
  }

  // JS require/import
  if (ext === ".js" || ext === ".ts" || ext === ".tsx") {
    let m;
    while ((m = JS_REQUIRE.exec(content)) !== null) {
      refs.push({ from: rel, to: m[1], type: "require" });
    }
    JS_REQUIRE.lastIndex = 0;
    while ((m = JS_IMPORT.exec(content)) !== null) {
      refs.push({ from: rel, to: m[1], type: "import" });
    }
    JS_IMPORT.lastIndex = 0;
  }

  // JSON/JSONL path refs
  if (ext === ".json" || ext === ".jsonl") {
    let m;
    while ((m = JSON_PATH.exec(content)) !== null) {
      refs.push({ from: rel, to: m[1], type: "json-path" });
    }
    JSON_PATH.lastIndex = 0;
  }

  // Bare file paths in any file
  let m;
  while ((m = BARE_PATH.exec(content)) !== null) {
    const target = m[1].replace(/\\/g, "/");
    // Avoid self-refs and duplicates with md-link
    if (target !== rel) {
      refs.push({ from: rel, to: target, type: "bare-path" });
    }
  }
  BARE_PATH.lastIndex = 0;

  return refs;
}

// ── Reference resolution ────────────────────────────────

function resolveRef(ref, sourceFile) {
  const target = ref.to.replace(/\\/g, "/");

  // Absolute project path (starts with .claude/, docs/, scripts/, src/)
  if (/^(\.claude|docs|scripts|src)\//.test(target)) {
    const abs = path.join(PROJECT, target);
    return fs.existsSync(abs)
      ? null
      : { ...ref, resolved: target, status: "broken" };
  }

  // Relative path (starts with ./ or ../)
  if (target.startsWith("./") || target.startsWith("../")) {
    const sourceDir = path.dirname(path.join(PROJECT, ref.from));
    const abs = path.resolve(sourceDir, target);
    // Try with common extensions for JS requires
    const candidates = [
      abs,
      abs + ".js",
      abs + ".ts",
      abs + ".tsx",
      abs + ".json",
    ];
    // Also try /index.js for directory requires
    candidates.push(path.join(abs, "index.js"), path.join(abs, "index.ts"));
    const found = candidates.some((c) => fs.existsSync(c));
    if (found) return null;
    return { ...ref, resolved: relPath(abs), status: "broken" };
  }

  // Bare filename (e.g., "memory.jsonl" in same dir) — skip, too ambiguous
  return null;
}

// ── Orphan detection ────────────────────────────────────

function findOrphans(allFiles, allRefs) {
  // Build set of all referenced paths (normalized)
  const referenced = new Set();
  for (const ref of allRefs) {
    const target = ref.to.replace(/\\/g, "/");
    // Normalize to project-relative
    if (/^(\.claude|docs|scripts|src)\//.test(target)) {
      referenced.add(target);
    } else if (target.startsWith("./") || target.startsWith("../")) {
      const sourceDir = path.dirname(ref.from);
      const resolved = path.posix.normalize(path.posix.join(sourceDir, target));
      referenced.add(resolved);
    }
  }

  // Find files that nothing references
  const orphans = [];
  for (const file of allFiles) {
    const rel = relPath(file);
    // Skip root-level files (CLAUDE.md, PROJECT.md) — they're entry points
    if (!rel.includes("/")) continue;
    // Skip index files, package.json, etc.
    if (/\/(index|package)\.(js|ts|json)$/.test(rel)) continue;
    // Skip event logs (append-only, not referenced by path)
    if (/events\.jsonl$/.test(rel)) continue;
    // Skip internal state files
    if (/\.(lock|session-|\.store-)/.test(rel)) continue;
    // Skip retro files (historical records)
    if (/retros\/\d+\//.test(rel)) continue;

    if (!referenced.has(rel)) {
      orphans.push(rel);
    }
  }

  return orphans;
}

// ── SPEC_GRAPH validation ───────────────────────────────

function validateSpecGraph() {
  const graphPath = path.join(
    PROJECT,
    "docs",
    "00-canonical",
    "SPEC_GRAPH.json",
  );
  if (!fs.existsSync(graphPath)) return [];

  const graph = JSON.parse(fs.readFileSync(graphPath, "utf-8"));
  const issues = [];

  // Check explicit edges
  if (graph.edges && graph.edges.explicit) {
    for (const edge of graph.edges.explicit) {
      const fromPath = path.join(PROJECT, edge.from);
      if (!edge.from.includes("*") && !fs.existsSync(fromPath)) {
        issues.push({
          type: "spec-graph-broken",
          edge: "from",
          path: edge.from,
          context: edge.comment || "",
        });
      }
      for (const to of edge.to || []) {
        const toPath = path.join(PROJECT, to);
        if (!to.includes("*") && !fs.existsSync(toPath)) {
          issues.push({
            type: "spec-graph-broken",
            edge: "to",
            path: to,
            context: edge.comment || "",
          });
        }
      }
    }
  }

  return issues;
}

// ── Main ────────────────────────────────────────────────

function run() {
  const args = process.argv.slice(2);
  const summaryMode = args.includes("--summary");
  const fixMode = args.includes("--fix");

  // 1. Discover all files
  const allFiles = [];
  for (const dir of SCAN_DIRS) {
    walkDir(dir, allFiles);
  }

  // 2. Extract all references
  const allRefs = [];
  for (const file of allFiles) {
    try {
      const content = fs.readFileSync(file, "utf-8");
      const refs = extractRefs(file, content);
      allRefs.push(...refs);
    } catch (e) {
      // Skip unreadable files
    }
  }

  // 3. Validate references
  const broken = [];
  for (const ref of allRefs) {
    const result = resolveRef(ref, ref.from);
    if (result) broken.push(result);
  }

  // Deduplicate broken refs (same from→to pair)
  const seen = new Set();
  const uniqueBroken = broken.filter((b) => {
    const key = `${b.from}→${b.resolved || b.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 4. Find orphans
  const orphans = findOrphans(allFiles, allRefs);

  // 5. Validate SPEC_GRAPH
  const graphIssues = validateSpecGraph();

  // 6. Build report
  const report = {
    ts: new Date().toISOString(),
    files_scanned: allFiles.length,
    refs_found: allRefs.length,
    broken_refs: uniqueBroken,
    orphaned_files: orphans,
    spec_graph_issues: graphIssues,
    summary: {
      broken: uniqueBroken.length,
      orphans: orphans.length,
      graph_issues: graphIssues.length,
      health:
        uniqueBroken.length === 0 && graphIssues.length === 0
          ? "clean"
          : "issues",
    },
  };

  // 7. Log to events
  centralLog("audit", {
    action: "ref-check",
    files_scanned: allFiles.length,
    refs_found: allRefs.length,
    broken: uniqueBroken.length,
    orphans: orphans.length,
    graph_issues: graphIssues.length,
  });

  // 8. Output
  if (summaryMode) {
    console.log(`\n=== Reference Integrity Report ===`);
    console.log(`Files scanned: ${allFiles.length}`);
    console.log(`References found: ${allRefs.length}`);
    console.log(`Broken references: ${uniqueBroken.length}`);
    console.log(`Orphaned files: ${orphans.length}`);
    console.log(`SPEC_GRAPH issues: ${graphIssues.length}`);

    if (uniqueBroken.length > 0) {
      console.log(`\n--- Broken References ---`);
      for (const b of uniqueBroken) {
        console.log(`  ${b.from} → ${b.resolved || b.to} (${b.type})`);
      }
    }

    if (graphIssues.length > 0) {
      console.log(`\n--- SPEC_GRAPH Issues ---`);
      for (const g of graphIssues) {
        console.log(
          `  ${g.edge}: ${g.path} ${g.context ? `(${g.context})` : ""}`,
        );
      }
    }

    if (orphans.length > 0) {
      console.log(`\n--- Orphaned Files (${orphans.length}) ---`);
      // Group by directory
      const byDir = {};
      for (const o of orphans) {
        const dir = path.dirname(o);
        (byDir[dir] = byDir[dir] || []).push(path.basename(o));
      }
      for (const [dir, files] of Object.entries(byDir).sort()) {
        console.log(`  ${dir}/`);
        for (const f of files) {
          console.log(`    ${f}`);
        }
      }
    }

    if (report.summary.health === "clean") {
      console.log(`\n✓ All references valid.`);
    }
  } else {
    // JSON output for programmatic use
    console.log(JSON.stringify(report, null, 2));
  }

  // Exit code: 0 if clean, 1 if issues
  process.exit(uniqueBroken.length + graphIssues.length > 0 ? 1 : 0);
}

run();
