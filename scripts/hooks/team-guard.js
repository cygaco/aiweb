#!/usr/bin/env node
// PreToolUse hook: enforces two-tier agent spawning in adhoc mode.
//
// Layer 1 (teammates): Beta (β) + Gamma (γ) ONLY.
// Alpha-allowed (research/cognition): Explore, Plan, general-purpose
// Gamma-only (build/execution): builder, fixer, evaluator, compliance,
//   auditor, qa, redteam, gamma, delta
//
// This restriction ONLY applies during mode:adhoc (active team session).
// Solo mode = no restrictions.

const fs = require("fs");
const path = require("path");

// Build-chain agent types that only Gamma should dispatch
const GAMMA_ONLY_TYPES = new Set([
  "builder",
  "fixer",
  "fix-agent",
  "evaluator",
  "compliance",
  "auditor",
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

    // Debug log
    const logPath = path.resolve(
      __dirname,
      "..",
      "..",
      ".claude",
      "logs",
      "team-guard-debug.log",
    );
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

    // Only check Agent tool
    if (toolName !== "Agent") {
      process.exit(0);
    }

    const toolInput = event.tool_input || {};
    const agentType = (toolInput.subagent_type || "").toLowerCase();
    const agentName = (toolInput.name || "").toLowerCase();

    // Always allow Beta and Gamma teammates
    const isTeammateType = TEAMMATE_TYPES.has(agentType);
    const isTeammateName = TEAMMATE_NAMES.some((n) => agentName.includes(n));
    if (isTeammateType || isTeammateName) {
      process.exit(0);
    }

    // Check if we're in adhoc mode (team session active + same session)
    // Directory existence alone is insufficient — it persists after crashes.
    // smart-context.js writes heartbeat.json with the current session ID.
    // If the session ID doesn't match, this is a stale team from a crashed session.
    const adhocDir = path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".claude",
      "teams",
      "adhoc",
    );
    let inAdhocMode = false;
    try {
      if (fs.existsSync(adhocDir)) {
        const hbPath = path.join(adhocDir, "heartbeat.json");
        const sidPath = path.join(
          process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", ".."),
          ".claude",
          "runtime",
          ".session-id",
        );
        if (fs.existsSync(hbPath) && fs.existsSync(sidPath)) {
          const hb = JSON.parse(fs.readFileSync(hbPath, "utf8"));
          const currentSid = fs.readFileSync(sidPath, "utf8").trim();
          inAdhocMode = hb.sessionId === currentSid;
        }
        // No heartbeat file = team just created, not yet pulsed — allow restriction
        // (first prompt after /mode:adhoc writes the heartbeat)
        else if (!fs.existsSync(hbPath)) {
          inAdhocMode = true;
        }
      }
    } catch {
      // Filesystem error = assume not in team mode
    }

    if (!inAdhocMode) {
      // Solo mode — no restrictions
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
          `Gamma dispatches: builder, fixer, evaluator, compliance, auditor, qa, redteam.`,
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
