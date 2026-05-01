#!/usr/bin/env node
/**
 * PROMOTION_TRIGGER:
 *   action: flip from warn-only to hard-block (remove STRICT env gate, always block)
 *   criteria:
 *     - 5+ audit warnings from this guard in the last 7 days with no corresponding fix commit
 *     - OR: manually flipped via PATH_GUARD_STRICT=1 after deliberation
 *   metric_query:
 *     actor: "path-guard"
 *     action: ["path-guard-warn", "path-stale-reference"]   // audit-event action names this guard would emit (guard currently only writes to stderr — emit via logger to activate this trigger)
 *   next_review: 2026-05-18
 *   notes: guard currently stderr-only; wire lib/logger.js emissions before the checker can score it
 */

/**
 * path-guard.js — PreToolUse hook for Edit|Write.
 *
 * Two enforcement tiers (Phase 2B):
 *
 *   1. FRAMEWORK-OWNED writes (under scripts/hooks/, .claude/agents/,
 *      .claude/commands/, scripts/paths/, scripts/generate-*.js,
 *      .claude/project/reference/) → fail-closed by default. Without an
 *      allow marker, the write is blocked.
 *
 *   2. PROJECT-OWNED writes (everything else outside the allow-list of
 *      archives/runtime/etc.) → warn-only on stderr. Set PATH_GUARD_STRICT=1
 *      to block these too.
 *
 * Allow markers (suppress block + warn for that file):
 *   Markdown:  <!-- path-literal-allowed: <reason> -->
 *   Code:      // path-literal-allowed: <reason>
 *
 * Patterns flagged in newly-written content:
 *   - Absolute paths starting with `.claude/events/` (without /project/)
 *   - Absolute paths starting with `.claude/memory/` (without /project/)
 *   - Absolute paths starting with `.claude/maps/` (without /project/)
 *   - Absolute paths starting with `.claude/handoffs/` (legacy; should be runtime/handoffs)
 *   - Absolute paths starting with `.claude/logs/` (legacy; should be runtime/logs)
 *   - Raw `context-enhancer.js` / `prompt-enhancer.js` (renamed to smart-context.js)
 *   - Hardcoded paths that have a dedicated key in paths.json
 *
 * Skips:
 *   - Markdown files in `.claude/runtime/handoffs/` (historical handoffs)
 *   - Markdown files under `docs/99-resources/` or `requirements/99-audits/` (archives)
 *   - Any line containing "STALE" or "deprecated" marker
 *   - Lines inside fenced code blocks that are clearly examples (comment `// STALE example`)
 *
 * Only runs on Edit|Write to `.md` and `.js` files.
 */

const fs = require("fs");
const path = require("path");

const { PROJECT, PATHS, relPath } = require("./lib/paths");

const STRICT = process.env.PATH_GUARD_STRICT === "1";

// Phase 2B: framework-owned prefixes. Writes under these paths fail-closed by
// default — the file must contain a path-literal-allowed marker to bypass.
const FRAMEWORK_OWNED_PREFIXES = [
  "scripts/hooks/",
  "scripts/paths/",
  ".claude/agents/",
  ".claude/commands/",
  ".claude/project/reference/",
];
const FRAMEWORK_OWNED_FILE_RES = [/^scripts\/generate-[a-z0-9-]+\.js$/];

const STALE_PATTERNS = [
  {
    re: /\.claude\/events\/[^/\s]/,
    why: "use `.claude/project/events/` (or `PATHS.events`)",
  },
  {
    re: /\.claude\/memory\/[^/\s]/,
    why: "use `.claude/project/memory/` (or `PATHS.memory`)",
  },
  {
    re: /\.claude\/maps\/[^/\s]/,
    why: "use `.claude/project/maps/` (or `PATHS.maps`)",
  },
  {
    re: /\.claude\/handoffs\//,
    why: "use `.claude/runtime/handoffs/` (or `PATHS.handoffs`)",
  },
  {
    re: /\.claude\/logs\//,
    why: "use `.claude/runtime/logs/` (or `PATHS.logs`)",
  },
  {
    re: /context-enhancer\.js/,
    why: "renamed to `smart-context.js`",
  },
  {
    re: /prompt-enhancer\.js/,
    why: "merged into `smart-context.js`",
  },
  {
    re: /\.claude\/agents\/.system\/oneshot\/store\.json/,
    why: "use `.claude/agents/store.json` (or `PATHS.store`)",
  },
];

// Files where stale refs are expected (archives, rename catalogs, historical)
const ALLOW_LIST_SUBSTRINGS = [
  ".claude/runtime/handoffs/",
  ".claude/runtime/plans/archive/",
  ".claude/project/events/",
  ".claude/project/memory/",
  ".claude/agents/.system/dispatch-backups/",
  ".claude/agents/02-oneshot/.system/retros/",
  "requirements/99-audits/",
  "docs/99-resources/",
  "/check/references.md", // the rename catalog lives here intentionally
  "/path-guard.js", // this file
  "/scripts/paths/gate.js", // gate documents the patterns
  "/scripts/path-lint.js", // path-lint documents the patterns
  "/warpos/paths.registry.json", // registry holds the regex strings as data
];

