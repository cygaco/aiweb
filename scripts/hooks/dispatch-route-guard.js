#!/usr/bin/env node
/**
 * dispatch-route-guard.js — PreToolUse Bash hook.
 *
 * Phase 0 workstream B. Blocks raw cross-provider CLI prompt invocations that
 * bypass the canonical dispatch route (`node scripts/dispatch-agent.js …`).
 *
 * Forbidden (cross-provider stdin / -p prompt patterns):
 *   - `codex exec` not preceded by `node scripts/dispatch-agent.js`
 *   - `gemini … -p` (with a prompt arg, not --help / --version)
 *   - `claude -p` *unless* immediately followed by `--agent <role>` (the
 *      documented Claude fallback path Gamma/Delta already use)
 *   - `cat <file> | (codex|gemini|claude)`
 *
 * Allowed (always):
 *   - `<provider> --version` / `--help` / `auth status` / `models list`
 *   - Anything that begins with `node scripts/dispatch-agent.js`
 *   - Commands operating on `.claude/runtime/.provider-tmp/` paths
 *   - When `WARPOS_PROVIDER_PROBE=1` is set in the harness env (one-shot
 *      health probe escape hatch; the bypass is logged.)
 *
 * Why this hook exists: raw provider CLI prompt invocation from Bash has
 * re-triggered known stdin / binding-gap failures multiple times
 * (LRN-2026-04-17 codex Windows stdin; LRN-2026-04-30 binding-gap). The
 * canonical wrapper at `scripts/dispatch-agent.js` is the only path that
 * goes through `runProvider`, which carries the Windows-stdin fix and the
 * concurrency-lock layer.
 *
 * Fail-open on parse errors. Never block on hook bugs.
 */

"use strict";

const path = require("path");

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Kill switch
if (process.env.WARPOS_DISPATCH_ROUTE_GUARD === "off") process.exit(0);

