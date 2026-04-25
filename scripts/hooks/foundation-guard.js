#!/usr/bin/env node
// PreToolUse hook: blocks edits to foundation files unless explicitly overridden.
// Foundation files are shared infrastructure — feature agents must not modify them.

const fs = require("fs");
const path = require("path");
const { PROJECT, relPath, PATHS } = require("./lib/paths");

// Load foundation files from manifest — empty default means no blocking on fresh projects
let FOUNDATION_FILES = [];
try {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PROJECT, ".claude", "manifest.json"), "utf8"),
  );
  const ownership = manifest.fileOwnership || manifest.file_ownership || {};
  FOUNDATION_FILES = ownership.foundation || [];
} catch {
  /* no manifest — no foundation guard enforcement */
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const filePath = event.tool_input?.file_path || "";

    if (!filePath) {
      process.exit(0);
      return;
    }

    // Skip if no foundation files configured
    if (FOUNDATION_FILES.length === 0) {
      process.exit(0);
      return;
    }

    // Normalize path using paths.js
    const rel = relPath(filePath);

    const isFoundation = FOUNDATION_FILES.some(
      (f) => rel === f || rel.endsWith("/" + f),
    );

    if (!isFoundation) {
      process.exit(0);
      return;
    }

    // Check if the agent prompt contains the override keyword
    const prompt =
      (event.tool_input?.content || "") +
      (event.tool_input?.new_string || "") +
      (event.tool_input?.command || "");

    // Allow if this looks like the boss/lead doing a foundation-update
    // (they would set this in store.json first)
    try {
      const agentsDir = PATHS.agents || path.join(PROJECT, ".claude", "agents");
      const storePath = path.join(agentsDir, "store.json");
      if (fs.existsSync(storePath)) {
        const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
        const heartbeat = store.heartbeat || {};
        // Boss, lead, alpha, and gamma roles may edit foundation files
        if (["boss", "lead", "alpha", "gamma"].includes(heartbeat.agent)) {
          process.exit(0);
          return;
        }
      }
    } catch {
      // If store can't be read, still enforce the guard
    }

    process.stderr.write(
      `BLOCKED: "${rel}" is a foundation file (read-only for feature agents).\n` +
        `If you need a change, flag a foundation-update request in store.json.\n`,
    );
    process.exit(2);
  } catch {
    // Graceful failure — don't block on parse errors
    process.exit(0);
  }
});
