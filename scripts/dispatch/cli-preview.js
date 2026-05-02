/**
 * cli-preview.js — render the actual CLI invocation a dispatch will run.
 */

"use strict";

const { PROVIDERS } = require("./catalog");

function renderCliPreview({ provider, model, effort, role }) {
  const p = PROVIDERS[provider];
  if (!p) {
    return {
      command: `# unknown provider: ${provider}`,
      flagBreakdown: [],
      effortIsNoOp: false,
    };
  }
  const reasoning = effort
    ? p.cliEffortFlagTemplate.replace("{effort}", effort)
    : "";
  const effortIsNoOp = !!effort && p.cliEffortFlagTemplate === "";
  const command = p.syntaxTemplate
    .replace("{reasoning}", reasoning)
    .replace("{model}", model)
    .replace("{role}", role)
    .replace(/\s+/g, " ")
    .trim();
  return {
    command,
    flagBreakdown: breakdownFor(provider, effort, model, role, reasoning),
    effortIsNoOp,
  };
}

function breakdownFor(provider, effort, model, role, reasoningFlag) {
  const out = [];
  if (provider === "claude") {
    out.push({ flag: "-p", meaning: "Print mode (non-interactive)" });
    if (reasoningFlag) {
      out.push({
        flag: reasoningFlag,
        meaning: `Set thinking effort to ${effort}`,
      });
    }
    out.push({
      flag: `--agent ${role}`,
      meaning: "Dispatch as named subagent",
    });
    return out;
  }
  if (provider === "openai") {
    out.push({ flag: "exec", meaning: "Non-interactive scripted run" });
    out.push({
      flag: "--full-auto",
      meaning: "Workspace-write sandbox + auto-approve (required for non-TTY)",
    });
    if (reasoningFlag) {
      out.push({
        flag: reasoningFlag,
        meaning: `Set reasoning effort to ${effort}`,
      });
    }
    out.push({ flag: `-m ${model}`, meaning: "Model selection" });
    out.push({ flag: "-", meaning: "Read prompt from stdin" });
    return out;
  }
  if (provider === "gemini") {
    out.push({ flag: `-m ${model}`, meaning: "Model selection" });
    out.push({
      flag: "-p",
      meaning: "Inline prompt; thinking implicit on pro tier",
    });
    return out;
  }
  return out;
}

module.exports = { renderCliPreview };
