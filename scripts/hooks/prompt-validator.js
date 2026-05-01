#!/usr/bin/env node
/**
 * prompt-validator.js — PreToolUse hook for Agent dispatches.
 *
 * Hard-blocks builder dispatches missing required context. Validates:
 * - Builder prompts have `feature: <name>` in first 5 lines
 * - Builder prompts reference HYGIENE rules
 * - Evaluator prompts reference golden fixtures
 * - All dispatches are logged to System Events
 *
 * Role resolution: prefer explicit tool_input.subagent_type when present;
 * fall back to detectRole(prompt) text inference. This prevents false
 * positives where a fixer/compliance prompt that happens to start with
 * `feature: <name>` gets misclassified as builder and wrongly blocked.
 *
 * Closes: GAP-501 through GAP-506 (6 gaps).
 */

const { logEvent } = require("./lib/logger");

// Known subagent_type values that should map directly to a role.
// Everything outside this set falls through to detectRole(prompt).
const { normalizeRole } = require("./lib/role-aliases");

const KNOWN_SUBAGENT_TYPES = new Set([
  "builder",
  "fixer",
  "reviewer",
  "evaluator", // legacy — normalized to reviewer downstream
  "compliance",
  "qa",
  "redteam",
  "security",
  "learner",
  "auditor", // legacy — normalized to learner downstream
]);

function resolveRole(subagentType, prompt) {
  // If subagent_type is set, trust it. Build-chain types pass through the
  // alias normalizer (evaluator→reviewer, auditor→learner). Research types
  // (Explore, Plan, general-purpose) and any future agent type pass through
  // unchanged. Only fall back to detectRole when subagent_type is absent.
  // Fixed 2026-04-29 (RT-016) — prior code restricted to KNOWN_SUBAGENT_TYPES,
  // causing 27+ research-agent dispatches in 3d to log as dispatch-unknown.
  if (subagentType) {
    return normalizeRole(subagentType);
  }
  return detectRole(prompt);
}

function detectRole(prompt) {
  const head = prompt.slice(0, 500).toLowerCase();
  if (/\b(reviewer|evaluator)\b/.test(head)) return "reviewer";
  if (/\bsecurity\b/.test(head) && /\bscan\b|\breview\b|\baudit\b/.test(head))
    return "security";
  if (/\bcompliance\b/.test(head)) return "compliance";
  if (
    /\bqa\b/.test(head) &&
    /\borchestrat\b|\bscan\b|\banalyz\b|\bpersona\b/.test(head)
  )
    return "qa";
  if (
    /\b(learner|auditor)\b/.test(head) &&
    /\banalyz\b|\bpattern\b|\brule\b/.test(head)
  )
    return "learner";
  if (/\bfix\b/.test(head) && /\bagent\b|\bbrief\b/.test(head)) return "fixer";
  if (/\bfeature:\s*\S+/.test(prompt.slice(0, 500))) return "builder";
  if (/\bbuild\b/.test(head) && /\bimplement\b|\bcreate\b|\bgut\b/.test(head))
    return "builder";
  return "unknown";
}

function extractFeature(prompt) {
  const match = prompt.match(/^feature:\s*(\S+)/im);
  return match ? match[1] : null;
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const toolName = event.tool_name || "";

    if (toolName !== "Agent") {
      process.exit(0);
    }

    const toolInput = event.tool_input || {};
    const prompt = toolInput.prompt || "";
    if (!prompt) {
      process.exit(0);
    }

    const subagentType = toolInput.subagent_type || "";
    const role = resolveRole(subagentType, prompt);
    const feature = extractFeature(prompt);
    const warnings = [];
    const blocks = [];

    // Builder checks
    if (role === "builder") {
      // HARD BLOCK: feature: declaration in first 5 lines
      const firstLines = prompt.split("\n").slice(0, 5).join("\n");
      if (!/^feature:\s*\S+/im.test(firstLines)) {
        blocks.push(
          "Builder prompt MUST have 'feature: <name>' in first 5 lines (GAP-502)",
        );
      }

      // HARD BLOCK: HYGIENE reference (GAP-1101)
      if (!/HYGIENE|hygiene.*rule/i.test(prompt)) {
        blocks.push("Builder prompt MUST reference HYGIENE rules (GAP-1101)");
      }

      // HARD BLOCK: top-5 bugs or bugDataset reference (GAP-1101)
      if (!/top.?5.*bug|BUG-\d{3}|bugDataset|recurring.*bug/i.test(prompt)) {
        blocks.push(
          "Builder prompt MUST include top-5 recurring bugs (GAP-1101). Add BUG-NNN references from bugDataset.",
        );
      }

      // Advisory: file scope
      if (
        !/file.?scope|files?\s*to\s*(modify|edit|create)|FILE-OWNERSHIP/i.test(
          prompt,
        )
      ) {
        warnings.push("Builder prompt missing file scope specification");
      }
    }

    // Reviewer checks (canonical name; "evaluator" normalizes to "reviewer")
    if (role === "reviewer") {
      if (!/golden|fixture|expected.*output|step-expectations/i.test(prompt)) {
        warnings.push("Reviewer prompt missing golden fixture reference");
      }
    }

    // Log dispatch event
    const allIssues = [...blocks, ...warnings];
    logEvent(
      "dispatch",
      "boss",
      `dispatch-${role}`,
      feature || "unknown",
      `${role} dispatched${allIssues.length > 0 ? ` (${blocks.length} blocks, ${warnings.length} warnings)` : ""}`,
      allIssues.length > 0 ? { blocks, warnings } : undefined,
    );

    // HARD BLOCKS — refuse dispatch
    if (blocks.length > 0) {
      const blockMsg = blocks.join("; ");
      process.stderr.write(
        `\x1b[31m[prompt-validator] BLOCKED ${role} dispatch (${blocks.length} issue${blocks.length > 1 ? "s" : ""}):\x1b[0m\n`,
      );
      for (const b of blocks) {
        process.stderr.write(`  \x1b[31m- ${b}\x1b[0m\n`);
      }
      console.log(
        JSON.stringify({ decision: "block", reason: blockMsg.slice(0, 300) }),
      );
      process.exit(2); // HARD BLOCK — exit 2 prevents the tool call
    }

    // Advisory warnings — allow but notify
    if (warnings.length > 0) {
      process.stderr.write(
        `\x1b[33m[prompt-validator] ${warnings.length} warning(s) for ${role} dispatch:\x1b[0m\n`,
      );
      for (const w of warnings) {
        process.stderr.write(`  - ${w}\n`);
      }
    }

    // Allow
    process.exit(0);
  } catch {
    // Fail-open for advisory hook
    process.exit(0);
  }
});
