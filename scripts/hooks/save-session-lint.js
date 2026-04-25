#!/usr/bin/env node
// PostToolUse hook: warns when saveSession() is called without a nearby React state update.
// Advisory only — never blocks. Implements BUG-012 class detection (HYGIENE Rule 51).

const fs = require("fs");
const path = require("path");
const { PROJECT, relPath } = require("./lib/paths");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const toolName = event.tool_name || "";

    // Only process Edit and Write events
    if (!/^(Edit|Write)$/.test(toolName)) {
      process.exit(0);
    }

    // Extract file path from the tool input
    const toolInput = event.tool_input || {};
    const filePath = toolInput.file_path || toolInput.path || "";

    if (!filePath) {
      process.exit(0);
    }

    // Only check files under src/
    const rel = relPath(filePath);
    if (!rel.startsWith("src/")) {
      process.exit(0);
    }

    // Read the file content
    const absPath = path.resolve(PROJECT, rel);
    let content;
    try {
      content = fs.readFileSync(absPath, "utf8");
    } catch {
      // File unreadable — fail-open
      process.exit(0);
    }

    const lines = content.split("\n");
    const warnings = [];

    // Regex for saveSession call and React state setters
    const saveSessionRe = /saveSession\s*\(/;
    // Matches: onComplete(, setSession(, setState(, or setAnyCamelCase(
    const stateUpdateRe =
      /\b(onComplete|setSession|setState|set[A-Z][A-Za-z0-9]*)\s*\(/;

    for (let i = 0; i < lines.length; i++) {
      if (!saveSessionRe.test(lines[i])) continue;

      const lineNum = i + 1;
      // Check the saveSession line itself and the next 5 lines
      const windowEnd = Math.min(i + 5, lines.length - 1);
      let hasStateUpdate = false;

      for (let j = i; j <= windowEnd; j++) {
        if (stateUpdateRe.test(lines[j])) {
          hasStateUpdate = true;
          break;
        }
      }

      if (!hasStateUpdate) {
        warnings.push(
          `⚠️ STALE STATE RISK: saveSession() at line ${lineNum} in ${rel} — no React state update within 5 lines. See HYGIENE Rule 51, BUG-012 class.`,
        );
      }
    }

    if (warnings.length > 0) {
      console.log(
        JSON.stringify({
          decision: "approve",
          message: warnings.join("\n"),
        }),
      );
    }

    process.exit(0);
  } catch {
    // Fail-open on any error
    process.exit(0);
  }
});
