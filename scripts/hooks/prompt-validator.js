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
 * Closes: GAP-501 through GAP-506 (6 gaps).
 */

const { logEvent } = require("./lib/logger");

function detectRole(prompt) {
  const head = prompt.slice(0, 500).toLowerCase();
  if (/\bevaluator\b/.test(head)) return "evaluator";
  if (/\bsecurity\b/.test(head) && /\bscan\b|\breview\b|\baudit\b/.test(head))
    return "security";
  if (/\bcompliance\b/.test(head)) return "compliance";
  if (
    /\bqa\b/.test(head) &&
    /\borchestrat\b|\bscan\b|\banalyz\b|\bpersona\b/.test(head)
  )
    return "qa";
  if (/\bauditor\b/.test(head) && /\banalyz\b|\bpattern\b|\brule\b/.test(head))
    return "auditor";
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

    const prompt = (event.tool_input || {}).prompt || "";
    if (!prompt) {
      process.exit(0);
    }

    const role = detectRole(prompt);
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

    // Evaluator checks
    if (role === "evaluator") {
      if (!/golden|fixture|expected.*output|step-expectations/i.test(prompt)) {
        warnings.push("Evaluator prompt missing golden fixture reference");
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
