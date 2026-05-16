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
const crypto = require("crypto");
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

// ── Telemetry helpers (Phase 0 workstream C) ──────────────
//
// Every dispatch gets a unique dispatch_id. Completion + silent-death markers
// are persisted to durable JSONL files under .claude/runtime/ so a post-mortem
// can answer "did the process actually run and produce nothing, or was it
// pre-empted before runProvider returned?". Fail-open everywhere — never let
// telemetry crash an otherwise-successful dispatch.

function makeDispatchId() {
  return (
    "d-" + Date.now().toString(36) + "-" + crypto.randomBytes(4).toString("hex")
  );
}

function cmdlineChecksum(role, provider, promptBytes) {
  return (
    "sha256:" +
    crypto
      .createHash("sha256")
      .update(`${role}|${provider}|${promptBytes}|${process.argv.join(" ")}`)
      .digest("hex")
      .slice(0, 32)
  );
}

function ensureDir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch {
    /* ignore */
  }
}

function appendJsonl(file, record) {
  try {
    ensureDir(path.dirname(file));
    fs.appendFileSync(file, JSON.stringify(record) + "\n");
  } catch {
    /* fail-open — telemetry never blocks dispatch */
  }
}

function recordCompletion(record) {
  const file =
    PATHS.dispatchCompletionsFile ||
    path.join(PATHS.runtime || ".claude/runtime", "dispatch-completions.jsonl");
  appendJsonl(file, record);
}

function recordDeath(record) {
  const file =
    PATHS.dispatchDeathsFile ||
    path.join(PATHS.runtime || ".claude/runtime", "dispatch-deaths.jsonl");
  appendJsonl(file, record);
}

/**
 * Find an agent spec file for a role by scanning .claude/agents/.
 * Agents live at either:
 *   .claude/agents/<mode>/<role>/<role>.md
 *   .claude/agents/<mode>/<role>/orchestrator.md
 *   .claude/agents/00-alex/<role>.md
 *
 * Phase 0 workstream F — mode-aware resolution. Roles like `builder`,
 * `reviewer`, `qa` exist in BOTH 01-adhoc/ and 02-oneshot/ with subtly
 * different specs. The pre-Phase-0 walker picked the first match in DFS
 * order, which depended on filesystem layout. Now resolution order is:
 *
 *   1. process.env.WARPOS_MODE explicit (`adhoc` | `oneshot` | `solo`)
 *   2. inferred from `.claude/agents/02-oneshot/.system/store.json#status`
 *      (running → oneshot)
 *   3. `00-alex/<role>.md` for orchestrator/identity roles (alpha, beta,
 *      gamma, delta)
 *   4. first match in DFS order (legacy fallback)
 */

function detectMode() {
  const explicit = process.env.WARPOS_MODE;
  if (explicit && /^(adhoc|oneshot|solo)$/i.test(explicit))
    return explicit.toLowerCase();
  try {
    const storePath =
      PATHS.oneshotStore ||
      path.join(
        PATHS.agents || ".claude/agents",
        "02-oneshot",
        ".system",
        "store.json",
      );
    if (fs.existsSync(storePath)) {
      const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
      if (store && store.status === "running") return "oneshot";
    }
  } catch {
    /* fall through */
  }
  return "adhoc";
}

function modeSubdir(mode) {
  if (mode === "oneshot") return "02-oneshot";
  if (mode === "adhoc") return "01-adhoc";
  return null;
}

function specMatchesRole(filePath, role) {
  try {
    const body = fs.readFileSync(filePath, "utf8");
    const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const nameMatch = fmMatch[1].match(/^name:\s*(\S+)/m);
      if (nameMatch && nameMatch[1] === role) return true;
    }
  } catch {
    /* unreadable */
  }
  return false;
}

function tryDirect(role, ...candidates) {
  for (const c of candidates) {
    if (!c) continue;
    if (fs.existsSync(c)) {
      // Prefer files whose frontmatter `name:` matches the role, but accept
      // when stem matches and frontmatter is silent.
      if (specMatchesRole(c, role)) return c;
      const stem = path.basename(c).replace(/\.md$/, "");
      if (stem === role) return c;
    }
  }
  return null;
}

