#!/usr/bin/env node
// PostToolUse hook: runs prettier on the changed file after Edit/Write
// Keeps formatting consistent without manual intervention.

const { execSync } = require("child_process");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const filePath =
      event.tool_input?.file_path || event.tool_input?.content?.file_path;

    // Only format code files — exclude .md (prose docs with nested code fences
    // cause prettier to corrupt/empty files, see HYGIENE.md wipe incident)
    if (!filePath || !/\.(ts|tsx|js|jsx|json|css)$/.test(filePath)) {
      process.exit(0);
    }

    execSync(`npx prettier --write "${filePath}"`, {
      cwd: event.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
    });

    process.exit(0);
  } catch (err) {
    // Formatting failure shouldn't block work
    process.exit(0);
  }
});
