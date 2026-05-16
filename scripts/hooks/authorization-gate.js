#!/usr/bin/env node
/**
 * authorization-gate.js — PreToolUse hook that short-circuits downstream
 * guards when an active `/turbo` authorization covers the tool call.
 *
 * Pairs with `scripts/turbo/apply.js`. Reads `paths.runtime/authorization.json`
 * (schema warpos/auth/v1). If absent, expired, or scope-mismatched: no-op
 * pass-through. Existing BLOCK guards run untouched.
 *
 * When scope matches AND not in safety floor:
 *   - Emit `auth-bypass` audit event
 *   - stdout: { "decision": "approve", "reason": "[turbo] scope=<s> ttl_min_remaining=<n>" }
 *
 * The Claude Code PreToolUse contract treats `decision: "approve"` as a
 * positive signal to skip subsequent guards in the chain. This hook is
 * registered FIRST in the PreToolUse hook chain, so an approve short-circuits
 * the rest.
 *
 * Safety floor (ALWAYS blocked, regardless of --scope all):
 *   - `git push --force` (any remote/branch)
 *   - `git push *` to backup/* or pre-* branches deleted
 *   - `git branch -D backup/*` / `git branch -D pre-*`
 *
 * Fail-open: any error in this hook → no-op pass-through. Never block.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const PROJECT = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());

// ── Load PATHS registry (best-effort) ──────────────────────
let PATHS = {};
try {
  const raw = JSON.parse(
    fs.readFileSync(path.join(PROJECT, ".claude", "paths.json"), "utf8"),
  );
  PATHS = Object.fromEntries(
    Object.entries(raw)
      .filter(([k]) => k !== "version" && k !== "$schema")
      .map(([k, v]) => [k, path.join(PROJECT, v)]),
  );
} catch {
  /* registry optional */
}

const RUNTIME_DIR = PATHS.runtime || path.join(PROJECT, ".claude", "runtime");
const AUTH_PATH = path.join(RUNTIME_DIR, "authorization.json");

// Logger is best-effort.
let logEvent = null;
try {
  ({ logEvent } = require("./lib/logger"));
} catch {
  /* logger optional */
}

function emitAuthBypassEvent(payload) {
  if (!logEvent) return;
  try {
    logEvent(
      "auth-bypass",
      "turbo",
      "auth-bypass",
      payload.tool || "",
      `scope=${payload.scope} pattern=${payload.pattern} ttl_remaining_min=${payload.ttl_remaining_min}`,
      payload,
    );
  } catch {
    /* swallow */
  }
}

// ── Scope matchers — same vocab as scripts/turbo/apply.js ──
//
// Each matcher inspects the PreToolUse event and returns:
//   { scope: <string>, pattern: <human-readable> } when matched
//   null when not relevant to this scope
//
// All matchers are pure functions of `tool_name` + `tool_input`. Order
// doesn't matter — we test all in sequence and take the FIRST hit.
function matchManifestEdit(toolName, ti) {
  if (toolName !== "Edit" && toolName !== "Write") return null;
  const fp = String(ti.file_path || "").replace(/\\/g, "/");
  if (fp.endsWith(".claude/manifest.json") || fp === ".claude/manifest.json") {
    return {
      scope: "manifest-edit",
      pattern: `${toolName}(.claude/manifest.json)`,
    };
  }
  return null;
}

function matchWriteJsonl(toolName, ti) {
  if (toolName !== "Write" && toolName !== "Edit") return null;
  const fp = String(ti.file_path || "").replace(/\\/g, "/");
  if (/\.jsonl$/.test(fp)) {
    return {
      scope: "write-jsonl",
      pattern: `${toolName}(${fp.split("/").pop()})`,
    };
  }
  return null;
}

function matchNodeEFs(toolName, ti) {
  if (toolName !== "Bash") return null;
  const cmd = String(ti.command || "");
  if (!/^\s*node\s+-e\b/.test(cmd)) return null;
  if (
    /fs\.(writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync)/.test(cmd)
  ) {
    return { scope: "node-e-fs", pattern: "Bash(node -e *fs.*Sync*)" };
  }
  return null;
}

function matchDestructiveGit(toolName, ti) {
  if (toolName !== "Bash") return null;
  const cmd = String(ti.command || "");
  if (/\bgit\s+rm\s+--cached\b/.test(cmd)) {
    return { scope: "destructive-git", pattern: "Bash(git rm --cached *)" };
  }
  if (/\bgit\s+reset\s+--hard\b/.test(cmd)) {
    return { scope: "destructive-git", pattern: "Bash(git reset --hard *)" };
  }
  if (/\bgit\s+restore\b/.test(cmd)) {
    return { scope: "destructive-git", pattern: "Bash(git restore *)" };
  }
  return null;
}

