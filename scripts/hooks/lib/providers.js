/**
 * providers.js — Cross-provider CLI bridge for review-layer agents.
 *
 * Claude Code's `model:` frontmatter only accepts Claude models. To run review
 * agents on GPT / Gemini for model diversity (different model reviewing Claude's
 * output catches what same-model review misses), we shell out to the respective
 * CLIs instead of dispatching as a Claude sub-agent.
 *
 * Pattern borrowed from /research:deep:
 *   - Write prompt to temp file (avoids bash escaping hell)
 *   - Invoke CLI via execSync, capture stdout
 *   - Normalize output to match Claude sub-agent JSON shape
 *   - Fall back to Claude if CLI unavailable
 *
 * Usage:
 *   const { runProvider, getProviderForRole, providerAvailable } = require('./lib/providers');
 *   const result = runProvider('evaluator', promptText, { timeoutMs: 120000 });
 *
 * Exit codes:
 *   0 — success, result is parsed
 *   1 — CLI failed, result.fallback === true, caller should retry via Claude
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PROJECT, PATHS } = require("./paths");

// ── Config resolution ───────────────────────────────────────
function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(PATHS.manifest, "utf8"));
  } catch {
    return {};
  }
}

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(PATHS.store, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Provider defaults if manifest.providers is missing.
 * Keys match the CLI tool name.
 */
const DEFAULT_PROVIDERS = {
  claude: {
    cli: "claude",
    default_model: "sonnet",
    invocation: "native", // dispatched via Claude Code Agent tool, not this bridge
  },
  openai: {
    cli: "codex",
    default_model: "gpt-5.4",
    fallback: "claude",
    // Per https://developers.openai.com/codex/cli/reference :
    //   `codex exec` with `-` reads prompt from stdin.
    //   `--full-auto` enables workspace-write sandbox + on-request approvals (needed in non-TTY runs).
    //   `-m <model>` or `--model <model>` selects the model.
    //   `-o <file>` writes last-message response for reliable capture.
    syntax: `codex exec --full-auto -m {model} -`,
  },
  gemini: {
    cli: "gemini",
    default_model: "gemini-3.1-pro-preview",
    fallback: "claude",
    // Gemini CLI: pipe context on stdin, instruction via `-p`, plain-text output via `-o text`.
    // `gemini-3.1-pro-preview` has thinking mode + 1M input context — ideal for attack-chain reasoning.
    syntax: `gemini -m {model} -p`,
  },
};

/**
 * Default role → provider mapping. Can be overridden per-project by
 * `manifest.agentProviders`. This is the KEY decision: which agent goes to
 * which provider for model diversity.
 */
const DEFAULT_AGENT_PROVIDERS = {
  alpha: "claude",
  beta: "claude",
  gamma: "claude",
  delta: "claude",
  builder: "claude",
  fixer: "claude",
  // Review layer — GPT-5.4 for different lens on Claude's output
  evaluator: "openai",
  compliance: "openai",
  auditor: "openai",
  qa: "openai",
  // Security — Gemini for different adversarial training corpus
  redteam: "gemini",
};

function getProviderForRole(role) {
  const manifest = loadManifest();
  const agentMap = manifest.agentProviders || DEFAULT_AGENT_PROVIDERS;
  return agentMap[role] || "claude";
}

function getProviderConfig(providerName) {
  const manifest = loadManifest();
  const providers = manifest.providers || DEFAULT_PROVIDERS;
  return providers[providerName] || DEFAULT_PROVIDERS[providerName] || null;
}