function block(reason) {
  try {
    const { logEvent } = require("./lib/logger");
    logEvent("block", "system", "dispatch-route-guard", "", reason);
  } catch {
    /* logger optional */
  }
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

function probeBypass(cmd) {
  // Honour one-shot bypass for provider-health probes. The probe path sets
  // WARPOS_PROVIDER_PROBE=1 in the harness env before launching the Bash
  // tool call. We log the bypass for audit.
  if (process.env.WARPOS_PROVIDER_PROBE === "1") {
    try {
      const { logEvent } = require("./lib/logger");
      logEvent(
        "bypass",
        "system",
        "dispatch-route-guard-probe",
        "",
        cmd.slice(0, 200),
      );
    } catch {
      /* skip */
    }
    return true;
  }
  return false;
}

// --- Pattern matchers -----------------------------------------------------

// Allow when a `<provider>` token is followed by one of these "harmless" flags
// or subcommands rather than a `-p` prompt invocation.
const SAFE_PROVIDER_TAILS =
  /^\s*(?:--version|--help|-h|-v|models?\b|auth\b|whoami\b|config\b|login\b|logout\b|completion\b)\b/;

function hasCanonicalDispatchPrefix(cmd) {
  // Accept any of: `node scripts/dispatch-agent.js`, `node "…/dispatch-agent.js"`,
  // `node ${CLAUDE_PROJECT_DIR}/scripts/dispatch-agent.js`. The orchestrator
  // specs use all three forms.
  return /node\s+\S*(?:["'`])?[^"'`\s]*dispatch-agent\.js\b/.test(cmd);
}

function isClaudeAgentInvocation(slice) {
  // `claude -p … --agent <role>` is the documented fallback path used by
  // Gamma/Delta. Allow when `--agent` is present *anywhere* after `-p`.
  return /\bclaude\s+-p\b[\s\S]*\B--agent\b/.test(slice);
}

/**
 * Walk the command string and find the first forbidden pattern. Returns null
 * when the command is safe.
 */
function findForbidden(rawCmd) {
  const cmd = rawCmd.replace(/\r?\n/g, " ").trim();
  if (!cmd) return null;
  if (hasCanonicalDispatchPrefix(cmd)) return null;

  // Pipe-into-provider: `cat foo.txt | codex exec …` / `… | gemini -p` etc.
  // The pipe alone isn't forbidden — piping codex *output* to grep is fine —
  // we forbid piping INTO codex/gemini/claude prompt mode.
  const pipeMatch = cmd.match(/\|\s*(codex|gemini|claude)\b([^|]*)$/);
  if (pipeMatch) {
    const [, provider, tail] = pipeMatch;
    if (SAFE_PROVIDER_TAILS.test(tail)) return null;
    return {
      pattern: `cat … | ${provider} …`,
      detail:
        "piping into a cross-provider CLI as prompt input bypasses the dispatch wrapper",
    };
  }

  // Bare `codex exec` not in dispatch-agent.
  if (/\bcodex\s+exec\b/.test(cmd)) {
    return {
      pattern: "codex exec …",
      detail:
        "codex exec must go through node scripts/dispatch-agent.js so the Windows-stdin + concurrency-lock layer applies",
    };
  }

  // `gemini … -p` (prompt invocation). Allow when next arg after gemini is a
  // safe tail.
  const geminiMatch = cmd.match(/\bgemini\b\s*([\s\S]*)$/);
  if (geminiMatch) {
    const tail = geminiMatch[1];
    if (SAFE_PROVIDER_TAILS.test(tail)) {
      // safe form — version/help/etc.
    } else if (/(?:^|\s)-p\b/.test(tail)) {
      return {
        pattern: "gemini … -p …",
        detail:
          "gemini prompt invocations must go through node scripts/dispatch-agent.js",
      };
    }
  }

  // `claude -p` — only forbidden when not the documented `--agent <role>`
  // fallback form.
  const claudeMatch = cmd.match(/\bclaude\s+-p\b[\s\S]*$/);
  if (claudeMatch) {
    const slice = claudeMatch[0];
    if (!isClaudeAgentInvocation(slice)) {
      // Allow `claude -p --help` etc.
      if (!SAFE_PROVIDER_TAILS.test(slice.replace(/^\s*claude\s+-p\s*/, ""))) {
        return {
          pattern: "claude -p …",
          detail:
            "raw `claude -p` prompt invocation is forbidden; use `claude -p --agent <role>` (documented fallback) or node scripts/dispatch-agent.js",
        };
      }
    }
  }

  return null;
}

// --- Hook plumbing --------------------------------------------------------

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    if (event.tool_name !== "Bash") process.exit(0);
    if (event.tool_response !== undefined) process.exit(0); // PostToolUse skip
    const cmd = ((event.tool_input || {}).command || "").trim();
    if (!cmd) process.exit(0);

    if (probeBypass(cmd)) process.exit(0);

    const hit = findForbidden(cmd);
    if (!hit) process.exit(0);

    const guidePathHint = path.posix.join(
      ".claude",
      "project",
      "reference",
      "agent-dispatch-guide.md",
    );
    block(
      [
        "[dispatch-route-guard] Direct cross-provider CLI prompt invocation is forbidden.",
        `Pattern matched: ${hit.pattern}`,
        `Detail: ${hit.detail}`,
        "",
        "Use:  node scripts/dispatch-agent.js <role> <prompt-file>",
        "Why:  raw provider prompt calls re-trigger known stdin/binding failures",
        "      (LRN-2026-04-17 Windows-stdin; LRN-2026-04-30 binding-gap).",
        "",
        "One-shot bypass for an approved provider-health probe:",
        "  PowerShell: $env:WARPOS_PROVIDER_PROBE = '1'; <command>; Remove-Item Env:WARPOS_PROVIDER_PROBE",
        "  bash:       WARPOS_PROVIDER_PROBE=1 <command>   (note: bash-inline env",
        "              may not propagate to PreToolUse hooks; prefer harness env)",
        "",
        `Full rules: ${guidePathHint} (paths.agentDispatchGuide).`,
      ].join("\n"),
    );
  } catch {
    // Fail-open on hook bugs / malformed JSON.
    process.exit(0);
  }
});

module.exports = { findForbidden };
