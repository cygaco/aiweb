/**
 * skill-telemetry.js — Helpers for the skill-suggested-vs-invoked event type.
 *
 * Per copy.md C-4 (SP-20260513-003):
 *   {
 *     "ts": "ISO8601",
 *     "type": "skill-suggested-vs-invoked",
 *     "category": "skill-adherence",
 *     "session_id": "...",
 *     "prompt_hash": "<md5 first 12 of stripped prompt>",
 *     "phase": "suggested" | "invoked",
 *     "skill_id": "<slug>",
 *     "score": 0.0-1.0,        // suggested only
 *     "rank": 1-3,              // suggested only
 *     "turn_offset": 0+,        // invoked only
 *     "invocation_path": "ranker" | "agent-tool" | "user-slash"  // invoked only
 *   }
 *
 * One event per skill (not per turn) — makes downstream join trivial.
 *
 * Fail-open: any error writes to paths.logs/<sessionId>/telemetry-fail.log
 * and returns false. Callers should NEVER throw on telemetry failure.
 *
 * Enabled by default; disable via SKILL_TELEMETRY_ENABLED=0.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PROJECT, PATHS } = require("./paths");
const { log, getSessionId } = require("./logger");

const TELEMETRY_DISABLED = process.env.SKILL_TELEMETRY_ENABLED === "0";

function hashPrompt(stripped) {
  return crypto
    .createHash("md5")
    .update(String(stripped || ""))
    .digest("hex")
    .slice(0, 12);
}

function writeFailLog(reason, payload) {
  try {
    const sid = getSessionId();
    const dir = path.join(PROJECT, PATHS.logs || ".claude/runtime/logs", sid);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "telemetry-fail.log");
    const line =
      `[${new Date().toISOString()}] ` +
      `${reason}: ${JSON.stringify(payload).slice(0, 400)}\n`;
    fs.appendFileSync(file, line, "utf8");
  } catch {
    /* never block — telemetry is best-effort */
  }
}

/**
 * Validate the common fields shared by `suggested` and `invoked`.
 * Returns null when valid, or a string error reason.
 */
function validateBase(data) {
  if (!data || typeof data !== "object") return "non-object payload";
  if (data.phase !== "suggested" && data.phase !== "invoked")
    return `bad phase: ${data.phase}`;
  if (typeof data.skill_id !== "string" || !data.skill_id)
    return "missing skill_id";
  if (typeof data.prompt_hash !== "string" || !data.prompt_hash)
    return "missing prompt_hash";
  return null;
}

/**
 * logSkillSuggested — emit one `skill-suggested-vs-invoked` event with phase=suggested.
 *
 * @param {object} entry
 * @param {string} entry.skill_id  - slug, e.g. "fix:fast"
 * @param {string} entry.prompt_hash - md5 first 12 of stripped prompt
 * @param {number} entry.score - 0.0–1.0 ranker relevance score
 * @param {number} entry.rank  - 1-based position in the suggested set
 * @returns {boolean} true if logged, false if telemetry failed (never throws)
 */
function logSkillSuggested(entry) {
  if (TELEMETRY_DISABLED) return false;
  const payload = {
    type: "skill-suggested-vs-invoked",
    category: "skill-adherence",
    session_id: getSessionId(),
    prompt_hash: entry && entry.prompt_hash,
    phase: "suggested",
    skill_id: entry && entry.skill_id,
    score: typeof entry?.score === "number" ? entry.score : null,
    rank: typeof entry?.rank === "number" ? entry.rank : null,
  };
  const reason = validateBase(payload);
  if (reason) {
    writeFailLog(reason, payload);
    return false;
  }
  try {
    log("audit", payload, { actor: "smart-context" });
    return true;
  } catch (e) {
    writeFailLog(`log-throw: ${String(e).slice(0, 200)}`, payload);
    return false;
  }
}

/**
 * logSkillInvoked — emit one `skill-suggested-vs-invoked` event with phase=invoked.
 *
 * @param {object} entry
 * @param {string} entry.skill_id - slug, e.g. "fix:fast"
 * @param {string} entry.prompt_hash - md5 first 12 of stripped prompt
 * @param {number} entry.turn_offset - turns since the matching `suggested` event for this prompt_hash
 * @param {"ranker"|"agent-tool"|"user-slash"} entry.invocation_path - origin discriminator
 * @returns {boolean} true if logged, false if telemetry failed
 */
function logSkillInvoked(entry) {
  if (TELEMETRY_DISABLED) return false;
  const payload = {
    type: "skill-suggested-vs-invoked",
    category: "skill-adherence",
    session_id: getSessionId(),
    prompt_hash: entry && entry.prompt_hash,
    phase: "invoked",
    skill_id: entry && entry.skill_id,
    turn_offset:
      typeof entry?.turn_offset === "number" ? entry.turn_offset : null,
    invocation_path:
      entry && entry.invocation_path ? String(entry.invocation_path) : null,
  };
  const reason = validateBase(payload);
  if (reason) {
    writeFailLog(reason, payload);
    return false;
  }
  if (
    payload.invocation_path !== "ranker" &&
    payload.invocation_path !== "agent-tool" &&
    payload.invocation_path !== "user-slash"
  ) {
    writeFailLog(`bad invocation_path: ${payload.invocation_path}`, payload);
    return false;
  }
  try {
    log("audit", payload, { actor: "skill-invocation-tracker" });
    return true;
  } catch (e) {
    writeFailLog(`log-throw: ${String(e).slice(0, 200)}`, payload);
    return false;
  }
}

module.exports = {
  hashPrompt,
  logSkillSuggested,
  logSkillInvoked,
  TELEMETRY_DISABLED,
};
