/**
 * state.js — assemble the CLI's view of dispatch config across
 * manifest.json + agent frontmatter, layered with env-var shadows.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  PROVIDERS,
  ROLES,
  DEFAULT_PROVIDER_PER_ROLE,
  DEFAULT_EFFORT_PER_ROLE,
  resolveModelAlias,
} = require("./catalog");

// Local re-export so the resolver (which previously didn't import the catalog
// helper) can normalize aliases like "sonnet" → "claude-sonnet-4-6".
const resolveModelAliasFromCatalog = resolveModelAlias;
const { readManifest } = require("./manifest-patch");
const { buildRoleFileMap } = require("./role-files");
const { parse: parseFm, getValue } = require("./frontmatter");

const PROJECT_ROOT = process.cwd();

// Per-role env var. New canonical name first; legacy name kept for one
// transition cycle (renamed 2026-04-29: evaluator → reviewer, auditor → learner).
const ENV_REASONING_VAR_PER_ROLE = {
  alpha: null,
  beta: null,
  gamma: null,
  delta: null,
  builder: "REASONING_BUILDER",
  fixer: "REASONING_FIXER",
  reviewer: "REASONING_REVIEWER",
  compliance: "REASONING_COMPLIANCE",
  learner: "REASONING_LEARNER",
  qa: "REASONING_QA",
  redteam: "REASONING_REDTEAM",
  "stub-scaffold": null,
};

// Legacy fallback env var per canonical role (used when new var is unset).
const LEGACY_ENV_REASONING_VAR_PER_ROLE = {
  reviewer: "REASONING_EVALUATOR",
  learner: "REASONING_AUDITOR",
};

const FLAGSHIP_OPENAI_ROLES = ["reviewer", "compliance", "learner"];
const MINI_OPENAI_ROLES = ["qa"];
const GEMINI_ROLES = ["redteam"];

function readRoleFrontmatter(files) {
  if (files.length === 0) {
    return {
      model: null,
      provider: null,
      provider_model: null,
      provider_fallback: null,
      provider_reasoning_effort: null,
      effort: null,
    };
  }
  const raw = fs.readFileSync(files[0], "utf8");
  const parsed = parseFm(raw);
  return {
    model: getValue(parsed, "model"),
    provider: getValue(parsed, "provider"),
    provider_model: getValue(parsed, "provider_model"),
    provider_fallback: getValue(parsed, "provider_fallback"),
    provider_reasoning_effort: getValue(parsed, "provider_reasoning_effort"),
    effort: getValue(parsed, "effort"),
  };
}

function resolveProvider(role, manifest) {
  const ap = manifest.agentProviders || {};
  return ap[role] || DEFAULT_PROVIDER_PER_ROLE[role];
}

function resolveModel(role, provider, fm) {
  const envShadows = [];
  if (provider === "openai" && FLAGSHIP_OPENAI_ROLES.includes(role)) {
    const v = process.env.OPENAI_FLAGSHIP_MODEL;
    if (v) {
      envShadows.push({
        var: "OPENAI_FLAGSHIP_MODEL",
        value: v,
        affects: "model",
      });
      return { model: v, modelSource: "env", envShadowsModel: envShadows };
    }
  }
  if (provider === "openai" && MINI_OPENAI_ROLES.includes(role)) {
    const v = process.env.OPENAI_MINI_MODEL;
    if (v) {
      envShadows.push({ var: "OPENAI_MINI_MODEL", value: v, affects: "model" });
      return { model: v, modelSource: "env", envShadowsModel: envShadows };
    }
  }
  if (provider === "gemini" && GEMINI_ROLES.includes(role)) {
    const v = process.env.GEMINI_MODEL;
    if (v) {
      envShadows.push({ var: "GEMINI_MODEL", value: v, affects: "model" });
      return { model: v, modelSource: "env", envShadowsModel: envShadows };
    }
  }
  if (provider === "claude" && fm.model && fm.model !== "inherit") {
    // Resolve aliases (sonnet/opus/haiku) to canonical model ids so panel comparisons match.
    const resolved = resolveModelAliasFromCatalog(fm.model);
    return {
      model: resolved,
      modelSource: "frontmatter",
      envShadowsModel: envShadows,
    };
  }
  if (provider !== "claude" && fm.provider_model) {
    return {
      model: fm.provider_model,
      modelSource: "frontmatter",
      envShadowsModel: envShadows,
    };
  }
  return {
    model: PROVIDERS[provider].defaultModel,
    modelSource: "default",
    envShadowsModel: envShadows,
  };
}

function resolveEffort(role, fm) {
  const envShadows = [];
  const envVar = ENV_REASONING_VAR_PER_ROLE[role];
  if (envVar) {
    const v = process.env[envVar];
    if (v) {
      envShadows.push({ var: envVar, value: v, affects: "effort" });
      return { effort: v, effortSource: "env", envShadowsEffort: envShadows };
    }
  }
  // Legacy env var fallback (renamed roles only — evaluator/auditor → reviewer/learner).
  const legacyVar = LEGACY_ENV_REASONING_VAR_PER_ROLE[role];
  if (legacyVar) {
    const v = process.env[legacyVar];
    if (v) {
      envShadows.push({ var: legacyVar, value: v, affects: "effort" });
      return { effort: v, effortSource: "env", envShadowsEffort: envShadows };
    }
  }
  const fmEffort = fm.provider_reasoning_effort || fm.effort;
  if (fmEffort) {
    return {
      effort: fmEffort,
      effortSource: "frontmatter",
      envShadowsEffort: envShadows,
    };
  }
  return {
    effort: DEFAULT_EFFORT_PER_ROLE[role],
    effortSource: "default",
    envShadowsEffort: envShadows,
  };
}

function relPosix(p) {
  return path.relative(PROJECT_ROOT, p).split(path.sep).join("/");
}

function buildPanelState() {
  const { data: manifest } = readManifest();
  const roleFiles = buildRoleFileMap();

  const roles = [];
  for (const role of ROLES) {
    const files = roleFiles[role] || [];
    const fm = readRoleFrontmatter(files);
    const provider = resolveProvider(role, manifest);
    const providerSource =
      manifest.agentProviders && manifest.agentProviders[role]
        ? "manifest"
        : "default";
    const { model, modelSource, envShadowsModel } = resolveModel(
      role,
      provider,
      fm,
    );
    const { effort, effortSource, envShadowsEffort } = resolveEffort(role, fm);
    const fallback = fm.provider_fallback || null;

    roles.push({
      role,
      provider,
      providerSource,
      model,
      modelSource,
      effort,
      effortSource,
      fallback,
      files: files.map(relPosix),
      envShadows: [...envShadowsModel, ...envShadowsEffort],
      raw: fm,
    });
  }

  return {
    manifestPath: ".claude/manifest.json",
    roles,
  };
}

module.exports = { buildPanelState };
