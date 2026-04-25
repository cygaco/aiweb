#!/usr/bin/env node
// PostToolUse hook: runs tsc --noEmit on the changed file after Edit/Write
// Catches type errors at edit time, not build time.

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const filePath =
      event.tool_input?.file_path || event.tool_input?.content?.file_path;

    // Only check .ts/.tsx files
    if (!filePath || !/\.(ts|tsx)$/.test(filePath)) {
      process.exit(0);
    }

    // Run tsc via node directly — .bin symlinks are unreliable on Windows
    const cwd = event.cwd || process.env.CLAUDE_PROJECT_DIR || ".";
    const tscBin = path.join(cwd, "node_modules", "typescript", "bin", "tsc");

    // Gracefully skip if TypeScript is not installed
    if (!fs.existsSync(tscBin)) {
      process.exit(0);
    }

    execSync(`node "${tscBin}" --noEmit --pretty "${filePath}"`, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15000,
    });

    // Clean exit = no type errors
    process.exit(0);
  } catch (err) {
    if (err.stderr || err.stdout) {
      const output = (err.stderr || err.stdout).toString().trim();
      // Only block on actual type errors, not missing-binary errors
      if (
        output &&
        !output.includes("Cannot find module") &&
        !output.includes("ENOENT")
      ) {
        process.stderr.write(`Type error in edited file:\n${output}\n`);
        process.exit(2);
      }
    }
    // Non-type errors (timeout, missing tools, etc.) — don't block
    process.exit(0);
  }
});
