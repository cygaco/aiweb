#!/usr/bin/env node
// PostToolUse hook: scans edited PRD/STORIES/AC files for empty templates and
// placeholder markers ([TODO], <!-- FILL: ... -->, TBD, empty AC sections).
// Advisory only — never blocks. Implements LRN-2026-04-16 (requirement-template
// fillability): tour/onboarding suggests asking Alex to fill empty specs.

const fs = require("fs");
const path = require("path");
const { PROJECT, relPath } = require("./lib/paths");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const toolName = event.tool_name || "";
    if (!/^(Edit|Write)$/.test(toolName)) process.exit(0);

    const toolInput = event.tool_input || {};
    const filePath = toolInput.file_path || toolInput.path || "";
    if (!filePath) process.exit(0);

    const rel = relPath(filePath);
    // Only scan spec files: PRD.md, STORIES.md, HL-STORIES.md, AC.md, COPY.md, INPUTS.md
    if (!/\/(PRD|STORIES|HL-STORIES|AC|COPY|INPUTS)\.md$/i.test(rel)) {
      process.exit(0);
    }

    const absPath = path.resolve(PROJECT, rel);
    let content;
    try {
      content = fs.readFileSync(absPath, "utf8");
    } catch {
      process.exit(0);
    }

    const findings = [];

    // Marker scan — count occurrences of each placeholder type
    const todoCount = (content.match(/\[TODO\]/g) || []).length;
    const fillCount = (content.match(/<!--\s*FILL[:\s][^>]*-->/g) || []).length;
    const tbdCount = (content.match(/\bTBD\b/g) || []).length;
    const loremCount = (content.match(/\blorem ipsum\b/gi) || []).length;

    if (todoCount) findings.push(`${todoCount} [TODO]`);
    if (fillCount) findings.push(`${fillCount} <!-- FILL: --> markers`);
    if (tbdCount) findings.push(`${tbdCount} TBD`);
    if (loremCount) findings.push(`${loremCount} lorem-ipsum`);

    // Empty Acceptance Criteria section: detect a heading like "## Acceptance
    // Criteria" or "## AC" followed by no content before the next heading.
    const acRegex =
      /^#{1,4}\s+(?:Acceptance Criteria|AC)\b[^\n]*\n+([\s\S]*?)(?=^#{1,4}\s|\z)/gim;
    let acMatch;
    let emptyAcSections = 0;
    while ((acMatch = acRegex.exec(content)) !== null) {
      const body = (acMatch[1] || "").trim();
      // Body is "empty" if it's whitespace, only HTML comments, or only "(none)" placeholder
      const stripped = body
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\(none\)/gi, "")
        .trim();
      if (!stripped) emptyAcSections++;
    }
    if (emptyAcSections)
      findings.push(`${emptyAcSections} empty AC section(s)`);

    if (findings.length) {
      process.stderr.write(
        `[template-fillability] ${rel} has unfilled markers: ${findings.join(", ")}. Consider asking Alex to fill them.\n`,
      );
    }

    process.exit(0);
  } catch {
    // Fail-open — never block on advisory hook errors
    process.exit(0);
  }
});
