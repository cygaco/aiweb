#!/usr/bin/env node
/**
 * region-marker-guard.js — PostToolUse hook for Edit|Write.
 *
 * Detects malformed `<!-- maps:<skill>:START/END (region=<name>) -->` blocks
 * in canonical docs (docs/00-canonical/**\/*.md).
 *
 * `/maps:steps` and related regenerators rewrite content between matching
 * START/END markers. If a marker is orphaned, nested, or mis-paired, the
 * regenerator either silently skips the region or corrupts content. This
 * hook catches drift at write-time.
 *
 * Invariants (per file):
 *   1. Every START has a matching END with same <skill> + <region>.
 *   2. Every END has a preceding START (not orphaned).
 *   3. Regions do not nest — next START must follow prior END.
 *   4. Region names (skill+region) are unique within a file.
 *
 * Violations are warnings only — exit 0 always. Never blocks.
 */

const fs = require("fs");
const path = require("path");

const { PROJECT, PATHS, relPath } = require("./lib/paths");

// Match any `<!-- maps:<skill>:START (region=<name>) ... -->` or END variant.
// Allow arbitrary trailing text before `-->` (comment body can carry notes).
const MARKER_RE =
  /<!--\s*maps:([a-zA-Z0-9_-]+):(START|END)\s*\(region=([^)]+)\)[^]*?-->/g;

function parseMarkers(body) {
  const markers = [];
  MARKER_RE.lastIndex = 0;
  let m;
  while ((m = MARKER_RE.exec(body)) !== null) {
    // Compute line number from match index (1-indexed)
    const line = body.slice(0, m.index).split("\n").length;
    markers.push({
      skill: m[1],
      kind: m[2], // "START" or "END"
      region: m[3].trim(),
      line,
      raw: m[0],
    });
  }
  return markers;
}

function validate(markers) {
  const violations = [];
  const stack = []; // open START markers
  const seen = new Map(); // `${skill}::${region}` → first line seen

  for (const mk of markers) {
    const key = `${mk.skill}::${mk.region}`;

    if (mk.kind === "START") {
      // Uniqueness within file
      if (seen.has(key)) {
        violations.push({
          type: "duplicate-region",
          line: mk.line,
          skill: mk.skill,
          region: mk.region,
          suggestion: `rename this region — \`${key}\` already used at line ${seen.get(key)}`,
        });
      } else {
        seen.set(key, mk.line);
      }

      // Nesting check — a prior START is still open
      if (stack.length > 0) {
        const outer = stack[stack.length - 1];
        violations.push({
          type: "nested-region",
          line: mk.line,
          skill: mk.skill,
          region: mk.region,
          suggestion: `close outer region \`${outer.skill}:${outer.region}\` (opened line ${outer.line}) before starting \`${mk.skill}:${mk.region}\``,
        });
      }
      stack.push(mk);
    } else {
      // END
      if (stack.length === 0) {
        violations.push({
          type: "orphan-end",
          line: mk.line,
          skill: mk.skill,
          region: mk.region,
          suggestion: `add a matching \`<!-- maps:${mk.skill}:START (region=${mk.region}) -->\` before line ${mk.line}, or remove this END`,
        });
        continue;
      }
      const top = stack[stack.length - 1];
      if (top.skill !== mk.skill || top.region !== mk.region) {
        violations.push({
          type: "mismatched-end",
          line: mk.line,
          skill: mk.skill,
          region: mk.region,
          suggestion: `expected END for \`${top.skill}:${top.region}\` (opened line ${top.line}); got \`${mk.skill}:${mk.region}\``,
        });
        // Pop anyway to recover; otherwise one mismatch cascades.
        stack.pop();
        continue;
      }
      stack.pop();
    }
  }

  // Anything left on the stack = orphan START
  for (const open of stack) {
    violations.push({
      type: "orphan-start",
      line: open.line,
      skill: open.skill,
      region: open.region,
      suggestion: `add \`<!-- maps:${open.skill}:END (region=${open.region}) -->\` after line ${open.line}`,
    });
  }

  return violations;
}

function emit(rel, violations) {
  const lines = [
    `region-marker-guard: ${violations.length} malformed region marker(s) in ${rel}:`,
  ];
  for (const v of violations) {
    lines.push(
      `  • line ${v.line} [${v.type}] maps:${v.skill} (region=${v.region})`,
    );
    lines.push(`      fix: ${v.suggestion}`);
  }
  lines.push(
    "",
    "Regenerators like /maps:steps require every START to have a matching END",
    "with identical skill and region name. Orphaned or nested markers cause",
    "silent regeneration failure or content corruption.",
    "",
    "This is a WARNING — the edit is allowed. Fix before running /maps:*.",
  );
  process.stderr.write(lines.join("\n") + "\n");

  // Log each violation
  try {
    const { log } = require("./lib/logger");
    for (const v of violations) {
      log(
        "audit",
        {
          action: "region-marker-violation",
          file: rel,
          line: v.line,
          type: v.type,
          skill: v.skill,
          region: v.region,
        },
        { actor: "region-marker-guard" },
      );
    }
  } catch {
    /* logger optional */
  }
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let event;
  try {
    event = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const toolName = event.tool_name;
  if (toolName !== "Edit" && toolName !== "Write") process.exit(0);

  const filePath = event.tool_input?.file_path || "";
  const rel = relPath(filePath).replace(/\\/g, "/");

  // Narrow scope — canonical markdown only
  if (!rel.startsWith("docs/00-canonical/")) process.exit(0);
  if (!rel.endsWith(".md")) process.exit(0);

  // Read post-edit file from disk (PostToolUse fires after write)
  let body;
  try {
    body = fs.readFileSync(filePath, "utf8");
  } catch {
    process.exit(0);
  }

  const markers = parseMarkers(body);
  if (markers.length === 0) process.exit(0);

  const violations = validate(markers);
  if (violations.length === 0) process.exit(0);

  emit(rel, violations);
  process.exit(0);
});