// Phase 2B: per-line allow markers only.
//
// Marker must be on the SAME LINE as the violation OR within the 2 lines
// immediately above it. There is intentionally no whole-file bypass — that
// would let a single marker disarm the guard across an entire write.
//
// Hyphens in `<reason>` are allowed: the markdown comment terminator `-->` is
// matched explicitly via lookahead so reasons like "migrating-to-v2" work.
const ALLOW_MARKER_RE =
  /(?:<!--\s*path-literal-allowed:(?:(?!-->).)*-->|\/\/\s*path-literal-allowed:[^\n]*)/;

function isFrameworkOwned(rel) {
  for (const prefix of FRAMEWORK_OWNED_PREFIXES) {
    if (rel.startsWith(prefix)) return true;
  }
  for (const re of FRAMEWORK_OWNED_FILE_RES) {
    if (re.test(rel)) return true;
  }
  return false;
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const toolName = event.tool_name || "";
    if (toolName !== "Edit" && toolName !== "Write") {
      process.exit(0);
    }

    const filePath = (event.tool_input || {}).file_path || "";
    if (!filePath) process.exit(0);

    const ext = path.extname(filePath).toLowerCase();
    if (ext !== ".md" && ext !== ".js") process.exit(0);

    const rel = relPath(filePath);
    // Anchored prefix match: substring containment let crafted paths like
    // ".../docs/99-resources/.../scripts/hooks/foo.js" bypass framework-owned
    // enforcement. Each entry now matches as a top-level prefix.
    for (const allow of ALLOW_LIST_SUBSTRINGS) {
      const norm = allow.startsWith("/") ? allow.slice(1) : allow;
      if (rel === norm || rel.startsWith(norm)) process.exit(0);
    }

    // Determine what's being written
    const body =
      (event.tool_input || {}).content ||
      (event.tool_input || {}).new_string ||
      "";
    if (!body || body.length === 0) process.exit(0);

    // Phase 2B: for Edit calls the new_string is a snippet, not the whole
    // file — the existing surrounding allow-marker may not appear in the
    // snippet. Read the on-disk file and merge it as context for marker
    // detection only (we still flag findings against the new content).
    let contextBody = body;
    if (toolName === "Edit") {
      try {
        const onDisk = fs.readFileSync(filePath, "utf8");
        contextBody = onDisk + "\n" + body;
      } catch {
        /* file may not exist yet — skip context augmentation */
      }
    }

    const findings = [];
    const bodyLines = body.split("\n");
    const ctxLines = contextBody.split("\n");
    const ctxOffset = ctxLines.length - bodyLines.length;
    for (let i = 0; i < bodyLines.length; i++) {
      const line = bodyLines[i];
      // Per-line marker suppresses this line + the 2 immediately above it.
      if (ALLOW_MARKER_RE.test(line)) continue;
      const cIdx = ctxOffset + i;
      const prev1 = cIdx > 0 ? ctxLines[cIdx - 1] : "";
      const prev2 = cIdx > 1 ? ctxLines[cIdx - 2] : "";
      if (ALLOW_MARKER_RE.test(prev1) || ALLOW_MARKER_RE.test(prev2)) continue;
      for (const { re, why } of STALE_PATTERNS) {
        const m = line.match(re);
        if (m) {
          findings.push({ line: i + 1, match: m[0], why });
        }
      }
    }

    if (findings.length === 0) process.exit(0);

    const frameworkOwned = isFrameworkOwned(rel);

    // Build a single message
    const lines2 = [
      `\x1b[33m[path-guard] Stale path references in ${rel}:\x1b[0m`,
    ];
    for (const f of findings) {
      lines2.push(`  - line ${f.line}: \`${f.match}\` — ${f.why}`);
    }
    if (frameworkOwned) {
      lines2.push(
        "\x1b[31m  framework-owned file — write blocked. Add a `// path-literal-allowed: <reason>` marker if intentional.\x1b[0m",
      );
    } else {
      lines2.push(
        "\x1b[33m  project-owned file — warning only. Set PATH_GUARD_STRICT=1 to block.\x1b[0m",
      );
    }

    process.stderr.write(lines2.join("\n") + "\n");

    // Block conditions:
    //   - framework-owned file with findings → always block
    //   - project-owned file with findings → block only if STRICT=1
    if (frameworkOwned || STRICT) {
      console.log(
        JSON.stringify({
          decision: "block",
          reason: `path-guard: ${findings.length} stale path reference(s) in ${frameworkOwned ? "framework-owned" : "project"} file — see stderr`,
        }),
      );
    }

    process.exit(0);
  } catch {
    process.exit(0);
  }
});
