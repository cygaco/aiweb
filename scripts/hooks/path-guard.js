#!/usr/bin/env node
/**
 * path-guard.js — PreToolUse hook for Edit|Write.
 *
 * Flags hardcoded path references that should use `paths.json` instead.
 * Non-blocking by default (warns on stderr). Set PATH_GUARD_STRICT=1 to block.
 *
 * What it catches in newly-written content:
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
  "requirements/99-audits/",
  "docs/99-resources/",
  "/check/references.md", // the rename catalog lives here intentionally
  "/path-guard.js", // this file
];

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
    for (const allow of ALLOW_LIST_SUBSTRINGS) {
      if (rel.includes(allow)) process.exit(0);
    }

    // Determine what's being written
    const body =
      (event.tool_input || {}).content ||
      (event.tool_input || {}).new_string ||
      "";
    if (!body || body.length === 0) process.exit(0);

    const findings = [];
    for (const { re, why } of STALE_PATTERNS) {
      const m = body.match(re);
      if (m) {
        findings.push({ match: m[0], why });
      }
    }

    if (findings.length === 0) process.exit(0);

    // Build a single message
    const lines = [
      `\x1b[33m[path-guard] Stale path references in ${rel}:\x1b[0m`,
    ];
    for (const f of findings) {
      lines.push(`  - \`${f.match}\` — ${f.why}`);
    }
    lines.push(
      "\x1b[33m  (not blocking — fix at your convenience. Set PATH_GUARD_STRICT=1 to block.)\x1b[0m",
    );

    process.stderr.write(lines.join("\n") + "\n");

    if (STRICT) {
      console.log(
        JSON.stringify({
          decision: "block",
          reason: `path-guard: ${findings.length} stale path reference(s) — see stderr`,
        }),
      );
    }

    process.exit(0);
  } catch {
    process.exit(0);
  }
});
