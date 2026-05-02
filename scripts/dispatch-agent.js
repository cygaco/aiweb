#!/usr/bin/env node
/**
 * dispatch-agent.js — Cross-provider agent dispatch.
 *
 * Used by γ (adhoc orchestrator) and δ (oneshot orchestrator) to dispatch
 * review-layer and security agents that run on GPT or Gemini instead of Claude.
 *
 * Usage:
 *   node scripts/dispatch-agent.js <role> <prompt-file>
 *   node scripts/dispatch-agent.js <role> -              # read prompt from stdin
 *
 * Reads manifest.agentProviders[<role>] to determine provider:
 *   - "claude"  → errors (caller should dispatch natively via Claude Code Agent tool or `claude -p`)
 *   - "openai"  → shells out to `codex`
 *   - "gemini"  → shells out to `gemini`
 *
 * Output on stdout:
 *   JSON: { ok, provider, model, role, output, fallback?, error? }
 *
 * Exit codes:
 *   0 — provider call succeeded
 *   1 — provider unavailable or errored; caller should retry via Claude fallback
 *   2 — usage / config error
 *
 * Example (from gamma's bash dispatch):
 *   node scripts/dispatch-agent.js evaluator /tmp/eval-prompt.txt
 */

const fs = require("fs");
const path = require("path");
const {
  runProvider,
  getProviderForRole,
  providerAvailable,
  parseProviderJson,
} = require("./hooks/lib/providers");
const { PATHS } = require("./hooks/lib/paths");
const {
  acquireSlotSync,
  releaseSlot,
} = require("./hooks/lib/concurrency-lock");
const { record: recordProviderTrace } = require("./agents/provider-trace");
const { validate: validateAgentOutput } = require("./agents/output-validator");

/**
 * Find an agent spec file for a role by scanning .claude/agents/.
 * Agents live at either:
 *   .claude/agents/<mode>/<role>/<role>.md
 *   .claude/agents/<mode>/<role>/orchestrator.md
 *   .claude/agents/00-alex/<role>.md
 */
function findAgentSpec(role) {
  const agentsDir =
    PATHS.agents || path.join(PATHS.claudeDir || ".claude", "agents");
  if (!fs.existsSync(agentsDir)) return null;
  const stack = [agentsDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.isFile() && ent.name.endsWith(".md")) {
        const stem = ent.name.replace(/\.md$/, "");
        if (stem === role || stem === "orchestrator") {
          try {
            const body = fs.readFileSync(full, "utf8");
            const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
            if (fmMatch) {
              const nameMatch = fmMatch[1].match(/^name:\s*(\S+)/m);
              if (nameMatch && nameMatch[1] === role) return full;
              if (stem === role) return full;
            } else if (stem === role) {
              return full;
            }
          } catch {
            /* skip */
          }
        }
      }
    }
  }
  return null;
}

/**
 * Parse an agent spec's frontmatter and return the declared `provider_model`.
 */
