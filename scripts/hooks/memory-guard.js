#!/usr/bin/env node
/**
 * memory-guard.js — PreToolUse hook for Bash + Edit|Write.
 *
 * Protects critical data files from unauthorized overwrites:
 * - events.jsonl: append-only (must go through logger.js)
 * - learnings.jsonl: append-only (must go through assess-session.js)
 * - systems.jsonl: protected from truncation
 *
 * Closes: event log append-only (GAP), memory file integrity, learning count bounds.
 * Fail-closed: parse errors → BLOCK.
 */

const fs = require("fs");
const path = require("path");
const { PROJECT, relPath, PATHS } = require("./lib/paths");
const { logEvent } = require("./lib/logger");

const PROTECTED_FILES = [
  "events.jsonl",
  "learnings.jsonl",
  "systems.jsonl",
  "traces.jsonl",
];

// Build protected paths dynamically from paths.json (never hardcode)
const eventsDir =
  PATHS.events || path.join(PROJECT, ".claude", "project", "events");
const memoryDir =
  PATHS.memory || path.join(PROJECT, ".claude", "project", "memory");
const PROTECTED_PATHS = [
  relPath(path.join(eventsDir, "events.jsonl")),
  relPath(path.join(memoryDir, "learnings.jsonl")),
  relPath(path.join(memoryDir, "systems.jsonl")),
  relPath(path.join(memoryDir, "traces.jsonl")),
];

