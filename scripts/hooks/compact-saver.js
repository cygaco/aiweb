#!/usr/bin/env node
// PostCompact hook: saves the compaction summary to .claude/.compact-summary.md
// This is a free LLM-generated summary of the session so far.
// The Stop hook includes it in the handoff for rich conversation context.

const fs = require("fs");
const path = require("path");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const cwd = process.env.CLAUDE_PROJECT_DIR || event.cwd;
    const claudeDir = path.join(cwd, ".claude");
    const summaryPath = path.join(claudeDir, ".compact-summary.md");

    // PostCompact receives the compaction summary in tool_response
    const summary =
      event.tool_response?.summary ||
      event.tool_response?.content ||
      event.tool_response ||
      "";

    if (typeof summary === "string" && summary.trim().length > 0) {
      // Append — multiple compactions can happen per session
      const timestamp = new Date().toISOString().slice(0, 19);
      const entry = `\n## Compaction at ${timestamp}\n\n${summary.trim()}\n`;
      fs.appendFileSync(summaryPath, entry);
    }

    process.exit(0);
  } catch {
    process.exit(0); // non-blocking
  }
});