function findAgentSpec(role) {
  const agentsDir =
    PATHS.agents || path.join(PATHS.claudeDir || ".claude", "agents");
  if (!fs.existsSync(agentsDir)) return null;

  const mode = detectMode();
  const modeDir = modeSubdir(mode);

  // 1. Mode-specific direct hits
  if (modeDir) {
    const modeRoot = path.join(agentsDir, modeDir);
    const direct = tryDirect(
      role,
      path.join(modeRoot, role, `${role}.md`),
      path.join(modeRoot, role, "orchestrator.md"),
      path.join(modeRoot, `${role}.md`),
    );
    if (direct) return direct;
  }

  // 2. 00-alex orchestrator/identity roles
  const alex = tryDirect(role, path.join(agentsDir, "00-alex", `${role}.md`));
  if (alex) return alex;

  // 3. Cross-mode opposite direction (e.g. running adhoc but only oneshot has it)
  const fallbackDir = modeDir === "01-adhoc" ? "02-oneshot" : "01-adhoc";
  const fallbackRoot = path.join(agentsDir, fallbackDir);
  const fallback = tryDirect(
    role,
    path.join(fallbackRoot, role, `${role}.md`),
    path.join(fallbackRoot, role, "orchestrator.md"),
    path.join(fallbackRoot, `${role}.md`),
  );
  if (fallback) return fallback;

  // 4. Legacy DFS — kept for backward compatibility when a role lives in a
  //    non-standard subdir.
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
          if (specMatchesRole(full, role) || stem === role) return full;
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

// Allow test code to require() this module without triggering the CLI flow.
if (require.main !== module) {
  module.exports = {
    findAgentSpec,
    getRoleModel,
    detectMode,
    modeSubdir,
  };
  return;
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

// Phase 0 workstream C: stamp telemetry identity for this dispatch.
const dispatchId = makeDispatchId();
const dispatchStartedAt = new Date().toISOString();
const dispatchStartedMs = Date.now();
const cmdChecksum = cmdlineChecksum(role, provider, promptBytes);

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
const slot = acquireSlotSync(provider, {
  timeoutMs: slotTimeoutMs,
  meta: {
    dispatch_id: dispatchId,
    role,
    provider,
    prompt_bytes: promptBytes,
    cmdline_checksum: cmdChecksum,
  },
});
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
  const envelopeValidation = validateAgentOutput(
    role,
    parsed || result.output || "",
  );
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

  // Phase 0 workstream C: completion + silent-death telemetry.
  const stdoutBytes = result.output
    ? Buffer.byteLength(String(result.output), "utf8")
    : 0;
  const stderrBytes = result.stderrBytes || 0;
  const completedAt = new Date().toISOString();
  const completedMs = Date.now();
  const elapsedMs = completedMs - dispatchStartedMs;
  recordCompletion({
    dispatch_id: dispatchId,
    pid: process.pid,
    role,
    provider,
    model: result.model || roleModel || null,
    started_at: dispatchStartedAt,
    completed_at: completedAt,
    elapsed_ms: elapsedMs,
    prompt_bytes: promptBytes,
    cmdline_checksum: cmdChecksum,
    exit_code: result.ok ? 0 : 1,
    stdout_bytes: stdoutBytes,
    stderr_bytes: stderrBytes,
    fallback: !!result.fallback,
    ok: !!result.ok,
  });

  // Silent zero-byte death: process returned a non-ok with no stdout AND no
  // captured stderr — this is the LRN-2026-04-17 / 2026-04-30 binding-gap
  // failure signature. Persist for post-mortem so future flag-drain / health
  // checks can flag the pattern instead of swallowing it.
  if (!result.ok && stdoutBytes === 0 && stderrBytes === 0) {
    recordDeath({
      dispatch_id: dispatchId,
      timestamp: completedAt,
      pid: process.pid,
      role,
      provider,
      model: result.model || roleModel || null,
      prompt_bytes: promptBytes,
      cmdline_checksum: cmdChecksum,
      exit_code: null,
      stdout_bytes: 0,
      stderr_bytes: 0,
      last_stdout_mtime: null,
      last_stderr_mtime: null,
      reason: "silent_zero_byte_death",
      hint: result.error || null,
    });
  }
} finally {
  releaseSlot(slot);
}

console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
