/**
 * catalog.js — provider/model/effort source of truth for the dispatch CLI.
 *
 * Mirrors docs/06-integrations/PROVIDER/. When models change, update this file
 * AND the corresponding markdown doc together.
 */

"use strict";

// ── Anthropic / Claude ─────────────────────────────────────────
// Internal id is "claude" to match existing manifest.agentProviders + providers.js
// DEFAULT_AGENT_PROVIDERS convention. User-facing label is "Anthropic".
const ANTHROPIC = {
  id: "claude",
  label: "Anthropic (Claude)",
  cli: "claude",
  cliEffortFlagTemplate: "--effort {effort}",
  syntaxTemplate: "claude -p {reasoning} --agent {role}",
  requiresFallback: false,
  defaultModel: "claude-opus-4-7",
  models: [
    {
      id: "claude-opus-4-7",
      label: "Claude Opus 4.7",
      effortLevels: ["low", "medium", "high", "xhigh", "max"],
      contextTokens: 1_000_000,
      maxOutputTokens: 128_000,
      pricing: { inPerMTok: 5, outPerMTok: 25 },
      aliases: ["opus", "claude-opus-4-7"],
    },
    {
      id: "claude-sonnet-4-6",
      label: "Claude Sonnet 4.6",
      effortLevels: ["low", "medium", "high", "max"],
      contextTokens: 1_000_000,
      maxOutputTokens: 64_000,
      pricing: { inPerMTok: 3, outPerMTok: 15 },
      aliases: ["sonnet", "claude-sonnet-4-6"],
    },
    {
      id: "claude-haiku-4-5-20251001",
      label: "Claude Haiku 4.5",
      effortLevels: [],
      contextTokens: 200_000,
      maxOutputTokens: 64_000,
      pricing: { inPerMTok: 1, outPerMTok: 5 },
      aliases: ["haiku", "claude-haiku-4-5"],
    },
  ],
};

// ── OpenAI ─────────────────────────────────────────────────────
const OPENAI = {
  id: "openai",
  label: "OpenAI",
  cli: "codex",
  cliEffortFlagTemplate: "-c model_reasoning_effort={effort}",
  syntaxTemplate: "codex exec --full-auto {reasoning} -m {model} -",
  requiresFallback: true,
  defaultModel: "gpt-5.5",
  models: [
    {
      id: "gpt-5.5",
      label: "GPT-5.5 (flagship)",
      effortLevels: ["low", "medium", "high", "xhigh"],
      contextTokens: 1_000_000,
      maxOutputTokens: 128_000,
      pricing: { inPerMTok: 5, outPerMTok: 30 },
    },
    {
      id: "gpt-5.4",
      label: "GPT-5.4",
      effortLevels: ["low", "medium", "high", "xhigh"],
      contextTokens: 1_000_000,
      maxOutputTokens: 128_000,
      pricing: { inPerMTok: 2.5, outPerMTok: 15 },
    },
    {
      id: "gpt-5.4-mini",
      label: "GPT-5.4 Mini",
      effortLevels: ["low", "medium", "high", "xhigh"],
      contextTokens: 400_000,
      maxOutputTokens: 128_000,
      pricing: { inPerMTok: 0.75, outPerMTok: 4.5 },
    },
  ],
};