function getRoleModel(role) {
  const spec = findAgentSpec(role);
  if (!spec) return null;
  try {
    const body = fs.readFileSync(spec, "utf8");
    const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;
    const m = fmMatch[1].match(/^provider_model:\s*(\S+)/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const [, , role, promptArg] = process.argv;

if (!role || !promptArg) {
  console.error(
    JSON.stringify({
      ok: false,
      error:
        "Usage: node scripts/dispatch-agent.js <role> <prompt-file | '-' for stdin>",
    }),
  );
  process.exit(2);
}

// Load the prompt
let prompt = "";
if (promptArg === "-") {
  prompt = fs.readFileSync(0, "utf8");
} else {
  if (!fs.existsSync(promptArg)) {
    console.error(
      JSON.stringify({
        ok: false,
        error: `Prompt file not found: ${promptArg}`,
      }),
    );
    process.exit(2);
  }
  prompt = fs.readFileSync(promptArg, "utf8");
}

if (!prompt.trim()) {
  console.error(JSON.stringify({ ok: false, error: "Empty prompt" }));
  process.exit(2);
}

const provider = getProviderForRole(role);
const promptBytes = Buffer.byteLength(prompt, "utf8");

if (provider === "claude") {
  console.error(
    JSON.stringify({
      ok: false,
      provider: "claude",
      role,
      error:
        "Provider is Claude — dispatch natively via Claude Code Agent tool or `claude -p --agent " +
        role +
        "`. This bridge handles OpenAI and Gemini only.",
    }),
  );
  process.exit(2);
}

// Phase 5T F8: Gemini redteam prompts above 75KB routinely timed out.
// Return a structured fallback signal before spending the provider timeout.
if (provider === "gemini" && role === "redteam" && promptBytes > 75 * 1024) {
  const fallbackResult = {
    ok: false,
    provider,
    role,
    fallback: true,
    error: `Prompt is ${promptBytes} bytes; redteam/gemini limit is 75KB. Split the scan or fall back to Claude redteam.`,
  };
  recordProviderTrace({
    role,
    expectedProvider: provider,
    actualProvider: "claude",
    fellBack: true,
    fallbackReason: fallbackResult.error,
    promptBytes,
    ok: false,
  });
  console.log(JSON.stringify(fallbackResult));
  process.exit(1);
}

if (!providerAvailable(provider)) {
  recordProviderTrace({
    role,
    expectedProvider: provider,
    actualProvider: "claude",
    fellBack: true,
    fallbackReason: `Provider ${provider} CLI not available`,
    promptBytes,
    ok: false,
  });
  console.log(
    JSON.stringify({
      ok: false,
      provider,
      role,
      fallback: true,
      error: `Provider ${provider} CLI not available. Falling back to Claude — caller should dispatch via \`claude -p --agent ${role}\`.`,
    }),
  );
  process.exit(1);
}

// Acquire a per-provider concurrency slot. Caps protect against API rate
// limits and concurrency-induced failures (e.g. gemini reliably errors on
// 15+ parallel calls but is fine 1-by-1 — observed during run-12 redteam
// gauntlet, retro 2026-04-29). On slot-acquire timeout, return fallback:true
// so the orchestrator routes to claude instead of waiting indefinitely.
const slotTimeoutMs = parseInt(
  process.env.DISPATCH_SLOT_TIMEOUT_MS || `${10 * 60 * 1000}`,
  10,
);
const slot = acquireSlotSync(provider, { timeoutMs: slotTimeoutMs });
if (!slot) {
  recordProviderTrace({
    role,
    expectedProvider: provider,
    actualProvider: "claude",
    fellBack: true,
    fallbackReason: `Provider ${provider} concurrency cap full after ${slotTimeoutMs}ms`,
    promptBytes,
    ok: false,
  });
  console.log(
    JSON.stringify({
      ok: false,
      provider,
      role,
      fallback: true,
      error: `Provider ${provider} concurrency cap full after ${slotTimeoutMs}ms — falling back to Claude. Tune via ${provider.toUpperCase()}_MAX_CONCURRENCY env var.`,
    }),
  );
  process.exit(1);
}

let result;
try {
  // Honor the agent's frontmatter-declared provider_model (e.g. qa → gpt-5.4-mini,
  // evaluator → gpt-5.4, redteam → gemini-3.1-pro-preview) instead of falling back
  // to the provider default for every role.
  const roleModel = getRoleModel(role);
  result = runProvider(role, prompt, roleModel ? { model: roleModel } : {});

  // Add role + structured output to result
  result.role = role;
  if (roleModel) result.specModel = roleModel;
  const parsed = parseProviderJson(result.output);
  if (parsed) result.parsed = parsed;
  const envelopeValidation = validateAgentOutput(role, parsed || result.output || "");
  result.envelopeValidation = {
    ok: envelopeValidation.ok,
    errors: envelopeValidation.errors || [],
    normalized: envelopeValidation.normalized
      ? {
          agent: envelopeValidation.normalized.agent,
          verdict: envelopeValidation.normalized.verdict,
          findings: envelopeValidation.normalized.findings.length,
          requiresHuman: envelopeValidation.normalized.requiresHuman,
        }
      : null,
  };
  recordProviderTrace({
    role,
    expectedProvider: provider,
    actualProvider: result.provider || provider,
    model: result.model || roleModel || null,
    fellBack: !!result.fallback,
    fallbackReason: result.error || null,
    promptBytes,
    ok: result.ok,
  });
} finally {
  releaseSlot(slot);
}

console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
