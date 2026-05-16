#!/usr/bin/env node

/**
 * skill-invocation-tracker.js — PreToolUse hook that emits a
 * `skill-suggested-vs-invoked` event with phase=invoked whenever a slash
 * command is about to fire.
 *
 * Sources of invocation we recognise:
 *   - User typed `/foo:bar` themselves — `invocation_path: "user-slash"`
 *   - Agent invoked a skill that smart-context.js had suggested via
 *     `SUGGESTED SKILLS:` — `invocation_path: "ranker"` with turn_offset
 *   - Anything else (agent invoked a slash command that wasn't suggested) —
 *     `invocation_path: "agent-tool"`
 *
 * Fires on PreToolUse with matcher "SlashCommand" (the Claude Code built-in
 * slash-command tool) AND on PreToolUse with matcher "Skill" (the Skill tool).
 * Both shapes are handled defensively.
 *
 * Fail-open by design: any error returns exit 0 and writes to telemetry-fail.log.
 * Never blocks the tool call.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { PROJECT, PATHS } = require("./lib/paths");
const { getSessionId, query } = require("./lib/logger");
const {
  logSkillInvoked,
  hashPrompt,
  TELEMETRY_DISABLED,
} = require("./lib/skill-telemetry");

// ── stdin reader ────────────────────────────────────────

function readStdinJson() {
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (buf += c));
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(buf));
      } catch {
        resolve(null);
      }
    });
    if (process.stdin.isTTY) resolve(null);
  });
}

// ── Extract the slug being invoked ──────────────────────

function extractSlug(event) {
  if (!event || !event.tool_input) return null;
  const ti = event.tool_input;
  // SlashCommand shape: { command: "/foo:bar args..." }
  if (typeof ti.command === "string") {
    const m = ti.command.match(
      /^\/([A-Za-z][A-Za-z0-9_-]*(?::[A-Za-z][A-Za-z0-9_-]*)?)/,
    );
    if (m) return m[1];
  }
  // Skill tool shape: { skill: "foo:bar", args: "..." }
  if (typeof ti.skill === "string") {
    return ti.skill.replace(/^\//, "");
  }
  // Fallback heuristics
  if (typeof ti.name === "string") {
    return ti.name.replace(/^\//, "");
  }
  return null;
}

// ── Recent prompt lookup (user-slash detection) ─────────

function recentUserPrompt(sessionId) {
  try {
    const rows = query({ cat: "prompt", session: sessionId, limit: 1 });
    if (!rows || rows.length === 0) return null;
    return rows[rows.length - 1];
  } catch {
    return null;
  }
}

function stripSystemTagsLocal(text) {
  return String(text || "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "")
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, "")
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, "")
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, "")
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
    .trim();
}

// Was the most recent user prompt a literal slash command for this slug?
function isUserSlashFor(slug, recentPromptRow) {
  if (!recentPromptRow || !recentPromptRow.data) return false;
  const d = recentPromptRow.data;
  if (!d.is_slash) return false;
  const stripped = stripSystemTagsLocal(d.raw || d.stripped || "");
  if (!stripped.startsWith("/")) return false;
  // Match `/foo:bar` or `/foo` (we already extract slug as namespaced form)
  const re = new RegExp(
    "^/" + slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\b|[ \\t])",
  );
  return re.test(stripped);
}

// ── Suggestion lookup (ranker detection) ────────────────

function findMatchingSuggestion(skillId, sessionId, promptHash) {
  try {
    // Look back across recent events for a suggested entry with the same skill_id.
    // Prefer matching prompt_hash; if not present, fall back to the most recent
    // suggested-for-this-skill in this session.
    const rows = query({ cat: "audit", session: sessionId, limit: 200 });
    if (!rows || rows.length === 0) return null;
    let match = null;
    let bestTurnOffset = null;
    // Count user prompts since the suggestion (proxy for turn_offset).
    // Walk events newest-first looking for the suggestion; count prompts along the way.
    let promptsSeen = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (!r || !r.data) continue;
      if (r.cat === "prompt") {
        promptsSeen++;
        continue;
      }
      const d = r.data;
      if (
        d.type === "skill-suggested-vs-invoked" &&
        d.phase === "suggested" &&
        d.skill_id === skillId
      ) {
        // Prefer the suggestion that matches our prompt_hash exactly
        if (promptHash && d.prompt_hash === promptHash) {
          return { row: r, turn_offset: 0 };
        }
        if (!match) {
          match = r;
          bestTurnOffset = promptsSeen;
        }
      }
    }
    if (match) return { row: match, turn_offset: bestTurnOffset || 0 };
    return null;
  } catch {
    return null;
  }
}

// ── Main ────────────────────────────────────────────────

(async () => {
  try {
    if (TELEMETRY_DISABLED) process.exit(0);
    const event = await readStdinJson();
    if (!event) process.exit(0);
    const toolName = event.tool_name || event.tool || "";
    // Only respond to slash-command-shaped tools. We attach this hook to the
    // "SlashCommand" matcher in settings.json, but it's defensive against
    // generic shapes too.
    const slug = extractSlug(event);
    if (!slug) process.exit(0);

    const sid = getSessionId();
    // Determine prompt hash from the most recent user prompt
    const recent = recentUserPrompt(sid);
    const promptText =
      recent && recent.data
        ? stripSystemTagsLocal(recent.data.raw || recent.data.stripped || "")
        : "";
    const promptHash = hashPrompt(promptText);

    let invocation_path = "agent-tool";
    let turn_offset = 0;

    if (isUserSlashFor(slug, recent)) {
      invocation_path = "user-slash";
      turn_offset = 0;
    } else {
      const suggestion =
        findMatchingSuggestion(`skill:${slug}`, sid, promptHash) ||
        findMatchingSuggestion(slug, sid, promptHash);
      if (suggestion) {
        invocation_path = "ranker";
        turn_offset = suggestion.turn_offset;
      }
    }

    logSkillInvoked({
      skill_id: `skill:${slug}`,
      prompt_hash: promptHash,
      turn_offset,
      invocation_path,
    });

    process.exit(0);
  } catch {
    process.exit(0);
  }
})();