function block(reason) {
  logEvent("block", "system", "memory-guard-blocked", "", reason);
  console.log(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

function isProtectedPath(filePath) {
  const rel = relPath(filePath);
  return PROTECTED_PATHS.some((p) => rel === p || rel.endsWith("/" + p));
}

function isProtectedFile(str) {
  return PROTECTED_FILES.some((f) => str.includes(f));
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const toolName = event.tool_name || "";

    // PostToolUse — advisory learning count check
    if (event.tool_response !== undefined) {
      if (toolName === "Write" || toolName === "Edit") {
        const filePath = (event.tool_input || {}).file_path || "";
        if (filePath.includes("learnings.jsonl")) {
          try {
            const absPath = path.join(memoryDir, "learnings.jsonl");
            if (fs.existsSync(absPath)) {
              const content = fs.readFileSync(absPath, "utf8").trim();
              const lines = content ? content.split("\n") : [];
              let activeCount = 0;
              for (const line of lines) {
                try {
                  const entry = JSON.parse(line);
                  if (
                    entry.status !== "implemented" &&
                    entry.effective !== false
                  ) {
                    activeCount++;
                  }
                } catch {
                  /* skip malformed lines */
                }
              }
              if (activeCount > 100) {
                process.stderr.write(
                  `\x1b[33m[memory-guard] WARN: ${activeCount} active learnings (target: 60-100). Consider pruning with /learn:conversation.\x1b[0m\n`,
                );
                logEvent(
                  "warn",
                  "system",
                  "learning-count-high",
                  "",
                  `${activeCount} active learnings exceeds 100 target`,
                );
              }
            }
          } catch {
            /* count check is advisory — don't block */
          }
        }
      }
      process.exit(0);
    }

    // === PreToolUse mode ===

    // Handle Bash commands
    if (toolName === "Bash") {
      const command = (event.tool_input || {}).command || "";
      const cmd = command.trim();

      if (!cmd || !isProtectedFile(cmd)) {
        process.exit(0);
      }

      // Allow appendFileSync — that's the legitimate append path
      if (/appendFileSync/.test(cmd) && !/writeFileSync/.test(cmd)) {
        process.exit(0);
      }

      // Allow setup-system.js (first-time initialization)
      if (cmd.includes("setup-system")) {
        process.exit(0);
      }

      // Allow read-only and safe operations
      // Check all commands in && chains (e.g., "cd /path && git add ...")
      const subCmds = cmd.split(/\s*&&\s*/);
      const allSafe = subCmds.every(
        (c) =>
          /^\s*(cd|cat|head|tail|less|more|wc|grep|rg|find|ls|git)\s/.test(c) ||
          /^\s*node\s.*query/.test(c) ||
          /^\s*$/.test(c),
      );
      if (allSafe) {
        process.exit(0);
      }

      // Strip fd-to-fd redirects (e.g., 2>&1, 1>&2) and 2>/dev/null —
      // these are not file overwrites and must not trigger the guard.
      const cmdForRedirectCheck = cmd
        .replace(/\d?>&\d+/g, "")
        .replace(/\d?>\s*\/dev\/(null|stderr|stdout)/g, "");

      // Allow append redirects (>>) — these are safe for append-only files
      if (
        />>/.test(cmdForRedirectCheck) &&
        !/(?<![>])>\s*[^>]/.test(cmdForRedirectCheck.replace(/>>/g, ""))
      ) {
        process.exit(0);
      }

      // Block truncation/overwrite patterns
      // 1. Redirect overwrite: > file or >file (to an actual file, not a fd)
      if (
        /(?<!=)>\s*[^>&]/.test(cmdForRedirectCheck) &&
        !/>>/.test(cmdForRedirectCheck.split(">")[0] + ">")
      ) {
        // Check if the redirect targets a protected file
        for (const f of PROTECTED_FILES) {
          // Only block if the file appears AFTER a `>` — i.e. it's actually a redirect target
          const redirectTarget = /(?<!=)(?<!>)>\s*(\S+)/.exec(
            cmdForRedirectCheck,
          );
          if (redirectTarget && redirectTarget[1].includes(f)) {
            block(
              `Overwrite redirect to ${f} blocked. Use logger.js for events or appendFileSync for memory files.`,
            );
          }
        }
      }

      // 2. writeFileSync targeting protected files
      if (/writeFileSync/.test(cmd)) {
        for (const f of PROTECTED_FILES) {
          if (cmd.includes(f)) {
            block(
              `writeFileSync on ${f} blocked. These files are append-only. Use logger.js or appendFileSync.`,
            );
          }
        }
      }

      // 3. truncate command
      if (/\btruncate\b/.test(cmd)) {
        for (const f of PROTECTED_FILES) {
          if (cmd.includes(f)) {
            block(`truncate on ${f} blocked. These files are append-only.`);
          }
        }
      }

      // 4. rm on protected files
      if (/\brm\b/.test(cmd)) {
        for (const f of PROTECTED_FILES) {
          if (cmd.includes(f)) {
            block(`rm on ${f} blocked. These files are append-only.`);
          }
        }
      }

      // 5. echo/printf overwrite (echo "" > file) — exclude >> (append) and fd redirects like 2>&1
      if (
        /\b(echo|printf)\b/.test(cmd) &&
        /(?<!=)(?<!>)>\s*[^>&]/.test(cmdForRedirectCheck)
      ) {
        for (const f of PROTECTED_FILES) {
          if (cmd.includes(f)) {
            block(
              `echo/printf redirect to ${f} blocked. These files are append-only.`,
            );
          }
        }
      }

      process.exit(0);
    }

    // Handle Edit|Write tool calls
    if (toolName === "Edit" || toolName === "Write") {
      const filePath = (event.tool_input || {}).file_path || "";

      if (!filePath) {
        process.exit(0);
      }

      // Block direct Edit/Write to events.jsonl — must go through logger.js
      if (filePath.includes("events.jsonl") && isProtectedPath(filePath)) {
        block(
          "Direct Edit/Write to events.jsonl blocked. Use logger.js (appendFileSync) for event logging.",
        );
      }

      // Block Write (full overwrite) to learnings/traces/systems
      // Edit is allowed (surgical changes), Write would truncate
      if (toolName === "Write" && isProtectedPath(filePath)) {
        block(
          `Write (full overwrite) to ${path.basename(filePath)} blocked. Use Edit for surgical changes or appendFileSync for appending.`,
        );
      }

      process.exit(0);
    }

    // Not a tool we handle
    process.exit(0);
  } catch (e) {
    // Fail-closed on parse error
    logEvent(
      "block",
      "system",
      "memory-guard-parse-error",
      "",
      String(e).slice(0, 200),
    );
    console.log(
      JSON.stringify({
        decision: "block",
        reason:
          "memory-guard: parse error (fail-closed) — " +
          String(e).slice(0, 100),
      }),
    );
    process.exit(0);
  }
});
