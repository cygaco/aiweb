#!/usr/bin/env node
// PreToolUse hook: prevents the Boss Agent from reading source code.
//
// The Boss is MECHANICAL — it reads store.json, dispatches agents, checks gates.
// It should NEVER read src/ files, analyze code, or do work that belongs to
// evaluators, redteam, fixer, or the Lead.
//
// This hook blocks Read/Grep/Glob on src/ paths when the Boss is operating.
// It detects "Boss mode" by checking store.heartbeat.agent === "boss".
//
// Allowed paths for the Boss:
// - docs/ (specs, retro, agent system docs)
// - store.json
// - tmp/ (compliance output files)
// - .claude/ (hooks, settings)
// - scripts/ (hooks only)
// - package.json
//
// Blocked paths:
// - src/ (all source code — that's agent territory)
// - extension/ (feature code)

const fs = require("fs");
const path = require("path");
const { PROJECT, PATHS } = require("./lib/paths");

// Load blocked dirs from manifest or use defaults
let blockedDirs = ["src/", "extension/"];
try {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PROJECT, ".claude", "manifest.json"), "utf8"),
  );
  if (Array.isArray(manifest.source_dirs) && manifest.source_dirs.length > 0) {
    blockedDirs = manifest.source_dirs.map((d) =>
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
    const toolName = event.tool_name;

    // Only check Read, Grep, Glob tools
    if (!["Read", "Grep", "Glob"].includes(toolName)) {
      process.exit(0);
    }

    // Check if Boss is active
    const agentsDir = PATHS.agents || path.join(PROJECT, ".claude", "agents");
    const storePath = path.join(agentsDir, "store.json");

    if (!fs.existsSync(storePath)) {
      process.exit(0);
    }

    const store = JSON.parse(fs.readFileSync(storePath, "utf-8"));

    // Only enforce for mechanical orchestrators (boss, gamma)
    // Alpha has architect privileges — can read source code
    const agent = store.heartbeat?.agent;
    if (!["boss", "gamma"].includes(agent)) {
      process.exit(0);
    }

    // Extract the path being accessed
    const targetPath =
      event.tool_input?.file_path ||
      event.tool_input?.path ||
      event.tool_input?.pattern ||
      "";

    // Check if path targets any blocked source directory
    const normalized = targetPath.replace(/\\/g, "/").toLowerCase();
    const isSrcAccess = blockedDirs.some(
      (d) =>
        normalized.includes("/" + d.toLowerCase()) ||
        normalized.startsWith(d.toLowerCase()),
    );

    if (isSrcAccess) {
      process.stderr.write(
        `[boss-boundary] BLOCKED: Boss Agent cannot read source code (${targetPath}). ` +
          `Dispatch an evaluator, redteam, or fixer agent to analyze code. ` +
          `The Boss only reads store.json, docs/, and reviewer output.\n`,
      );
      process.exit(2);
    }

    process.exit(0);
  } catch (err) {
    // Don't block on infrastructure errors
    process.exit(0);
  }
});
