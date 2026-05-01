#!/usr/bin/env node
/**
 * Ensures build-chain dispatches carry a scope contract.
 */

function isBuildChain(role) {
  return ["builder", "fixer", "reviewer", "evaluator", "compliance", "qa", "redteam", "req-reviewer", "visual-review"].includes(role);
}

function resolveRole(event) {
  const explicit = event.tool_input?.subagent_type;
  if (explicit) return String(explicit).toLowerCase();
  const prompt = event.tool_input?.prompt || "";
  if (/^feature:\s*\S+/im.test(prompt.slice(0, 500))) return "builder";
  if (/\bredteam\b/i.test(prompt.slice(0, 500))) return "redteam";
  if (/\bqa\b/i.test(prompt.slice(0, 500))) return "qa";
  if (/\bcompliance\b/i.test(prompt.slice(0, 500))) return "compliance";
  if (/\b(reviewer|evaluator)\b/i.test(prompt.slice(0, 500))) return "reviewer";
  return "unknown";
}

function hasScopeContract(prompt) {
  return /scopeContract|allowedFiles|forbiddenFiles|File Scope|In-scope files/i.test(prompt || "");
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    if (event.tool_name !== "Agent" || event.tool_response !== undefined) process.exit(0);
    const role = resolveRole(event);
    if (!isBuildChain(role)) process.exit(0);
    const prompt = event.tool_input?.prompt || "";
    if (!hasScopeContract(prompt)) {
      console.log(
        JSON.stringify({
          decision: "block",
          reason: "scope-contract-guard: build-chain dispatch must include scopeContract or explicit allowedFiles/forbiddenFiles.",
        }),
      );
      process.exit(2);
    }
  } catch {
    process.exit(0);
  }
  process.exit(0);
});

module.exports = { hasScopeContract, resolveRole };
