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

// Release-context keywords. When a question matches AND there's no recent
// Beta consultation, we BLOCK (not warn). Source: /check:patterns 2026-05-13
// (15x/day release-time bypass) + CLAUDE.md §"β consultation protocol".
// Note: "deploy" was removed from ESCAPE_KEYWORDS above so it now triggers
// the release-context gate instead of bypassing Beta entirely.
const RELEASE_CONTEXT_KEYWORDS = [
  "release",
  "rl-",
  "deploy",
  "ship",
  "rollback",
  "/sprint:release",
  "production deploy",
  "production approval",
];

// Window for a "recent" Beta consultation to satisfy the release pre-flight.
const BETA_CONSULTATION_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

function isReleaseContext(text) {
  const lower = (text || "").toLowerCase();
  return RELEASE_CONTEXT_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Check paths.betaEvents for a Beta consultation event in the last
 * BETA_CONSULTATION_WINDOW_MS whose question or topic_tags reference
 * release context. Returns true if found, false otherwise. Fail-open
 * on any read/parse error (so a broken events file never deadlocks
 * a release).
 */
function hasRecentReleaseBetaConsultation() {
  try {
    const projectDir =
      process.env.CLAUDE_PROJECT_DIR ||
      path.resolve(__dirname, "..", "..", "..");
    // Load paths.json to find betaEvents path
    let betaEventsRel = ".claude/agents/00-alex/.system/beta/events.jsonl";
    try {
      const pj = JSON.parse(
        fs.readFileSync(path.join(projectDir, ".claude", "paths.json"), "utf8"),
      );
      if (pj.betaEvents) betaEventsRel = pj.betaEvents;
    } catch {
      /* default ok */
    }
    const eventsPath = path.join(projectDir, betaEventsRel);
    if (!fs.existsSync(eventsPath)) return false;
    const raw = fs.readFileSync(eventsPath, "utf8");
    const lines = raw.trim().split(/\r?\n/).filter(Boolean);
    const cutoff = Date.now() - BETA_CONSULTATION_WINDOW_MS;
    // Scan from newest to oldest — most events are appended chronologically.
    for (let i = lines.length - 1; i >= 0; i--) {
      let row;
      try {
        row = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      const ts = Date.parse(row.ts || "");
      if (!Number.isFinite(ts)) continue;
      if (ts < cutoff) break; // older than window — give up
      const data = row.data || {};
      const text = (
        (data.question || "") +
        " " +
        (data.answer || "") +
        " " +
        (data.topic_tags || []).join(" ")
      ).toLowerCase();
      if (
        RELEASE_CONTEXT_KEYWORDS.some((kw) => text.includes(kw)) ||
        (data.phase || "").toLowerCase() === "release"
      ) {
        return true;
      }
    }
    return false;
  } catch {
    return false; // fail-open
  }
}

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

      // Release-context gate. If the question is release-flavored AND there
      // is no recent Beta consultation matching that context, BLOCK with
      // release-specific guidance. Source: /check:patterns 2026-05-13
      // (15x/day release-time bypass). The release.md skill now requires
      // a Step-0 SendMessage to Beta before reaching this hook.
      if (isReleaseContext(question)) {
        if (!hasRecentReleaseBetaConsultation()) {
          logEvent(
            "block",
            "system",
            "beta-gate-release-blocked",
            question.slice(0, 80),
            "No release-context Beta event in last 30min",
          );
          const result = {
            decision: "block",
            reason:
              "[beta-gate] Release-context question detected with no recent Beta consultation. " +
              "Required: SendMessage(to: 'Beta (β)', message: 'Release pre-flight for <sprint/RL-id>. <context>. Verdict?'). " +
              "Beta event must mention 'release', 'deploy', 'ship', 'rollback', or 'RL-' (last 30min). " +
              "If Beta returns ESCALATE, prefix the AskUserQuestion text with 'ESCALATE:' to pass through. " +
              "See .claude/commands/sprint/release.md Step 0 and CLAUDE.md §'β consultation protocol'.",
          };
          process.stdout.write(JSON.stringify(result));
          process.exit(0);
          return;
        }
        // Release context AND Beta was consulted recently → allow + audit-log
        logEvent(
          "audit",
          "system",
          "beta-gate-release-pass",
          question.slice(0, 80),
          "recent-beta-release-consultation",
        );
        process.exit(0);
        return;
      }

      // Block — Alex β should be consulted first
      // L-2026-05-14-event-beta-gate-blank-target: when AskUserQuestion's
      // `questions` array is empty or missing, the prior `question` join was
      // "" → blank target → 80% of blocks (16/20 in 3d) lost their audit
      // signal. Fall back to a summary of the tool_input so retrospective
      // forensics can attribute the "why".
      const target =
        (question && question.slice(0, 80)) ||
        (event.tool_input
          ? `[no question text — tool_input keys: ${Object.keys(event.tool_input).join(",")}]`
          : "[no tool_input]");
      logEvent(
        "block",
        "system",
        "beta-gate-blocked",
        target,
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
