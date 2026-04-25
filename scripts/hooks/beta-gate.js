#!/usr/bin/env node

/**
 * beta-gate.js — Enforces Alex β consultation before AskUserQuestion
 *
 * PreToolUse hook on AskUserQuestion.
 * In adhoc mode (active team session): blocks unless the question has an
 * ESCALATE: prefix (meaning Alex β already escalated) or matches the
 * direct-to-user escape hatch list.
 * In solo mode: allows freely (no Beta to consult).
 *
 * Uses session-identity check (same as team-guard.js) — survives crashes,
 * no TTL issues.
 *
 * Fail-open on parse errors — never crash the session.
 */

const fs = require("fs");
const path = require("path");
const { logEvent } = require("./lib/logger");

// Keywords that indicate direct-to-user is correct (skip Alex β)
const ESCAPE_KEYWORDS = [
  "ESCALATE:",
  "irreversible",
  "delete all",
  "drop table",
  "push to remote",
  "deploy",
  "publish",
  "credential",
  "secret",
  "password",
  "api key",
  "sign up",
  "purchase",
];

// Spend pattern: "$" followed by digits
const SPEND_PATTERN = /\$\d+/;

/**
 * Check if an adhoc team session is active (same session identity).
 * Returns true only if ~/.claude/teams/adhoc/ exists AND the heartbeat
 * session ID matches the current session.
 */
function isAdhocActive() {
  try {
    const adhocDir = path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".claude",
      "teams",
      "adhoc",
    );
    if (!fs.existsSync(adhocDir)) return false;

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
      return hb.sessionId === currentSid;
    }

    // No heartbeat = team just created, not yet pulsed — treat as active
    if (!fs.existsSync(hbPath)) return true;

    return false;
  } catch {
    return false;
  }
}

function main() {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => {
    try {
      // Solo mode — no Beta to consult, allow freely
      if (!isAdhocActive()) {
        process.exit(0);
        return;
      }

      const event = JSON.parse(input);
      // AskUserQuestion uses `questions` (array), each with a `.question` field
      const questions = event.tool_input?.questions || [];
      const question = Array.isArray(questions)
        ? questions.map((q) => q.question || "").join(" ")
        : event.tool_input?.question || "";
      const questionLower = question.toLowerCase();

      // Check escape hatches
      const hasEscape = ESCAPE_KEYWORDS.some(
        (kw) =>
          question.includes(kw) || questionLower.includes(kw.toLowerCase()),
      );
      const hasSpend = SPEND_PATTERN.test(question);

      if (hasEscape || hasSpend) {
        // Allow through — this is a valid direct-to-user question
        logEvent(
          "audit",
          "system",
          "beta-gate-pass",
          question.slice(0, 80),
          hasEscape ? "escape-keyword" : "spend-signal",
        );
        process.exit(0);
        return;
      }

      // Block — Alex β should be consulted first
      logEvent(
        "block",
        "system",
        "beta-gate-blocked",
        question.slice(0, 80),
        "Alex β not consulted",
      );
      const result = {
        decision: "block",
        reason:
          "[beta-gate] Consult Alex β before asking the user. " +
          "Route: SendMessage(to: 'Beta (β)', message: '<your question>'). " +
          "If Alex β returns ESCALATE, prefix with 'ESCALATE:' to pass through. " +
          "See CLAUDE.md §4.",
      };
      process.stdout.write(JSON.stringify(result));
      process.exit(0);
    } catch {
      // Fail-open on parse errors
      process.exit(0);
    }
  });
}

main();
