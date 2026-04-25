#!/usr/bin/env node
/**
 * merge-guard.js — Pre/PostToolUse hook for Bash commands.
 *
 * Blocks dangerous Bash commands that bypass other hooks:
 * - git merge agent/* before gauntlet passes (cycleStep must be "review-complete")
 * - git reset --hard (destructive)
 * - git checkout agent/* (prevents branch switching to agent branches)
 * - node -e with fs.writeFileSync (bypasses Edit hooks)
 * - rm on src/ or docs/ files (destructive)
 *
 * Allowlist-first for performance — read-only commands exit immediately.
 * Fail-closed: parse errors or missing store → BLOCK.
 *
 * Closes: GAP-101 through GAP-109 (9 gaps).
 */

const fs = require("fs");
const path = require("path");
const { PROJECT } = require("./lib/paths");
const { logEvent } = require("./lib/logger");

const STORE_PATH = path.resolve(PROJECT, ".claude", "agents", "store.json");

// Read-only command prefixes — fast-path allow
const ALLOWLIST = [
  "git log",
  "git status",
  "git diff",
  "git branch",
  "git show",
  "git worktree",
  "git stash",
  "git tag",
  "git remote",
  "git rev-parse",
  "git config",
  "ls ",
  "ls\n",
  "cat ",
  "head ",
  "tail ",
  "grep ",
  "rg ",
  "find ",
  "wc ",
  "echo ",
  "printf ",
  "pwd",
  "which ",
  "node -c ",
  "node --check",
  "npx tsc",
  "npx kill-port",
  "npm run build",
  "npm run lint",
  "npm run test",
  "npm run dev",
  "npm install",
  "tasklist",
  "timeout ",
  "sleep ",
  "mkdir ",
  "touch ",
  "cp ",
  "mv ",
  "sort ",
  "uniq ",
  "tr ",
  "sed ",
  "awk ",
  "curl ",
  "codex ",
  "gemini ",
];

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function block(reason) {
  logEvent("block", "system", "merge-guard-blocked", "", reason);
  console.log(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

function allow(cmd) {
  // Only log non-trivial commands (skip reads)
  const trimmed = cmd.trim().slice(0, 30);
  if (
    !trimmed.startsWith("git log") &&
    !trimmed.startsWith("git status") &&
    !trimmed.startsWith("git diff") &&
    !trimmed.startsWith("ls") &&
    !trimmed.startsWith("cat") &&
    !trimmed.startsWith("head") &&
    !trimmed.startsWith("tail")
  ) {
    logEvent("merge", "system", "bash-allowed", "", trimmed);
  }
  process.exit(0);
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const toolName = event.tool_name || "";

    // Only process Bash tool calls
    if (toolName !== "Bash") {
      process.exit(0);
    }

    const command = (event.tool_input || {}).command || "";
    const cmd = command.trim();

    if (!cmd) {
      process.exit(0);
    }

    // PostToolUse mode: tool_response present → log and allow
    if (event.tool_response !== undefined) {
      // Post-merge verification: check if a merge just completed
      if (cmd.includes("git merge")) {
        const response = String(event.tool_response || "");
        const merged =
          response.includes("Fast-forward") || response.includes("Merge made");
        const failed =
          response.includes("CONFLICT") ||
          response.includes("error") ||
          response.includes("fatal");
        logEvent(
          "merge",
          "system",
          merged
            ? "merge-completed"
            : failed
              ? "merge-failed"
              : "merge-unknown",
          cmd.slice(0, 100),
          response.slice(0, 200),
        );
        // GAP-1102: Remind to run build after successful merge
        if (merged) {
          process.stderr.write(
            "\x1b[33m[merge-guard] POST-MERGE: Run `npm run build` to verify integration.\x1b[0m\n",
          );
          logEvent(
            "warn",
            "system",
            "post-merge-build-reminder",
            "",
            "Merge succeeded — npm run build required next",
          );
        }
      }
      process.exit(0);
    }

    // === PreToolUse mode ===

    // Pre-allowlist critical blocks (must run before fast-path)
    // Backup branch deletion — "git branch" is in allowlist so this must come first
    if (/git\s+branch\s+-[dD]\s+backup-/.test(cmd)) {
      block(
        "Deleting backup branches blocked: backup branches are protected (CLAUDE.md §10).",
      );
    }

    // Fast-path: allowlist check — ALL sub-commands in a chain must be safe
    // to exit early. Avoids `git status && rm -rf src/` sneaking past because
    // the first token matches. Matches memory-guard's pattern (LRN-2026-04-17).
    const subCmds = cmd
      .split(/\s*(?:&&|\|\||\||;)\s*/)
      .map((c) => c.trim())
      .filter(Boolean);
    const isSafeSub = (c) =>
      c.startsWith("cd ") ||
      c === "cd" ||
      ALLOWLIST.some((prefix) => c.startsWith(prefix));
    const allSafe = subCmds.length > 0 && subCmds.every(isSafeSub);
    if (allSafe) {
      allow(cmd);
    }

    // === Block rules ===

    // 1. git merge agent/* — block unless cycleStep is "review-complete"
    if (/git\s+merge\s+agent\//.test(cmd)) {
      const store = readStore();
      if (!store) {
        block(
          "Cannot read store.json — fail-closed. git merge agent/* blocked.",
        );
      }
      const cycleStep = (store.heartbeat || {}).cycleStep;
      if (cycleStep !== "review-complete") {
        block(
          `git merge agent/* blocked: cycleStep is "${cycleStep}", must be "review-complete". ` +
            "Run gauntlet (eval+security+compliance) first. See HYGIENE Rule 54.",
        );
      }
      // cycleStep is review-complete — allow the merge
      logEvent(
        "merge",
        "boss",
        "merge-allowed",
        cmd.slice(0, 100),
        `cycleStep=${cycleStep}`,
      );
      process.exit(0);
    }

    // 2. git reset --hard — always block
    if (/git\s+reset\s+--hard/.test(cmd)) {
      block(
        "git reset --hard blocked: destructive operation. Use git revert instead.",
      );
    }

    // 3. git checkout agent/ — block switching to agent branches
    if (/git\s+checkout\s+agent\//.test(cmd)) {
      block(
        "git checkout agent/* blocked: Boss should not switch to agent branches directly.",
      );
    }

    // 4. node -e with fs write operations — bypass Edit hooks
    if (
      /node\s+-e\s/.test(cmd) &&
      /fs\.(writeFileSync|appendFileSync|write|createWriteStream)|require\s*\(\s*['"]fs['"]\s*\)/.test(
        cmd,
      )
    ) {
      block(
        "node -e with fs write blocked: use Edit/Write tools instead (hooks enforce ownership).",
      );
    }

    // 5. rm on src/ or docs/ — block destructive deletes
    if (/\brm\b/.test(cmd) && (/\bsrc\//.test(cmd) || /\bdocs\//.test(cmd))) {
      block("rm on src/ or docs/ blocked: use git to manage file lifecycle.");
    }

    // 6. git push --force — block force pushes
    if (/git\s+push\s+.*--force/.test(cmd) || /git\s+push\s+-f\b/.test(cmd)) {
      block("git push --force blocked: destructive operation.");
    }

    // 7. git push (non-force) — advisory warning, not a block
    if (/git\s+push\b/.test(cmd) && !/--force|-f\b|--dry-run/.test(cmd)) {
      logEvent(
        "warn",
        "system",
        "push-advisory",
        cmd.slice(0, 100),
        "Convention: ask user before pushing (CLAUDE.md §4)",
      );
      process.stderr.write(
        "\x1b[33m[merge-guard] ADVISORY: git push detected. Convention says ask before pushing.\x1b[0m\n",
      );
      // Allow — this is advisory only
    }

    // Default: allow
    allow(cmd);
  } catch (e) {
    // Fail-closed on parse error
    logEvent(
      "block",
      "system",
      "merge-guard-parse-error",
      "",
      String(e).slice(0, 200),
    );
    console.log(
      JSON.stringify({
        decision: "block",
        reason:
          "merge-guard: parse error (fail-closed) — " + String(e).slice(0, 100),
      }),
    );
    process.exit(0);
  }
});
