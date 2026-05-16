#!/usr/bin/env node
/**
 * requirement-format-guard.js — PreToolUse Edit|Write hook.
 *
 * Phase 0 workstream J. Catches requirement-format problems while a PRD /
 * STORIES / HL-STORIES / CROSS-STANDARDS file is being authored, instead
 * of at merge time when the offending IDs are already deep in the diff.
 *
 * Uses scripts/requirements/config.js#ID_PATTERNS as the single source of
 * truth — no parallel regexes here. Existing legacy files (using `S-1`,
 * `S-2`, etc.) are grandfathered behind an explicit marker so the guard
 * stays signal, not noise:
 *
 *     <!-- requirement-format-legacy -->
 *
 * Strict mode (block instead of warn) is opt-in:
 *
 *     env: REQUIREMENT_GUARD_STRICT=1
 *     file marker: <!-- requirement-format-strict -->
 *
 * Fail-open on any parse error.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

if (process.env.REQUIREMENT_GUARD === "off") process.exit(0);

const STRICT_ENV = process.env.REQUIREMENT_GUARD_STRICT === "1";
const STRICT_FILE_MARKER = "<!-- requirement-format-strict -->";
const LEGACY_FILE_MARKER = "<!-- requirement-format-legacy -->";

// Paths under .claude/runtime/ etc. should never be linted as requirements.
function isRequirementPath(rel) {
  if (!rel) return false;
  const norm = rel.replace(/\\/g, "/");
  if (!norm.startsWith("_requirements/")) return false;
  if (/\b_audits\//.test(norm)) return false; // audit artifacts use their own conventions
  return (
    /\/PRD\.md$/.test(norm) ||
    /\/STORIES\.md$/.test(norm) ||
    /\/HL-STORIES\.md$/.test(norm) ||
    /\/CROSS-STANDARDS\.md$/.test(norm)
  );
}

function loadIdPatterns() {
  try {
    const cfg = require(
      path.join(PROJECT_DIR, "scripts", "requirements", "config.js"),
    );
    return cfg.ID_PATTERNS;
  } catch {
    return null;
  }
}

function extractNewContent(event) {
  // Edit: { tool_input: { file_path, old_string, new_string, replace_all? } }
  // Write: { tool_input: { file_path, content } }
  const input = event.tool_input || {};
  if (typeof input.content === "string") return input.content;
  if (typeof input.new_string === "string") return input.new_string;
  return "";
}

function targetPath(event) {
  const input = event.tool_input || {};
  let p = input.file_path || "";
  if (!p) return "";
  if (path.isAbsolute(p)) {
    return path.relative(PROJECT_DIR, p).replace(/\\/g, "/");
  }
  return p.replace(/\\/g, "/");
}

function emitWarn(detail) {
  try {
    const { logEvent } = require("./lib/logger");
    logEvent(
      "warn",
      "system",
      "requirement-format-guard",
      "",
      detail.slice(0, 400),
    );
  } catch {
    /* logger optional */
  }
  process.stderr.write("[requirement-format-guard] " + detail + "\n");
}

function emitBlock(detail) {
  try {
    const { logEvent } = require("./lib/logger");
    logEvent(
      "block",
      "system",
      "requirement-format-guard",
      "",
      detail.slice(0, 400),
    );
  } catch {
    /* logger optional */
  }
  console.log(JSON.stringify({ decision: "block", reason: detail }));
  process.exit(0);
}

function checkContent(rel, content, patterns) {
  const findings = [];

  if (content.includes(LEGACY_FILE_MARKER)) {
    return findings; // grandfathered — skip
  }

  if (/\/PRD\.md$/.test(rel)) {
    // PRDs accept either GS-* / HL-* references (subordinate stories) OR
    // REQ-* alt form. Any standalone S-1 / S-2 etc. should be flagged.
    const legacyIds =
      content.match(/(?<![A-Za-z0-9-])S-\d{1,3}(?![A-Za-z0-9-])/g) || [];
    if (legacyIds.length) {
      findings.push(
        `Legacy "S-<n>" identifiers present (${legacyIds.length} occurrence(s)): use GS-<FEATURE>-<NN> / REQ-<feature>-<topic>-<NNN>. Examples: ${[...new Set(legacyIds)].slice(0, 3).join(", ")}`,
      );
    }
  }

  if (/\/STORIES\.md$/.test(rel)) {
    // Validate granular-story headings.
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      // Look for any heading like "### S-12: …" or "### S12 …" — legacy form.
      const legacy = line.match(/^###\s+S-?\d{1,3}\b/);
      if (legacy) {
        findings.push(
          `Legacy story heading: "${line.trim().slice(0, 80)}". Use "### GS-<FEATURE>-<NN>: <title>".`,
        );
      }
      // Look for malformed GS- IDs (lowercase suffix, missing digits)
      const malformedGs = line.match(/^###\s+(GS-[^\s]+):/);
      if (malformedGs && patterns) {
        const id = malformedGs[1];
        const fresh = new RegExp(patterns.granularStory.source);
        if (!fresh.test(id)) {
          findings.push(
            `Story ID "${id}" does not match GS-<UPPER>-<NN>. Convert before merge.`,
          );
        }
      }
    }
  }

  if (/\/HL-STORIES\.md$/.test(rel)) {
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const malformedHl = line.match(/^###\s+(HL-[^\s]+):/);
      if (malformedHl && patterns) {
        const id = malformedHl[1];
        const fresh = new RegExp(patterns.highLevelStory.source);
        if (!fresh.test(id)) {
          findings.push(`HL story ID "${id}" does not match HL-<UPPER>-<NN>.`);
        }
      }
    }
  }

  if (/\/CROSS-STANDARDS\.md$/.test(rel)) {
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const malformedCs = line.match(/^###\s+(CS-[^\s]+):/);
      if (malformedCs && patterns) {
        const id = malformedCs[1];
        const fresh = new RegExp(patterns.crossStandard.source);
        if (!fresh.test(id)) {
          findings.push(`Cross-standard ID "${id}" does not match CS-<NNN>.`);
        }
      }
    }
  }

  return findings;
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    if (event.tool_response !== undefined) process.exit(0); // PostToolUse skip
    const tool = event.tool_name || "";
    if (tool !== "Edit" && tool !== "Write") process.exit(0);

    const rel = targetPath(event);
    if (!isRequirementPath(rel)) process.exit(0);

    const content = extractNewContent(event);
    if (!content) process.exit(0);

    const patterns = loadIdPatterns();
    if (!patterns) process.exit(0); // config missing — fail-open

    const findings = checkContent(rel, content, patterns);
    if (findings.length === 0) process.exit(0);

    const strict = STRICT_ENV || content.includes(STRICT_FILE_MARKER);
    const banner = `requirement-format-guard: ${findings.length} finding(s) in ${rel}`;
    const body = [banner, ...findings.map((f) => "  - " + f)].join("\n");

    if (strict) {
      emitBlock(
        body +
          "\n\nStrict mode is on " +
          (STRICT_ENV ? "(REQUIREMENT_GUARD_STRICT=1)" : "(file marker)") +
          ". Resolve or add <!-- requirement-format-legacy --> to grandfather.",
      );
    } else {
      emitWarn(
        body +
          "\n\nWarn-only. Set REQUIREMENT_GUARD_STRICT=1 or add" +
          " <!-- requirement-format-strict --> to block.",
      );
      process.exit(0);
    }
  } catch {
    process.exit(0); // fail-open
  }
});

module.exports = { checkContent, isRequirementPath };
