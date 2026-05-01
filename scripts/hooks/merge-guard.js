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
        // tool_response from Bash hooks is { stdout, stderr, error?, ... }
        // not a plain string. String(obj) → "[object Object]" — exact bug
        // class fixed 2026-04-29 (RT-016) after 120 events were mislogged
        // as "merge-unknown" with detail "[object Object]" because every
        // merge response failed the .includes("Fast-forward") string match.
        const tr = event.tool_response;
        const response =
          typeof tr === "string"
            ? tr
            : String(
                (tr && (tr.stdout || tr.stderr || tr.error)) ||
                  (tr ? JSON.stringify(tr).slice(0, 500) : ""),
              );
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

    // Pre-allowlist advisory: redundant `cd <projectDir> && git ...` prefix.
    // Must fire here because the allowlist exits early for "cd ... && git ...".
    // CLAUDE.md anti-pattern: never prepend `cd <current-directory>` to git;
    // git operates on cwd. BACKLOG.md run-12 #11: 329 occurrences in 3 days.
    {
      const m = cmd.match(
        /^\s*cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*&&\s*(.+)$/,
      );
      if (m) {
        const target = m[1] || m[2] || m[3];
        const tail = m[4];
        let resolved;
        try {
          resolved = path.resolve(process.cwd(), target);
        } catch {
          resolved = target;
        }
        const isProjectDir =
          target === "." ||
          target === "./" ||
          resolved === PROJECT ||
          resolved === path.resolve(PROJECT);
        const isGitTail = /^git\b/.test(tail.trim());
        if (isProjectDir && isGitTail) {
          logEvent(
            "warn",
            "system",
            "cd-prefix-advisory",
            cmd.slice(0, 120),
            "Redundant cd <projectDir> before git command; git uses cwd. CLAUDE.md anti-pattern.",
          );
          process.stderr.write(
            "\x1b[33m[merge-guard] ADVISORY: Redundant `cd <projectDir>` prefix before git. " +
              "git operates on cwd; drop the prefix (CLAUDE.md).\x1b[0m\n",
          );
          // Continue to allowlist — advisory only, do not exit.
        }
      }
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

    // Phase 2A: path coherence gate runs before ANY git merge. If the gate
    // fails, the merge is blocked — broken path identity must be fixed
    // first. Skipped for the agent/* check below (which has its own
    // gauntlet contract).
    if (/^\s*git\s+merge\b/.test(cmd) && !/git\s+merge\s+agent\//.test(cmd)) {
      const { spawnSync } = require("child_process");
      const result = spawnSync(
        process.execPath,
        [path.join(PROJECT, "scripts", "paths", "gate.js")],
        { cwd: PROJECT, encoding: "utf8" },
      );
      if (result.status !== 0) {
        const tail = (result.stdout || "").split("\n").slice(-10).join("\n");
        block(
          `merge-guard: path coherence gate failed before merge.\n${tail}\n\nFix: node scripts/paths/build.js`,
        );
      }

      // Phase 3F: Requirements Freshness Gate — refuses merge when the spec
      // has drifted from code. Class C RCOs and missing graph fail closed.
      // Engine lives in scripts/requirements/. Skipped silently if engine
      // hasn't shipped yet (older installs).
      //
      // Fail-closed semantics (gemini Phase 3 review fix-forward 2026-04-30):
      //   exit 0 → green, allow
      //   exit 1 → yellow (warnings), allow
      //   exit 2 → red, block
      //   any other exit (crash, signal, undefined behavior) → block, with
      //   the gate output surfaced. Falling open here would let any uncaught
      //   exception in the gate become a silent merge.
      const reqGate = path.join(PROJECT, "scripts", "requirements", "gate.js");
      if (require("fs").existsSync(reqGate)) {
        const reqResult = spawnSync(process.execPath, [reqGate], {
          cwd: PROJECT,
          encoding: "utf8",
        });
        const reqStatus = reqResult.status;
        if (reqStatus === 2) {
          const tail = (reqResult.stdout || "")
            .split("\n")
            .slice(-12)
            .join("\n");
          block(
            `merge-guard: requirements Freshness Gate failed before merge.\n${tail}\n\nFix: node scripts/requirements/graph-build.js && node scripts/requirements/apply-rco.js --auto-expire 30 — then resolve any open Class C RCOs.`,
          );
        } else if (reqStatus !== 0 && reqStatus !== 1) {
          // Crash / unexpected exit — fail closed.
          const errTail =
            (reqResult.stderr || "").split("\n").slice(-8).join("\n") ||
            (reqResult.stdout || "").split("\n").slice(-8).join("\n");
          const sig = reqResult.signal ? ` signal=${reqResult.signal}` : "";
          block(
            `merge-guard: requirements Freshness Gate crashed (exit=${reqStatus}${sig}).\n${errTail}\n\nFix: investigate scripts/requirements/gate.js — do not bypass the gate without a known-good reason.`,
          );
        }
        // status 1 (yellow) — surface but do not block
      }
    }

    // 1. git merge agent/* — block unless cycleStep is "review-complete"
    if (/git\s+merge\s+agent\//.test(cmd)) {
      // Fix-forward (codex Phase 3 review 2026-04-30): the agent/* merge path
      // skipped the Freshness Gate entirely, so the most common build merge
      // could ship with unresolved Class C drift. Run the gate (red blocks,
      // yellow allows). Path-coherence already runs above for non-agent
      // merges; agent merges trust gauntlet review for that side.
      const reqGate = path.join(PROJECT, "scripts", "requirements", "gate.js");
      if (require("fs").existsSync(reqGate)) {
        const { spawnSync } = require("child_process");
        const reqResult = spawnSync(process.execPath, [reqGate], {
          cwd: PROJECT,
          encoding: "utf8",
        });
        const reqStatus = reqResult.status;
        if (reqStatus === 2) {
          const tail = (reqResult.stdout || "")
            .split("\n")
            .slice(-12)
            .join("\n");
          block(
            `merge-guard: requirements Freshness Gate failed before agent/* merge.\n${tail}\n\nFix: resolve open Class C RCOs or rebuild graph (node scripts/requirements/graph-build.js).`,
          );
        } else if (reqStatus !== 0 && reqStatus !== 1) {
          const errTail =
            (reqResult.stderr || "").split("\n").slice(-8).join("\n") ||
            (reqResult.stdout || "").split("\n").slice(-8).join("\n");
          const sig = reqResult.signal ? ` signal=${reqResult.signal}` : "";
          block(
            `merge-guard: Freshness Gate crashed before agent/* merge (exit=${reqStatus}${sig}).\n${errTail}`,
          );
        }
      }

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

    if (/\bgit\s+checkout\s+--\s+(?:\.|src\/?|docs\/?)\s*$/.test(cmd)) {
      block(
        "wide git checkout blocked: use a path-specific restore for the exact files you intend to discard.",
      );
    }

    // 4. node -e with fs write operations — bypass Edit hooks
    // NOTE: this rule ONLY fires on the `-e` flag (inline script). Standalone
    // script files (`node scripts/foo.js`) are allowed — that's the intended
    // escape hatch for state updates that don't fit Edit/Write tool (e.g.
    // rewriting a 65KB store.json). Add your utility to scripts/ and invoke
    // it as a file; the PostToolUse formatter will keep it tidy.
    if (
      /node\s+-e\s/.test(cmd) &&
      /fs\.(writeFileSync|appendFileSync|write|createWriteStream)|require\s*\(\s*['"]fs['"]\s*\)/.test(
        cmd,
      )
    ) {
      block(
        "node -e with fs write blocked: use Edit/Write tools, or put the logic in a `scripts/*.js` file and run `node scripts/<name>.js`. Hooks enforce ownership on Edit/Write but allow standalone scripts.",
      );
    }

    // 5. rm on src/ or docs/ — block destructive deletes.
    // Scoped per-segment so `cd src/ && rm /tmp/x` doesn't false-positive
    // (BACKLOG.md issue #9 / merge-guard regex overmatch). `git rm` is
    // allowed because git tracks the deletion and it's recoverable.
    {
      const segments = cmd.split(/(?:&&|\|\||;|\|)/);
      for (const seg of segments) {
        const s = seg.trim();
        if (!/\brm\b/.test(s)) continue;
        if (/\bgit\s+rm\b/.test(s)) continue;
        // Only block when the rm command itself targets src/ or docs/ —
        // a path token starting with src/ or docs/ in the same segment.
        if (/\b(?:src|docs)\//.test(s)) {
          block(
            "rm on src/ or docs/ blocked: use `git rm` to manage file lifecycle.",
          );
        }
      }
    }

    // 5b. ref-checker advisory on `git rm <path>` (CLAUDE.md §"Refactor & Rename Hygiene").
    // Soft warning only — surfaces broken cross-file refs that the deletion may leave behind.
    // Spawned async + detached so the Bash call isn't blocked by the ~1-2s scan.
    {
      const segments = cmd.split(/(?:&&|\|\||;|\|)/);
      const hasGitRm = segments.some((s) => /\bgit\s+rm\b/.test(s.trim()));
      if (hasGitRm) {
        try {
          const { spawn } = require("child_process");
          const refChecker = path.resolve(__dirname, "ref-checker.js");
          const child = spawn("node", [refChecker, "--summary"], {
            cwd: PROJECT,
            detached: true,
            stdio: "ignore",
          });
          child.unref();
          process.stderr.write(
            "\x1b[33m[merge-guard] ADVISORY: git rm detected — ref-checker scan dispatched in background. Run `node scripts/hooks/ref-checker.js --summary` to see broken refs left by this delete.\x1b[0m\n",
          );
          logEvent(
            "warn",
            "system",
            "ref-checker-dispatched",
            cmd.slice(0, 100),
            "git rm detected — ref-checker spawned async",
          );
        } catch {
          /* fail-open — ref-checker is advisory, never blocks the user */
        }
      }
    }

    // 6. git push force forms — block all three:
    //    (a) --force / --force-with-lease
    //    (b) -f short flag
    //    (c) +refspec form: git push origin +main  (equivalent to --force)
    //    LRN-2026-04-18: old regex caught only (a) and (b); +main syntax bypassed the guard.
    if (
      /git\s+push\s+.*--force/.test(cmd) ||
      /git\s+push\s+-f\b/.test(cmd) ||
      /git\s+push\s+\S+\s+\+\S+/.test(cmd)
    ) {
      block(
        "git push force-push blocked: destructive operation. (matched: --force / -f / +refspec)",
      );
    }

    // 6b. karpathy-run/* branches — block any push (experiment branches, never publish)
    if (/git\s+push\b.*karpathy-run\//.test(cmd)) {
      block(
        "karpathy-run/* branches are experiment-only; never pushed to remote. Use /karpathy:integrate to land the winning variant onto a feature branch off main.",
      );
    }

    // 7. git push (non-force) — advisory warning, not a block
    if (
      /git\s+push\b/.test(cmd) &&
      !/--force|-f\b|--dry-run/.test(cmd) &&
      !/git\s+push\s+\S+\s+\+\S+/.test(cmd)
    ) {
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

    // (Rule 8 — cd <projectDir> advisory — runs above the fast-path allowlist
    // because `cd ... && git ...` chains exit early through allow().)

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
