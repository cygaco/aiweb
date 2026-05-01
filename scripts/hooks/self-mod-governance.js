#!/usr/bin/env node
/**
 * Advisory governance for edits to framework-owned files.
 */

const path = require("path");
const { requiredGates } = require("../self-mod/governance");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    if (!["Edit", "Write"].includes(event.tool_name)) process.exit(0);
    const root = process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd();
    const file = event.tool_input?.file_path || "";
    const rel = path.relative(root, file).replace(/\\/g, "/");
    const gates = requiredGates([rel]);
    if (gates.length > 0) {
      process.stderr.write(
        `[self-mod-governance] framework surface edited: ${rel}\n` +
          `  Required before commit: ${gates.join(" && ")}\n`,
      );
    }
  } catch {
    process.exit(0);
  }
  process.exit(0);
});
