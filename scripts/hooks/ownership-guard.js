#!/usr/bin/env node
// PreToolUse hook: blocks edits to files owned by other features.
// Reads FILE-OWNERSHIP from store.json to determine who owns what.

const fs = require("fs");
const path = require("path");
const { PROJECT, relPath, PATHS } = require("./lib/paths");

// Load manifest for source_dirs config (defaults to ["src/", "extension/"])
let sourceDirs = ["src/", "extension/"];
try {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PROJECT, ".claude", "manifest.json"), "utf8"),
  );
  if (Array.isArray(manifest.source_dirs) && manifest.source_dirs.length > 0) {
    sourceDirs = manifest.source_dirs.map((d) =>
      d.endsWith("/") ? d : d + "/",
    );
  }
} catch {
  /* manifest missing — use defaults */
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

    // Normalize to forward slashes and make relative
    const rel = relPath(filePath);

    // Only guard files in configured source directories
    if (!sourceDirs.some((d) => rel.startsWith(d) || rel.includes("/" + d))) {
      process.exit(0);
      return;
    }

    // Read store to find current agent and file ownership
    const agentsDir = PATHS.agents || path.join(PROJECT, ".claude", "agents");
    const storePath = path.join(agentsDir, "store.json");

    if (!fs.existsSync(storePath)) {
      // No store = can't enforce ownership, allow
      process.exit(0);
      return;
    }

    let store;
    try {
      store = JSON.parse(fs.readFileSync(storePath, "utf8"));
    } catch {
      process.exit(0);
      return;
    }

    const heartbeat = store.heartbeat || {};
    const currentAgent = heartbeat.agent || "";
    const currentFeature = heartbeat.feature || "";

    // Orchestrators and non-builder roles can edit anything
    if (
      !currentAgent ||
      [
        "boss",
        "lead",
        "alpha",
        "gamma",
        "evaluator",
        "redteam",
        "security",
        "fixer",
        "compliance",
      ].includes(currentAgent)
    ) {
      process.exit(0);
      return;
    }

    // Find which feature owns this file
    const features = store.features || {};
    let ownerFeature = null;

    for (const [featureId, featureData] of Object.entries(features)) {
      const files = featureData.files || [];
      if (files.some((f) => rel === f || rel.endsWith("/" + f))) {
        ownerFeature = featureId;
        break;
      }
    }

    // If file has no owner in store — warn if it's in a source dir
    if (!ownerFeature) {
      if (sourceDirs.some((d) => rel.startsWith(d)) && currentFeature) {
        process.stderr.write(
          `[ownership-guard] WARN: "${rel}" is not in any feature's file list. ` +
            `If this is a new file for "${currentFeature}", add it to store.json features.${currentFeature}.files.\n`,
        );
      }
      process.exit(0);
      return;
    }

    // If current feature matches owner, allow
    if (currentFeature === ownerFeature) {
      process.exit(0);
      return;
    }

    // Check shared files (ReadyPage etc.)
    const shared = store.sharedFiles || {};
    if (shared[rel]) {
      process.exit(0);
      return;
    }

    process.stderr.write(
      `BLOCKED: "${rel}" is owned by feature "${ownerFeature}" ` +
        `but you are building "${currentFeature}".\n` +
        `Only modify files in your own feature scope.\n`,
    );
    process.exit(2);
  } catch {
    // Graceful failure
    process.exit(0);
  }
});
