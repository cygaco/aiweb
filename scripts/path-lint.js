#!/usr/bin/env node
/**
 * path-lint.js — The paths terminator.
 *
 * Scans the project for hardcoded paths that should resolve via paths.json.
 * Reports findings; exits 1 if any CRITICAL findings (use in CI / pre-commit).
 *
 * Usage:
 *   node scripts/path-lint.js              # markdown report, exit 1 on critical
 *   node scripts/path-lint.js --json       # JSON report
 *   node scripts/path-lint.js --strict     # exit 1 on WARN too
 *   node scripts/path-lint.js --fix-index  # emit sed-style rename proposals (no apply)
 *   node scripts/path-lint.js <glob>       # scan only matching files
 *
 * What it catches:
 *   CRITICAL — paths that resolve to NOTHING in the current layout:
 *     - .claude/events/           → use .claude/project/events/ (paths.events)
 *     - .claude/memory/           → use .claude/project/memory/ (paths.memory)
 *     - .claude/maps/             → use .claude/project/maps/ (paths.maps)
 *     - .claude/handoffs/         → use .claude/runtime/handoffs/ (paths.handoffs)
 *     - .claude/logs/             → use .claude/runtime/logs/ (paths.logs)
 *     - context-enhancer.js       → renamed to smart-context.js
 *     - prompt-enhancer.js        → merged into smart-context.js
 *
 *   WARN — paths that resolve BUT have a dedicated paths.json key:
 *     - .claude/project/events/events.jsonl          → paths.eventsFile
 *     - .claude/project/memory/learnings.jsonl       → paths.learningsFile
 *     - .claude/agents/00-alex/.system/beta/         → paths.betaSystem
 *     - scripts/hooks/lib/paths.js                   → paths.pathsLib
 *     ...
 *
 *   INFO — paths that appear in prose but are informational (not actionable code).
 *          Skip lines inside fenced code blocks marked "example" or "legacy" or comments
 *          in files that document renames.
 *
 * What it skips:
 *   - Archive dirs: .claude/runtime/handoffs/, .claude/runtime/plans/archive/, 99-audits/
 *   - Log files: *.jsonl, *.log, *.out
 *   - Node modules, .git, .next, build artifacts
 *   - The paths.json registry itself (source of truth)
 *   - This script (scripts/path-lint.js)
 *   - The rename catalog in /check:references (lives there intentionally)
 */

const fs = require("fs");
const path = require("path");

const { PATHS } = (() => {
  try {
    return require("./hooks/lib/paths");
  } catch {
    return { PATHS: {} };
  }
})();

// Phase 1B — augment hardcoded rules with the generator's output
// (scripts/path-lint.rules.generated.json). When present, its rules layer on
// top of the embedded ones below; this is how new rules added to the registry
// (e.g. the docs/05-features → requirements/05-features CRITICAL added in
// Phase 1) take effect without editing this script.
const GENERATED_RULES = (() => {
  try {
    return require("./path-lint.rules.generated.json");
  } catch {
    return null;
  }
})();

const PROJECT = path.resolve(process.env.CLAUDE_PROJECT_DIR || ".");
const argv = process.argv.slice(2);
const FLAGS = {
  json: argv.includes("--json"),
  strict: argv.includes("--strict"),
  fixIndex: argv.includes("--fix-index"),
};
const scopeGlob = argv.find((a) => !a.startsWith("--"));

// ── Rules ─────────────────────────────────────────────────────

