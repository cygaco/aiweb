#!/usr/bin/env node
// PreToolUse hook: enforces two-tier agent spawning in adhoc mode.
//
// Layer 1 (teammates): Beta (β) + Gamma (γ) ONLY.
// Alpha-allowed (research/cognition): Explore, Plan, general-purpose
// Gamma-only (build/execution): builder, fixer, reviewer, compliance,
//   learner, qa, redteam, gamma, delta
//
// This restriction ONLY applies during mode:adhoc (active team session).
// Solo mode = no restrictions.

const fs = require("fs");
const path = require("path");

// Build-chain agent types that only Gamma should dispatch
// Includes both canonical names (reviewer, learner) and legacy aliases
// (evaluator, auditor) to keep historical/external dispatchers working
// during the 2026-04-29 rename transition.
const GAMMA_ONLY_TYPES = new Set([
  "builder",
  "fixer",
  "fix-agent",
  "reviewer",
  "evaluator", // legacy alias
  "compliance",
  "learner",
  "auditor", // legacy alias
  "qa",
  "redteam",
  "delta",
]);

// Agent names/types that are allowed as teammates (Layer 1)
const TEAMMATE_NAMES = ["beta", "gamma", "β", "γ"];
const TEAMMATE_TYPES = new Set(["beta", "gamma"]);

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const toolName = event.tool_name;

    // Debug log — wrapped in its own try/catch so a filesystem failure here
    // CANNOT silently disable the guard. RT-013: previously this write
    // targeted .claude/logs/ (which doesn't exist in most projects), threw
    // ENOENT, hit the outer catch, and exited 0 — silently permitting every
    // build-chain dispatch throughout any adhoc session. Never again.
    try {
      const logDir = path.resolve(__dirname, "..", "..", ".claude", "runtime");
      fs.mkdirSync(logDir, { recursive: true });
      const logPath = path.join(logDir, "team-guard-debug.log");
      fs.appendFileSync(
        logPath,
        JSON.stringify({
          ts: new Date().toISOString(),
          toolName,
          keys: Object.keys(event.tool_input || {}),
          team_name: (event.tool_input || {}).team_name,
          name: (event.tool_input || {}).name,
          subagent_type: (event.tool_input || {}).subagent_type,
        }) + "\n",
      );
    } catch {
      // Debug failures must never disable the guard.
    }

    // Only check Agent tool
    if (toolName !== "Agent") {
      process.exit(0);
    }

    const toolInput = event.tool_input || {};
    const agentType = (toolInput.subagent_type || "").toLowerCase();
    const agentName = (toolInput.name || "").toLowerCase();

    // Always allow Beta and Gamma teammates.
    // Name check uses exact-match-after-normalize (strip parens/spaces) so
    // that "Beta (β)" resolves to "beta" but a sneaky "beta-builder" does
    // not. Previous `includes()` was a bypass path for build-chain calls.
    const isTeammateType = TEAMMATE_TYPES.has(agentType);
    const normalizedName = agentName.replace(/[\s()\[\]]+/g, "");
    const isTeammateName = TEAMMATE_NAMES.includes(normalizedName);
    if (isTeammateType || isTeammateName) {
      process.exit(0);
    }

    // Mode resolution — check mode.json FIRST. RT-013 follow-up: previously
    // this only checked ~/.claude/teams/adhoc/ which persists across mode
    // switches. If user ran /mode:adhoc then /mode:oneshot, the adhoc
    // heartbeat lingered and Delta would get blocked from dispatching
    // builders — halting run-10 at Phase 2 with a cryptic team-guard
    // message. Fix: read the authoritative mode marker first.
    const projectDir =
      process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
    const modePath = path.join(projectDir, ".claude", "runtime", "mode.json");

    let currentMode = null;
    try {
      if (fs.existsSync(modePath)) {
        const modeDoc = JSON.parse(fs.readFileSync(modePath, "utf8"));
        currentMode = (modeDoc.mode || "").toLowerCase();
      }
    } catch {
      // Malformed mode.json = fall through to adhoc heartbeat check
    }

    // Oneshot mode: Delta IS the orchestrator and must dispatch the full
    // build chain. Allow everything. Context-overfill protection is a
    // prompt-shape concern (JSON envelope constraint in builder prompts),
    // not a dispatch-permission concern — enforced elsewhere.
    if (currentMode === "oneshot") {
      process.exit(0);
    }

    // Solo mode: explicit opt-out of restrictions.
    if (currentMode === "solo") {
      process.exit(0);
    }

    // Adhoc mode: either explicit mode.json or the legacy heartbeat check.
    // Directory existence alone is insufficient — it persists after crashes.
    // smart-context.js writes heartbeat.json with the current session ID.
    // If the session ID doesn't match, this is a stale team from a crash.
    let inAdhocMode = currentMode === "adhoc";
    if (!inAdhocMode) {
      const adhocDir = path.join(
        process.env.HOME || process.env.USERPROFILE || "",
        ".claude",
        "teams",
        "adhoc",
      );
      try {
        if (fs.existsSync(adhocDir)) {
          const hbPath = path.join(adhocDir, "heartbeat.json");
          const sidPath = path.join(
            projectDir,
            ".claude",
            "runtime",
            ".session-id",
          );
          if (fs.existsSync(hbPath) && fs.existsSync(sidPath)) {
            const hb = JSON.parse(fs.readFileSync(hbPath, "utf8"));
            const currentSid = fs.readFileSync(sidPath, "utf8").trim();
            inAdhocMode = hb.sessionId === currentSid;
          } else if (!fs.existsSync(hbPath)) {
            // No heartbeat file = team just created, not yet pulsed.
            inAdhocMode = true;
          }
        }
      } catch {
        // Filesystem error = assume not in team mode
      }
    }

    if (!inAdhocMode) {
      // Solo mode (implicit) — no restrictions
      process.exit(0);
    }

    // In adhoc mode: block build-chain agents
    if (GAMMA_ONLY_TYPES.has(agentType)) {
      const result = {
        decision: "block",
        reason:
          `[team-guard] Agent type "${agentType}" is build-chain — ` +
          `route through Gamma (γ) in adhoc mode. ` +
          `Alpha can spawn: Explore, Plan, general-purpose. ` +
          `Gamma dispatches: builder, fixer, reviewer, compliance, learner, qa, redteam.`,
      };
      process.stdout.write(JSON.stringify(result));
      process.exit(0);
    }

    // Research agents (Explore, Plan, general-purpose, etc.) — allowed
    process.exit(0);
  } catch (err) {
    // Don't block on infrastructure errors
    process.exit(0);
  }
});