function matchWorktreeOps(toolName, ti) {
  if (toolName !== "Bash") return null;
  const cmd = String(ti.command || "");
  if (/\bgit\s+worktree\s+(add|remove|prune|move)\b/.test(cmd)) {
    return { scope: "worktree-ops", pattern: "Bash(git worktree *)" };
  }
  return null;
}

function matchPushToMain(toolName, ti) {
  if (toolName !== "Bash") return null;
  const cmd = String(ti.command || "");
  // Match `git push <remote> main`, `git push origin main`, `git push origin HEAD:main`
  if (
    /\bgit\s+push\b/.test(cmd) &&
    /\bmain\b/.test(cmd) &&
    !/--force/.test(cmd)
  ) {
    return { scope: "push-to-main", pattern: "Bash(git push * main)" };
  }
  return null;
}

const MATCHERS = [
  matchManifestEdit,
  matchWriteJsonl,
  matchNodeEFs,
  matchDestructiveGit,
  matchWorktreeOps,
  matchPushToMain,
];

// ── Safety floor: ALWAYS blocked regardless of scope ───────
//
// These checks return `true` if the command/edit is in the floor and MUST
// pass through to downstream guards (i.e., this hook will NOT emit approve).
// The downstream guards are responsible for the actual block decision.
function isInSafetyFloor(toolName, ti) {
  if (toolName !== "Bash") return false;
  const cmd = String(ti.command || "");
  // 1. git push --force to main (or any --force-with-lease to main)
  if (
    /\bgit\s+push\b/.test(cmd) &&
    /\bmain\b/.test(cmd) &&
    /--force/.test(cmd)
  ) {
    return true;
  }
  // 2. Backup branch / pre-* branch deletion
  if (/\bgit\s+branch\s+-D\s+(backup\/|pre-)/.test(cmd)) {
    return true;
  }
  if (/\bgit\s+push\s+\S+\s+--delete\s+(backup\/|pre-)/.test(cmd)) {
    return true;
  }
  return false;
}

// ── Read + validate authorization.json ─────────────────────
function readAuth() {
  try {
    if (!fs.existsSync(AUTH_PATH)) return null;
    const auth = JSON.parse(fs.readFileSync(AUTH_PATH, "utf8"));
    if (!auth || auth.schema !== "warpos/auth/v1") return null;
    if (!Array.isArray(auth.scopes)) return null;
    if (!auth.expires_at) return null;
    const ms = new Date(auth.expires_at).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return null; // expired
    auth._ttl_remaining_min = Math.max(0, Math.floor(ms / 60000));
    return auth;
  } catch {
    return null;
  }
}

// ── Main: read stdin event, decide ─────────────────────────
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const auth = readAuth();
    if (!auth) {
      process.exit(0); // no-op pass-through (no auth, or expired)
    }

    let event;
    try {
      event = JSON.parse(input || "{}");
    } catch {
      process.exit(0); // malformed input — pass through, fail-open
    }
    const toolName = event.tool_name || "";
    const ti = event.tool_input || {};

    // Safety floor check first — if this is a forbidden action, never approve.
    if (isInSafetyFloor(toolName, ti)) {
      process.exit(0);
    }

    // Find the first matching scope.
    let match = null;
    for (const m of MATCHERS) {
      const r = m(toolName, ti);
      if (r) {
        match = r;
        break;
      }
    }
    if (!match) {
      process.exit(0); // unrelated tool call — pass through
    }

    // Is the matched scope authorized?
    if (!auth.scopes.includes(match.scope)) {
      process.exit(0); // scope not granted — pass through
    }

    // Approved. Emit audit event + tell harness to skip downstream guards.
    emitAuthBypassEvent({
      type: "auth-bypass",
      action: "auth-bypass",
      scope: match.scope,
      tool: toolName,
      pattern: match.pattern,
      ttl_remaining_min: auth._ttl_remaining_min,
      file_path: ti.file_path || null,
    });

    process.stdout.write(
      JSON.stringify({
        decision: "approve",
        reason: `[turbo] scope=${match.scope} ttl_remaining_min=${auth._ttl_remaining_min}`,
      }) + "\n",
    );
    process.exit(0);
  } catch {
    // Fail-open: never block on hook error.
    process.exit(0);
  }
});

// Edge case: stdin closed with no data — exit cleanly.
process.stdin.on("error", () => process.exit(0));