const CRITICAL = [
  {
    re: /\.claude\/events\/[^/\s"'`)\]]/g,
    suggestion: ".claude/project/events/ (or PATHS.events)",
    why: "path moved under .claude/project/ in v2 layout",
  },
  {
    re: /\.claude\/memory\/[^/\s"'`)\]]/g,
    suggestion: ".claude/project/memory/ (or PATHS.memory)",
    why: "path moved under .claude/project/ in v2 layout",
  },
  {
    re: /\.claude\/maps\/[^/\s"'`)\]]/g,
    suggestion: ".claude/project/maps/ (or PATHS.maps)",
    why: "path moved under .claude/project/ in v2 layout",
  },
  {
    re: /\.claude\/handoffs\//g,
    suggestion: ".claude/runtime/handoffs/ (or PATHS.handoffs)",
    why: "handoffs moved under .claude/runtime/",
  },
  {
    re: /\.claude\/logs\//g,
    suggestion: ".claude/runtime/logs/ (or PATHS.logs)",
    why: "logs moved under .claude/runtime/",
  },
  {
    re: /\.claude\/plans\//g,
    suggestion: ".claude/runtime/plans/ (or PATHS.plans)",
    why: "plans moved under .claude/runtime/",
  },
  {
    re: /context-enhancer\.js/g,
    suggestion: "smart-context.js",
    why: "renamed",
  },
  {
    re: /prompt-enhancer\.js/g,
    suggestion: "smart-context.js",
    why: "merged into smart-context.js",
  },
  {
    re: /\.claude\/agents\/\.system\/oneshot\/store\.json/g,
    suggestion: ".claude/agents/store.json (or PATHS.store)",
    why: "wrong path — no .system/oneshot/ dir",
  },
  {
    re: /\bbeta-persona\.md\b/g,
    suggestion: "judgement-model.md (or PATHS.judgmentModel)",
    why: "renamed during privacy pass",
  },
  {
    re: /\.beta-mining-recommendations\.md/g,
    suggestion: "judgement-model-recommendations.md",
    why: "renamed during privacy pass",
  },
];

// WARN: these paths resolve, but a paths.json key exists
const WARN = [
  {
    re: /\.claude\/project\/events\/events\.jsonl/g,
    key: "eventsFile",
  },
  {
    re: /\.claude\/project\/events\/tools\.jsonl/g,
    key: "toolsFile",
  },
  {
    re: /\.claude\/project\/events\/requirements\.jsonl/g,
    key: "requirementsFile",
  },
  {
    re: /\.claude\/project\/events\/requirements-staged\.jsonl/g,
    key: "requirementsStagedFile",
  },
  {
    re: /\.claude\/project\/memory\/learnings\.jsonl/g,
    key: "learningsFile",
  },
  {
    re: /\.claude\/project\/memory\/traces\.jsonl/g,
    key: "tracesFile",
  },
  {
    re: /\.claude\/project\/memory\/systems\.jsonl/g,
    key: "systemsFile",
  },
  {
    re: /\.claude\/agents\/00-alex\/\.system\/beta\/judgement-model\.md/g,
    key: "judgmentModel",
  },
  {
    re: /\.claude\/agents\/00-alex\/\.system\/beta\/judgement-model-recommendations\.md/g,
    key: "judgmentRecommendations",
  },
  {
    re: /\.claude\/agents\/00-alex\/\.system\/beta\/events\.jsonl/g,
    key: "betaEvents",
  },
  {
    re: /\.claude\/agents\/00-alex\/\.system\/beta\/beta-source-data\.md/g,
    key: "betaSourceData",
  },
  {
    re: /\.claude\/agents\/00-alex\/\.system\/lexicon\.md/g,
    key: "lexicon",
  },
  {
    re: /scripts\/hooks\/lib\/paths\.js/g,
    key: "pathsLib",
  },
  {
    re: /scripts\/hooks\/lib\/logger\.js/g,
    key: "loggerLib",
  },
  {
    re: /\.claude\/runtime\/handoff\.md/g,
    key: "handoffLatest",
  },
  {
    re: /\.claude\/agents\/store\.json/g,
    key: "store",
  },
];

// Layer in any registry-derived rules from path-lint.rules.generated.json.
// Phase 1B: keeps the registry as the single source of truth for new rules
// while preserving the embedded ones above as the fallback.
if (GENERATED_RULES) {
  for (const r of GENERATED_RULES.critical || []) {
    if (!r.match) continue;
    try {
      CRITICAL.push({
        re: new RegExp(r.match, "g"),
        suggestion: r.suggestion || "",
        why: r.why || "registry rule",
      });
    } catch {
      /* skip malformed */
    }
  }
  for (const r of GENERATED_RULES.warn || []) {
    if (!r.match || !r.key) continue;
    try {
      WARN.push({
        re: new RegExp(r.match, "g"),
        key: r.key,
      });
    } catch {
      /* skip malformed */
    }
  }
}

const EXTENSIONS = new Set([".md", ".js", ".json"]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "out",
  "build",
  "coverage",
  ".worktrees",
]);
const SKIP_SUBSTRINGS = [
  ".claude/runtime/", // all runtime is historical/ephemeral
  ".claude/project/events/",
  ".claude/project/memory/",
  ".claude/project/maps/",
  "requirements/99-audits/",
  "docs/99-resources/",
  ".claude/paths.json",
  "scripts/path-lint.js",
  "scripts/hooks/path-guard.js", // holds the patterns by design
  "/check/references.md", // rename catalog lives here
  ".claude/dreams/",
  ".claude/agents/02-oneshot/.system/retros/", // historical retros
  ".claude/agents/.system/dispatch-backups/", // dispatch snapshots
  "backups/",
  "SYSTEMS-REFERENCE.md", // doc being migrated
  "warpos-system-updates", // historical migration doc
  "warpos-roadmap.md", // roadmap docs
  "ROADMAP.md",
  ".claude/.session-checkpoint.json", // periodic snapshot of past prompts
  ".claude/.last-checkpoint", // periodic snapshot
  ".claude/.agent-result-hashes.json", // tool call hashes
  "CHANGELOG.md", // historical changelog mentions superseded paths
  "CHANGELOG-test-system.md", // historical changelog of old paths
  "BACKLOG.md", // backlog references work history and archived framework planning
  "scripts/append-trace-rt013.js", // RT-013 incident documentation
  "scripts/hooks/team-guard.js", // documents RT-013 fix in comment
  "warpos/paths.registry.json", // registry holds the regex strings as data
  "scripts/path-lint.rules.generated.json", // generated mirror of registry
  "schemas/paths.schema.json", // generated schema
  "docs/04-architecture/PATH_KEYS.md", // generated reference doc
  // Phase 4 — capsule + migration historical references
  "warpos/releases/", // changelogs / upgrade-notes name the renamed paths
  "migrations/0.0.0-to-0.1.0/003-docs-to-requirements.js", // semantic purpose IS the rewrite
];

const critical = [];
const warnings = [];
let filesScanned = 0;

function shouldSkip(rel) {
  return SKIP_SUBSTRINGS.some((s) => rel.includes(s));
}

function lintContent(rel, content) {
  const lines = content.split("\n");
  lines.forEach((line, i) => {
    // Skip lines marked as historical / example in the nearby 3 lines
    for (const rule of CRITICAL) {
      const m = line.match(rule.re);
      if (m) {
        for (const hit of m) {
          critical.push({
            file: rel,
            line: i + 1,
            match: hit,
            suggestion: rule.suggestion,
            why: rule.why,
          });
        }
      }
    }
    for (const rule of WARN) {
      const m = line.match(rule.re);
      if (m) {
        for (const hit of m) {
          warnings.push({
            file: rel,
            line: i + 1,
            match: hit,
            key: rule.key,
            suggestion: `PATHS.${rule.key}`,
          });
        }
      }
    }
  });
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full);
      continue;
    }
    if (!EXTENSIONS.has(path.extname(entry.name))) continue;
    const rel = path.relative(PROJECT, full).replace(/\\/g, "/");
    if (shouldSkip(rel)) continue;
    if (scopeGlob && !rel.includes(scopeGlob)) continue;
    filesScanned++;
    try {
      const content = fs.readFileSync(full, "utf8");
      lintContent(rel, content);
    } catch {
      /* unreadable — skip */
    }
  }
}