// ── Gemini ─────────────────────────────────────────────────────
// gemini-2.5-pro deliberately excluded per project policy
// (see docs/06-integrations/PROVIDER/03-google-gemini.md)
const GEMINI = {
  id: "gemini",
  label: "Google Gemini",
  cli: "gemini",
  cliEffortFlagTemplate: "",
  syntaxTemplate: "gemini -m {model} -p",
  requiresFallback: true,
  defaultModel: "gemini-3.1-pro-preview",
  models: [
    {
      id: "gemini-3.1-pro-preview",
      label: "Gemini 3.1 Pro (preview, thinking always-on)",
      effortLevels: [],
      contextTokens: 1_000_000,
      maxOutputTokens: 64_000,
      thinkingAlwaysOn: true,
    },
    {
      id: "gemini-3.1-flash",
      label: "Gemini 3.1 Flash",
      effortLevels: [],
      contextTokens: 1_000_000,
      maxOutputTokens: 64_000,
    },
    {
      id: "gemini-3.1-flash-lite",
      label: "Gemini 3.1 Flash-Lite",
      effortLevels: [],
      contextTokens: 1_000_000,
      maxOutputTokens: 64_000,
    },
    {
      id: "gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
      effortLevels: [],
      contextTokens: 1_000_000,
      maxOutputTokens: 64_000,
    },
  ],
};

const PROVIDERS = { claude: ANTHROPIC, openai: OPENAI, gemini: GEMINI };
const PROVIDER_LIST = [ANTHROPIC, OPENAI, GEMINI];

// Accepted aliases the user might type — normalize to canonical id.
const PROVIDER_ALIASES = {
  anthropic: "claude",
  claude: "claude",
  openai: "openai",
  gpt: "openai",
  gemini: "gemini",
  google: "gemini",
};

function normalizeProviderId(id) {
  if (!id) return id;
  return PROVIDER_ALIASES[id.toLowerCase()] || id;
}

const ROLES = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "builder",
  "fixer",
  "reviewer",
  "compliance",
  "learner",
  "qa",
  "redteam",
  "stub-scaffold",
];

const DEFAULT_PROVIDER_PER_ROLE = {
  alpha: "claude",
  beta: "claude",
  gamma: "claude",
  delta: "claude",
  builder: "claude",
  fixer: "claude",
  reviewer: "openai",
  compliance: "openai",
  learner: "openai",
  qa: "openai",
  redteam: "gemini",
  "stub-scaffold": "claude",
};

const DEFAULT_EFFORT_PER_ROLE = {
  alpha: null,
  beta: "high",
  gamma: null,
  delta: null,
  builder: "max",
  fixer: "max",
  reviewer: "xhigh",
  compliance: "xhigh",
  learner: "xhigh",
  qa: "medium",
  redteam: "high",
  "stub-scaffold": null,
};

function getProvider(id) {
  const normalized = normalizeProviderId(id);
  return PROVIDERS[normalized] || null;
}

function getModel(providerId, modelId) {
  const p = PROVIDERS[providerId];
  if (!p) return null;
  return (
    p.models.find(
      (m) => m.id === modelId || (m.aliases || []).includes(modelId),
    ) || null
  );
}

function resolveModelAlias(modelOrAlias) {
  for (const p of PROVIDER_LIST) {
    for (const m of p.models) {
      if ((m.aliases || []).includes(modelOrAlias)) return m.id;
    }
  }
  return modelOrAlias;
}

/** Validate a (provider, model, effort) tuple. Returns null if valid, else an error string. */
function validateTuple(provider, model, effort) {
  const p = getProvider(provider);
  if (!p) return `Unknown provider: ${provider}`;
  const m = getModel(p.id, model);
  if (!m) return `Model "${model}" not available on provider "${provider}"`;
  if (m.deprecated) return `Model "${model}" is deprecated`;
  if (effort) {
    if (m.effortLevels.length === 0) {
      // No-op for this model; allow but caller may warn
      return null;
    }
    if (!m.effortLevels.includes(effort)) {
      return `Effort "${effort}" not supported by model "${model}". Allowed: ${m.effortLevels.join(", ")}`;
    }
  }
  return null;
}

module.exports = {
  PROVIDERS,
  PROVIDER_LIST,
  PROVIDER_ALIASES,
  ROLES,
  DEFAULT_PROVIDER_PER_ROLE,
  DEFAULT_EFFORT_PER_ROLE,
  getProvider,
  getModel,
  resolveModelAlias,
  normalizeProviderId,
  validateTuple,
};