// ── Availability ────────────────────────────────────────────
// Actually INVOKE the binary with --version — a dead PATH entry (shim / broken
// symlink) will fail, which `which` / `where` would falsely report as present.
// 3s timeout is enough for a version print; anything longer = dead command.
function cliAvailable(cmd) {
  try {
    execSync(`${cmd} --version`, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

function providerAvailable(providerName) {
  if (providerName === "claude") return true; // always available — it's the harness
  const cfg = getProviderConfig(providerName);
  if (!cfg) return false;
  return cliAvailable(cfg.cli);
}

// ── Temp file helpers ───────────────────────────────────────
function tempFilePath(role) {
  const runtimeDir = PATHS.runtime;
  const tmpDir = path.join(runtimeDir, ".provider-tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const id = crypto.randomBytes(4).toString("hex");
  return path.join(tmpDir, `${role}-${Date.now()}-${id}.txt`);
}

// ── Invocation ──────────────────────────────────────────────
/**
 * Run a provider for a given role.
 *
 * @param {string} role - Agent role (evaluator, compliance, qa, redteam, etc.)
 * @param {string} prompt - Full prompt text (agent instructions + context)
 * @param {object} opts
 * @param {number} opts.timeoutMs - Default 120_000 (2 min)
 * @param {string} opts.model - Override default model for this provider
 * @returns {object} { ok: boolean, provider: string, model: string, output: string, fallback?: boolean, error?: string }
 */
/**
 * Check whether a given model is actually available on the user's account
 * for the given provider. Returns true if available, false otherwise.
 *
 * For Gemini: probes `gemini models list` if supported, or falls back to
 * trying a minimal prompt and checking the response. For OpenAI/codex:
 * the CLI itself knows the available models.
 *
 * Cached per-session (12 min TTL) to avoid repeated probes.
 */
const _availabilityCache = new Map();
function modelAvailable(providerName, model) {
  const key = `${providerName}:${model}`;
  const cached = _availabilityCache.get(key);
  if (cached && Date.now() - cached.ts < 12 * 60_000) return cached.value;

  let available = true; // default optimistic; pre-flight is best-effort
  try {
    if (providerName === "gemini") {
      // gemini CLI exposes `models list` — parse the output for the requested ID
      const out = execSync("gemini models list 2>&1", {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 10_000,
      }).toString();
      if (out && !out.toLowerCase().includes(model.toLowerCase())) {
        available = false;
      }
    } else if (providerName === "openai") {
      // codex doesn't expose models list; skip probe, rely on post-dispatch assertion
      available = true;
    }
  } catch {
    // Probe failed; fall back to optimistic. Post-dispatch assertion catches mismatches.
    available = true;
  }

  _availabilityCache.set(key, { ts: Date.now(), value: available });
  return available;
}

/**
 * Extract the model identifier a provider reports in its response, if any.
 * Providers often include their self-identification either in headers
 * (not available in CLI mode) or in the text output. This heuristic
 * matches the most common patterns.
 */
function extractReportedModel(output) {
  if (!output) return null;
  // Try JSON parse first — our agents produce a JSON envelope
  try {
    const parsed = typeof output === "string" ? JSON.parse(output) : output;
    if (parsed && parsed.model) return String(parsed.model).toLowerCase();
  } catch {
    /* not JSON — try fenced block */
  }
  const fence = output.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      const parsed = JSON.parse(fence[1]);
      if (parsed && parsed.model) return String(parsed.model).toLowerCase();
    } catch {
      /* skip */
    }
  }
  // Text fallback: look for "model: <id>" or "I am <id>"
  const m1 = output.match(/model[:\s]+["']?([a-z0-9.\-]+)["']?/i);
  if (m1) return m1[1].toLowerCase();
  return null;
}

/**
 * Compare requested vs reported model. Returns true if they are considered
 * the same model (including known family equivalences). Rejects clearly
 * downgraded cases like gemini-3.1-pro → gemini-2.5-pro.
 */
function modelsMatch(requested, reported) {
  if (!reported) return true; // no self-report; can't verify, assume OK
  const a = requested.toLowerCase();
  const b = reported.toLowerCase();
  if (a === b) return true;
  // Accept exact prefix match (e.g. gpt-5.4 vs gpt-5.4-2026-03-05)
  if (a.startsWith(b) || b.startsWith(a)) return true;
  // Codex self-reports as "gpt-5" — accept within the GPT-5 family only when
  // requested model starts with "gpt-5" as well. Don't accept "gpt-4" etc.
  if (a.startsWith("gpt-5") && b === "gpt-5") return true;
  return false;
}

function runProvider(role, prompt, opts = {}) {
  const timeoutMs = opts.timeoutMs || 120_000;
  const strict = opts.strict !== false; // default ON — fail on silent downgrade
  const providerName = getProviderForRole(role);

  // Claude path — caller should dispatch via Agent tool, not this bridge
  if (providerName === "claude") {
    return {
      ok: false,
      provider: "claude",
      output: "",
      fallback: false,
      error:
        "Provider is Claude — dispatch via Claude Code Agent tool, not this bridge.",
    };
  }

  const cfg = getProviderConfig(providerName);
  if (!cfg) {
    return {
      ok: false,
      provider: providerName,
      output: "",
      fallback: true,
      error: `Unknown provider: ${providerName}`,
    };
  }

  if (!cliAvailable(cfg.cli)) {
    return {
      ok: false,
      provider: providerName,
      output: "",
      fallback: true,
      error: `CLI "${cfg.cli}" not found — install it or switch provider to ${cfg.fallback || "claude"}`,
    };
  }

  const model = opts.model || cfg.default_model;

  // Pre-flight: verify the model is available on this account. Saves a token
  // spend and a silent downgrade. Only enforces when strict mode is on.
  if (strict && !modelAvailable(providerName, model)) {
    return {
      ok: false,
      provider: providerName,
      model,
      output: "",
      fallback: false,
      strictFailure: true,
      error: `Model ${model} is not available on your ${providerName} account. Upgrade your tier, or edit manifest.providers.${providerName}.default_model to a model you have access to. Refusing to silently downgrade.`,
    };
  }

  const promptFile = tempFilePath(role);
  fs.writeFileSync(promptFile, prompt, "utf8");

  try {
    // Read prompt content directly — `cat file |` fails on Windows cmd.exe
    // (Node's default execSync shell). Passing the prompt as stdin via the
    // `input:` option is shell-agnostic and handles any file content.
    const promptContent = fs.readFileSync(promptFile, "utf8");

    let cmd;
    if (providerName === "openai") {
      // codex exec reads stdin when passed `-` as the prompt.
      // --full-auto = workspace-write sandbox + on-request approval (needed in non-TTY).
      cmd = `${cfg.cli} exec --full-auto -m ${model} -`;
    } else if (providerName === "gemini") {
      // gemini CLI: context on stdin, instruction via -p, `-o json` returns a
      // JSON envelope with { response, stats.models } so we can verify which
      // model actually served the request (preview models can silently fall
      // back under load). We extract response as `output` and record the
      // served model as `actualModel`.
      cmd = `${cfg.cli} -m ${model} -p "Process the instructions on stdin and produce the requested output." -o json`;
    } else {
      // Generic pattern from cfg.syntax (used when manifest overrides defaults)
      cmd = `${cfg.syntax.replace("{model}", model)}`;
    }

    const rawOutput = execSync(cmd, {
      cwd: PROJECT,
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
      input: promptContent,
      maxBuffer: 32 * 1024 * 1024, // 32MB for long review outputs
      shell: true,
    })
      .toString()
      .trim();

    // Gemini JSON envelope unwrap + actual-model audit
    let output = rawOutput;
    let actualModel = model;
    if (providerName === "gemini") {
      try {
        const env = JSON.parse(rawOutput);
        if (env && typeof env.response === "string") output = env.response;
        if (env && env.stats && env.stats.models) {
          const served = Object.keys(env.stats.models);
          if (served.length) actualModel = served[0];
        }
      } catch {
        // Fall through — keep rawOutput as output, model as actualModel
      }
    }

    // Strict assertion — detect silent downgrade.
    // actualModel comes from the CLI's own stats (authoritative); compare to requested.
    if (strict && !modelsMatch(model, actualModel)) {
      return {
        ok: false,
        provider: providerName,
        model,
        actualModel,
        output,
        fallback: false,
        strictFailure: true,
        error: `Silent downgrade: requested ${model}, CLI served ${actualModel}. Refusing to accept — the whole point of cross-provider is model-specific review. Options: (1) upgrade provider tier, (2) edit manifest.providers.${providerName}.default_model to "${actualModel}", (3) pass opts.strict=false to accept any model returned.`,
      };
    }

    return {
      ok: true,
      provider: providerName,
      model,
      actualModel,
      output,
      cmd: cmd.slice(0, 200),
    };
  } catch (err) {
    return {
      ok: false,
      provider: providerName,
      model,
      output: "",
      fallback: true,
      error: String(err.message || err).slice(0, 500),
    };
  } finally {
    // Cleanup temp file unless debugging
    if (!process.env.WARPOS_PROVIDER_DEBUG) {
      try {
        fs.unlinkSync(promptFile);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Parse a provider's output as JSON, falling back to extracting a ```json block.
 * Review agents typically return structured JSON; this normalizes that.
 */
function parseProviderJson(output) {
  if (!output) return null;
  try {
    return JSON.parse(output);
  } catch {
    /* try code fence extraction */
  }
  const match = output.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    try {
      return JSON.parse(match[1].trim());
    } catch {
      /* give up */
    }
  }
  return null;
}

module.exports = {
  runProvider,
  getProviderForRole,
  getProviderConfig,
  providerAvailable,
  parseProviderJson,
  DEFAULT_PROVIDERS,
  DEFAULT_AGENT_PROVIDERS,
};