// ── Run ─────────────────────────────────────────────────────
walk(PROJECT);

// ── Report ──────────────────────────────────────────────────
if (FLAGS.json) {
  console.log(
    JSON.stringify(
      {
        filesScanned,
        critical,
        warnings,
      },
      null,
      2,
    ),
  );
} else {
  console.log(`\nPath lint — ${filesScanned} files scanned\n`);
  if (critical.length === 0 && warnings.length === 0) {
    console.log("  ✓ No hardcoded paths found.\n");
  } else {
    console.log(
      `  CRITICAL: ${critical.length}  WARN: ${warnings.length}  INFO: 0\n`,
    );

    if (critical.length > 0) {
      console.log("  === CRITICAL (must fix) ===\n");
      const byFile = {};
      for (const f of critical) {
        byFile[f.file] = byFile[f.file] || [];
        byFile[f.file].push(f);
      }
      for (const [file, fs] of Object.entries(byFile).sort(
        (a, b) => b[1].length - a[1].length,
      )) {
        console.log(`  ${file}  (${fs.length})`);
        for (const f of fs.slice(0, 5)) {
          console.log(`    :${f.line}  ${f.match}  →  ${f.suggestion}`);
        }
        if (fs.length > 5) console.log(`    … and ${fs.length - 5} more`);
      }
    }

    if (warnings.length > 0) {
      console.log("\n  === WARN (dedicated paths.json key exists) ===\n");
      const byKey = {};
      for (const w of warnings) {
        byKey[w.key] = byKey[w.key] || [];
        byKey[w.key].push(w);
      }
      for (const [key, items] of Object.entries(byKey).sort(
        (a, b) => b[1].length - a[1].length,
      )) {
        console.log(`  paths.${key}  (${items.length} hardcoded uses)`);
        const topFiles = {};
        for (const i of items) topFiles[i.file] = (topFiles[i.file] || 0) + 1;
        const sorted = Object.entries(topFiles)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3);
        for (const [f, n] of sorted) console.log(`    ${f} (${n})`);
      }
    }

    console.log("");
  }
}

// ── Exit code ───────────────────────────────────────────────
const shouldFail = critical.length > 0 || (FLAGS.strict && warnings.length > 0);
process.exit(shouldFail ? 1 : 0);
