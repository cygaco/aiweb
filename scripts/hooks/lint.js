#!/usr/bin/env node
// PostToolUse hook: runs ESLint on the changed file after Edit/Write.
// Catches lint issues at edit time. Non-blocking (exit 0) — warnings only.

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Detect lint command from package.json or manifest
function detectLintCommand(cwd) {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
    );
    const scripts = pkg.scripts || {};
    // Check for common lint script names
    if (scripts.lint) return { cmd: "npm run lint --", perFile: false };
    if (scripts["lint:fix"])
      return { cmd: "npm run lint:fix --", perFile: false };
  } catch {
    /* no package.json */
  }

  // Check for Next.js (npx next lint --file)
  try {
    if (fs.existsSync(path.join(cwd, "node_modules", "next"))) {
      return { cmd: 'npx next lint --file "{file}" --no-cache', perFile: true };
    }
  } catch {
    /* no next */
  }

  // Check for ESLint directly
  try {
    if (fs.existsSync(path.join(cwd, "node_modules", ".bin", "eslint"))) {
      return { cmd: 'npx eslint "{file}"', perFile: true };
    }
  } catch {
    /* no eslint */
  }

  return null;
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const filePath =
      event.tool_input?.file_path || event.tool_input?.content?.file_path;

    // Only lint JS/TS files
    if (!filePath || !/\.(ts|tsx|js|jsx)$/.test(filePath)) {
      process.exit(0);
    }

    const cwd = event.cwd || process.env.CLAUDE_PROJECT_DIR || ".";
    const lintConfig = detectLintCommand(cwd);

    // Gracefully skip if no linter found
    if (!lintConfig) {
      process.exit(0);
    }

    const cmd = lintConfig.perFile
      ? lintConfig.cmd.replace("{file}", filePath)
      : `${lintConfig.cmd} "${filePath}"`;

    const result = execSync(`${cmd} 2>&1`, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15000,
    });

    const output = result.toString().trim();
    // If there are warnings, show them but don't block
    if (output && !/No ESLint warnings or errors/.test(output)) {
      process.stderr.write(`Lint warnings in ${filePath}:\n${output}\n`);
    }

    process.exit(0);
  } catch (err) {
    // Lint errors — report but don't block (exit 0, not 2)
    if (err.stdout || err.stderr) {
      const output = (err.stdout || err.stderr).toString().trim();
      if (output && !/No ESLint warnings or errors/.test(output)) {
        process.stderr.write(`Lint issues:\n${output}\n`);
      }
    }
    process.exit(0);
  }
});
