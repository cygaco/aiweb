#!/usr/bin/env node

/**
 * scripts/paths/gate.js — path coherence gate.
 *
 * Phase 2A per BACKLOG §2. The single "is path identity coherent?" check
 * wired into framework-manifest-guard, merge-guard, /check:references,
 * /preflight:run, /warp:release, and CI.
 *
 * Runs (in order, fail-fast):
 *   1. Registry schema validates (warpos/paths.registry.json $schema + shape).
 *   2. Generated artifacts are current (delegate to `build.js --check`).
 *   3. No framework-owned file uses unregistered literal paths
 *      (delegate to scripts/path-lint.js — CRITICAL=0 unless --strict adds WARN).
 *   4. No deprecated alias appears outside marked migrations (allow markers).
 *   5. Every `paths.X` token in docs/agents/skills resolves to a registry key.
 *
 * Exit code: 0 = green, 1 = at least one check failed.
 *
 * Usage:
 *   node scripts/paths/gate.js                    # full gate
 *   node scripts/paths/gate.js --json             # machine-readable report
 *   node scripts/paths/gate.js --strict           # also fail on path-lint WARN
 *   node scripts/paths/gate.js --check <name>     # run a single check
 *
 * Wiring (read by callers, not the script itself):
 *   - PreToolUse Bash hook framework-manifest-guard delegates here
 *   - merge-guard PostToolUse logs gate failure
 *   - /check:references prepends the gate
 *   - /preflight:run includes the gate as Pass 7.10
 *   - /warp:release blocks publish on failure
 *   - .github/workflows/test.yml runs in CI
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const REGISTRY_FILE = path.join(ROOT, "warpos", "paths.registry.json");
const argv = process.argv.slice(2);
const FLAGS = {
  json: argv.includes("--json"),
  strict: argv.includes("--strict"),
  check: (() => {
    const i = argv.indexOf("--check");
    if (i === -1) return null;
    return argv[i + 1] || null;
  })(),
};

function readRegistry() {
  const raw = fs.readFileSync(REGISTRY_FILE, "utf8");
  return JSON.parse(raw);
}

function checkRegistrySchema() {
  const findings = [];
  let registry;
  try {
    registry = readRegistry();
  } catch (e) {
    return [
      {
        severity: "error",
        area: "registry",
        message: `cannot read registry: ${e.message}`,
      },
    ];
  }
  if (registry.$schema !== "warpos/paths-registry/v1") {
    findings.push({
      severity: "error",
      area: "registry",
      message: `registry $schema must be "warpos/paths-registry/v1", got ${JSON.stringify(registry.$schema)}`,
    });
  }
  if (typeof registry.version !== "number") {
    findings.push({
      severity: "error",
      area: "registry",
      message: `registry.version must be a number, got ${typeof registry.version}`,
    });
  }
  if (!registry.paths || typeof registry.paths !== "object") {
    findings.push({
      severity: "error",
      area: "registry",
      message: `registry.paths must be an object`,
    });
    return findings;
  }
  const ids = new Set();
  for (const [key, entry] of Object.entries(registry.paths)) {
    if (typeof entry.path !== "string") {
      findings.push({
        severity: "error",
        area: "registry",
        message: `paths.${key}: path must be a string`,
      });
    }
    if (!entry.kind) {
      findings.push({
        severity: "error",
        area: "registry",
        message: `paths.${key}: missing kind`,
      });
    }
    if (!entry.owner) {
      findings.push({
        severity: "error",
        area: "registry",
        message: `paths.${key}: missing owner`,
      });
    }
    if (!entry.introducedIn) {
      findings.push({
        severity: "error",
        area: "registry",
        message: `paths.${key}: missing introducedIn`,
      });
    }
    if (ids.has(key)) {
      findings.push({
        severity: "error",
        area: "registry",
        message: `paths.${key}: duplicate key`,
      });
    }
    ids.add(key);
  }
  return findings;
}

function checkArtifactsCurrent() {
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts", "paths", "build.js"), "--check"],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (result.status === 0) return [];
  const stderr = (result.stderr || "").trim();
  const stdout = (result.stdout || "").trim();
  return [
    {
      severity: "error",
      area: "artifacts",
      message:
        "generated path artifacts are stale. Run: node scripts/paths/build.js" +
        (stderr
          ? `\n  stderr: ${stderr.split("\n").slice(0, 4).join(" | ")}`
          : "") +
        (stdout
          ? `\n  stdout: ${stdout.split("\n").slice(-6).join(" | ")}`
          : ""),
    },
  ];
}

function checkPathLint() {
  const args = [path.join(ROOT, "scripts", "path-lint.js"), "--json"];
  if (FLAGS.strict) args.push("--strict");
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  let report = null;
  try {
    report = JSON.parse(result.stdout || "{}");
  } catch {
    return [
      {
        severity: "error",
        area: "path-lint",
        message: `path-lint.js returned non-JSON output (exit ${result.status})`,
      },
    ];
  }
  const findings = [];
  for (const f of report.critical || []) {
    findings.push({
      severity: "error",
      area: "path-lint",
      file: f.file,
      line: f.line,
      message: `${f.match} → ${f.suggestion} (${f.why})`,
    });
  }
  if (FLAGS.strict) {
    for (const w of report.warnings || []) {
      findings.push({
        severity: "warn-strict",
        area: "path-lint",
        file: w.file,
        line: w.line,
        message: `${w.match} → use PATHS.${w.key}`,
      });
    }
  }
  return findings;
}

// Hyphens in <reason> are allowed: the markdown comment terminator `-->` is
// matched explicitly via lookahead so reasons like "migrating-to-v2" work.
const ALLOW_MARKER_RE =
  /(?:<!--\s*path-literal-allowed:(?:(?!-->).)*-->|\/\/\s*path-literal-allowed:[^\n]*)/;

function walk(dir, accept) {
  const acc = [];
  const SKIP = new Set([
    "node_modules",
    ".git",
    ".next",
    "out",
    "build",
    "coverage",
    ".worktrees",
  ]);
  (function rec(d) {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (SKIP.has(e.name)) continue;
        rec(full);
      } else if (accept(full)) {
        acc.push(full);
      }
    }
  })(dir);
  return acc;
}

function checkDeprecatedAliases() {
  let registry;
  try {
    registry = readRegistry();
  } catch {
    return [];
  }
  if (!registry || !registry.paths) return [];
  const deprecated = [];
  for (const [key, entry] of Object.entries(registry.paths)) {
    for (const a of entry.deprecatedAliases || []) {
      deprecated.push({ alias: a, key });
    }
    if (entry.removedIn) {
      deprecated.push({
        alias: entry.path,
        key: `${key} (removedIn ${entry.removedIn})`,
      });
    }
  }
  if (deprecated.length === 0) return [];
  const SKIP_SUBSTRINGS = [
    "scripts/paths/gate.js",
    "scripts/path-lint.js",
    "scripts/hooks/path-guard.js",
    "warpos/paths.registry.json",
    "scripts/path-lint.rules.generated.json",
    "schemas/paths.schema.json",
    "docs/04-architecture/PATH_KEYS.md",
    ".claude/runtime/",
    ".claude/project/events/",
    ".claude/project/memory/",
    ".claude/project/maps/",
    ".claude/agents/.system/dispatch-backups/",
    ".claude/agents/02-oneshot/.system/retros/",
    "requirements/99-audits/",
    "docs/99-resources/",
    "BACKLOG.md",
    "CHANGELOG.md",
    "CHANGELOG-test-system.md",
    "backups/",
    "scripts/warpos/codemod-docs-to-requirements.js",
    // Phase 4B migration: this script's semantic purpose IS to rewrite the
    // legacy path; the literal is data, not navigation.
    "migrations/0.0.0-to-0.1.0/003-docs-to-requirements.js",
  ];
  const accept = (f) => {
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    if (SKIP_SUBSTRINGS.some((s) => rel.includes(s))) return false;
    return /\.(md|js|json)$/.test(f);
  };
  const findings = [];
  const files = walk(ROOT, accept);
  for (const file of files) {
    let body;
    try {
      body = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const lines = body.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const { alias, key } of deprecated) {
        if (!line.includes(alias)) continue;
        if (ALLOW_MARKER_RE.test(line)) continue;
        const ctxStart = Math.max(0, i - 1);
        const ctxEnd = Math.min(lines.length, i + 2);
        const ctx = lines.slice(ctxStart, ctxEnd).join("\n");
        if (ALLOW_MARKER_RE.test(ctx)) continue;
        findings.push({
          severity: "error",
          area: "deprecated-alias",
          file: path.relative(ROOT, file).replace(/\\/g, "/"),
          line: i + 1,
          message: `deprecated alias ${JSON.stringify(alias)} (replaced by paths.${key}) — add path-literal-allowed marker if intentional`,
        });
      }
    }
  }
  return findings;
}

function checkDocsTokens() {
  let registry;
  try {
    registry = readRegistry();
  } catch {
    return [];
  }
  if (!registry || !registry.paths) return [];
  const validKeys = new Set(
    Object.entries(registry.paths)
      .filter(([, e]) => !e.removedIn)
      .map(([k]) => k),
  );

  const SKIP_SUBSTRINGS = [
    ".claude/runtime/",
    ".claude/project/events/",
    ".claude/project/memory/",
    ".claude/project/maps/",
    ".claude/agents/.system/dispatch-backups/",
    ".claude/agents/02-oneshot/.system/retros/",
    "node_modules/",
    ".git/",
    ".next/",
    "warpos/paths.registry.json",
    "scripts/paths/gate.js",
    "docs/04-architecture/PATH_KEYS.md",
    "scripts/path-lint.js",
    "scripts/hooks/lib/paths.js",
    "scripts/hooks/lib/paths.generated.js",
    "schemas/paths.schema.json",
    "scripts/path-lint.rules.generated.json",
    "scripts/paths/build.js",
    "requirements/99-audits/",
    "docs/99-resources/",
    "BACKLOG.md",
    "CHANGELOG.md",
    "CHANGELOG-test-system.md",
    ".claude/runtime/plans/",
  ];
  const accept = (f) => {
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    if (SKIP_SUBSTRINGS.some((s) => rel.includes(s))) return false;
    return /\.md$/.test(f);
  };

  // Match `paths.foo` or `paths.fooBar` (camelCase). Allow trailing punctuation.
  // The regex requires a leading word boundary or backtick to avoid matching
  // file paths like `tests/paths.test.js` or property accesses on local objs.
  const TOKEN_RE = /(?<![A-Za-z0-9_./])paths\.([a-zA-Z][a-zA-Z0-9]*)/g;

  const findings = [];
  const files = walk(ROOT, accept);
  // Tokens that are property accesses on local variables, not registry refs
  const FALSE_POSITIVES = new Set([
    "json", // "paths.json" file name
    "js", // "paths.js" file name
    "registry", // "paths.registry.json"
    "generated", // "paths.generated.js"
    "X", // documentation placeholder for "paths.X"
    "schema",
    "specs", // .claude/manifest.json projectPaths.specs (different namespace)
    "Y", // generic placeholder
  ]);
  for (const file of files) {
    let body;
    try {
      body = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const lines = body.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;
      TOKEN_RE.lastIndex = 0;
      while ((m = TOKEN_RE.exec(line)) !== null) {
        const key = m[1];
        if (FALSE_POSITIVES.has(key)) continue;
        if (validKeys.has(key)) continue;
        // Skip if line is in a comment marking it explanatory
        if (
          /\b(example|legacy|deprecated|removed|placeholder|template)\b/i.test(
            line,
          )
        ) {
          continue;
        }
        findings.push({
          severity: "error",
          area: "docs-tokens",
          file: path.relative(ROOT, file).replace(/\\/g, "/"),
          line: i + 1,
          message: `paths.${key} token not in registry — add the key or fix the typo`,
        });
      }
    }
  }
  return findings;
}

const CHECKS = [
  { name: "registry", run: checkRegistrySchema },
  { name: "artifacts", run: checkArtifactsCurrent },
  { name: "path-lint", run: checkPathLint },
  { name: "deprecated", run: checkDeprecatedAliases },
  { name: "docs-tokens", run: checkDocsTokens },
];

function main() {
  const selected = FLAGS.check
    ? CHECKS.filter((c) => c.name === FLAGS.check)
    : CHECKS;
  if (selected.length === 0) {
    console.error(`unknown --check name: ${FLAGS.check}`);
    console.error(`available: ${CHECKS.map((c) => c.name).join(", ")}`);
    process.exit(1);
  }

  const allFindings = [];
  for (const c of selected) {
    let f;
    try {
      f = c.run() || [];
    } catch (e) {
      f = [
        {
          severity: "error",
          area: c.name,
          message: `gate check ${c.name} threw: ${e.message}`,
        },
      ];
    }
    for (const item of f) item.check = c.name;
    allFindings.push(...f);
  }

  const errors = allFindings.filter((f) => f.severity === "error");
  const warnStrict = allFindings.filter((f) => f.severity === "warn-strict");
  const failed = errors.length > 0 || (FLAGS.strict && warnStrict.length > 0);

  if (FLAGS.json) {
    console.log(
      JSON.stringify(
        {
          ok: !failed,
          checks: selected.map((c) => c.name),
          counts: { errors: errors.length, warnStrict: warnStrict.length },
          findings: allFindings,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`\nscripts/paths/gate.js — ${selected.length} check(s)`);
    for (const c of selected) {
      const f = allFindings.filter((x) => x.check === c.name);
      const errs = f.filter((x) => x.severity === "error").length;
      const ws = f.filter((x) => x.severity === "warn-strict").length;
      const status =
        errs === 0 && (!FLAGS.strict || ws === 0) ? "ok   " : "FAIL ";
      console.log(
        `  ${status} ${c.name.padEnd(14)} (errors=${errs}, warn-strict=${ws})`,
      );
    }
    if (failed) {
      console.log("\n  details:");
      for (const f of allFindings) {
        if (
          f.severity === "error" ||
          (FLAGS.strict && f.severity === "warn-strict")
        ) {
          const loc = f.file ? ` ${f.file}${f.line ? `:${f.line}` : ""}` : "";
          console.log(`    [${f.area}]${loc}  ${f.message}`);
        }
      }
    }
    console.log("");
  }

  process.exit(failed ? 1 : 0);
}

main();
