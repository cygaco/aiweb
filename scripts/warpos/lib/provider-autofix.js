#!/usr/bin/env node
/**
 * provider-autofix.js — safe-only auto-fix dispatcher for provider-smoke.
 *
 * Sprint:  SP-20260513-002
 * Ticket:  T-20260513-023
 * Story:   S-5
 * AC:      AC-5.1, AC-5.2, AC-5.3
 * COPY:    C-4
 * TRACE:   TR-4
 *
 * Given RCA entries from provider-rca.js + a probeOne re-prober, runs each
 * fix_recipe whose `safe_to_autofix === true`. Re-probes exactly ONCE per
 * recipe (never loops). Emits one `type: "autofix"` audit event per attempt.
 *
 * SAFETY INVARIANT (RT-2): the dispatcher MUST refuse to execute any recipe
 * whose effect would mutate operator auth state. Catalog entries that touch
 * credentials are required to have `safe_to_autofix=false` upstream (caught
 * by the catalog lint in tests/warpos/provider-smoke.unit.test.js). This
 * module additionally rejects unknown recipe kinds — so adding a new
 * recipe-kind anywhere else cannot quietly enable auth mutation here.
 *
 *
 * Public contract (DO NOT break without bumping `warpos/provider-smoke/v1`):
 *
 *   runAutofixes({ rca, probeOne, log, noAutofix }) ->
 *     Array<{
 *       provider:         string,
 *       original_status:  string,
 *       fix_recipe_kind:  string,
 *       applied:          boolean,
 *       success:          boolean,     // re-probe verdict (status === "ok")
 *       reprobe_status:   string|null, // null when applied=false
 *       reason:           string|null, // truncated re-probe reason
 *       skipped_reason:   string|null, // populated when applied=false
 *     }>
 *
 *   probeOne(provider, opts) ->
 *     { provider, status, reason } (mirrors scripts/hooks/lib/provider-health.js#probeAll row)
 *
 *
 * Recipe vocabulary (closed-set; T-023 ships exactly these):
 *
 *   set_env_and_reprobe
 *     - Recipe shape: { kind, env: { KEY: "value" }, scope: "process", max_retries: 1, note }
 *     - Effect:       Object.assign(process.env, env). Process-scoped only.
 *                     Never writes shell rc files. Never persists.
 *     - Used for:     trusted_directory_required
 *
 *   retry_with_same_timeout
 *     - Recipe shape: { kind, max_retries: 1, note }
 *     - Effect:       Re-invoke probeOne(provider) once.
 *     - Used for:     provider_timeout
 *
 * Any other recipe kind -> applied=false with skipped_reason="unknown_recipe_kind".
 *
 *
 * Cross-platform Windows stdin-bug guard (PRD R-8, AC-8.1): this module
 * performs ZERO subprocess invocations. It calls probeOne (the
 * provider-health primitive) which uses execSync with explicit stdio
 * pipes + bounded timeout. No `cat | codex` / `cat | gemini` patterns.
 */

"use strict";

// Recipe kinds the dispatcher is allowed to execute. Closed set — adding a
// new kind requires a catalog edit AND a code change here AND a test
// covering RT-2 (no auth mutation).
const ALLOWED_RECIPE_KINDS = Object.freeze([
  "set_env_and_reprobe",
  "retry_with_same_timeout",
]);

// Environment variable names the dispatcher is allowed to set. Any other
// key blocked even if the catalog says safe_to_autofix=true. RT-2 hard
// floor — prevents a malicious / accidental catalog edit from setting
// e.g. ANTHROPIC_API_KEY="hijacked" via set_env_and_reprobe.
const ALLOWED_ENV_KEYS = Object.freeze(["GEMINI_CLI_TRUST_WORKSPACE"]);

// Substrings in env-var names that ALWAYS block (defense in depth — never
// touch credential-looking variables even if someone adds them to
// ALLOWED_ENV_KEYS by mistake).
const FORBIDDEN_ENV_SUBSTRINGS = Object.freeze([
  "API_KEY",
  "TOKEN",
  "SECRET",
  "AUTH",
  "PASSWORD",
  "PASSWD",
  "CREDENTIAL",
  "OAUTH",
  "SESSION",
  "BEARER",
]);

function isAuthMutatingEnvKey(key) {
  if (typeof key !== "string") return true; // refuse anything not a plain string
  const upper = key.toUpperCase();
  return FORBIDDEN_ENV_SUBSTRINGS.some((s) => upper.includes(s));
}

function truncateReason(s) {
  if (typeof s !== "string") return null;
  return s.length > 200 ? s.slice(0, 200) : s;
}

/**
 * Apply set_env_and_reprobe.
 *
 * Effect: Object.assign(process.env, recipe.env). Process-scoped. Never
 * writes shell rc files. Never persists across process boundary.
 *
 * RT-2 guard chain:
 *   1. recipe.scope must be "process" (rejects "user", "system", file scope)
 *   2. each env key must be in ALLOWED_ENV_KEYS
 *   3. each env key must NOT contain a FORBIDDEN_ENV_SUBSTRINGS substring
 *
 * Returns { ok: true, applied: true } on success, or
 * { ok: false, skipped_reason } on any guard failure.
 */
function applySetEnvAndReprobe(recipe) {
  if (!recipe || typeof recipe !== "object") {
    return { ok: false, skipped_reason: "recipe_invalid" };
  }
  if (recipe.scope !== "process") {
    return { ok: false, skipped_reason: "recipe_scope_not_process" };
  }
  if (!recipe.env || typeof recipe.env !== "object") {
    return { ok: false, skipped_reason: "recipe_env_missing" };
  }
  const envKeys = Object.keys(recipe.env);
  if (envKeys.length === 0) {
    return { ok: false, skipped_reason: "recipe_env_empty" };
  }
  for (const k of envKeys) {
    if (!ALLOWED_ENV_KEYS.includes(k)) {
      return { ok: false, skipped_reason: "env_key_not_allowed: " + k };
    }
    if (isAuthMutatingEnvKey(k)) {
      // Defense in depth — should be unreachable given ALLOWED_ENV_KEYS, but
      // we keep this guard so adding a creds-looking name to the allowlist
      // cannot bypass the forbidden-substring filter.
      return { ok: false, skipped_reason: "env_key_auth_mutating: " + k };
    }
    const v = recipe.env[k];
    if (typeof v !== "string") {
      return { ok: false, skipped_reason: "env_value_not_string: " + k };
    }
  }
  for (const k of envKeys) {
    process.env[k] = recipe.env[k];
  }
  return { ok: true };
}

/**
 * Apply retry_with_same_timeout. Pure no-op in terms of state — the caller
 * re-invokes probeOne after we return ok.
 */
function applyRetryWithSameTimeout(recipe) {
  if (!recipe || typeof recipe !== "object") {
    return { ok: false, skipped_reason: "recipe_invalid" };
  }
  // max_retries reserved for future; T-023 always re-probes once.
  return { ok: true };
}

/**
 * Main entrypoint.
 *
 * @param {object} args
 * @param {Array<object>} args.rca         RCA entries from provider-rca.js
 * @param {Function} args.probeOne         (provider, opts) -> {provider,status,reason}
 * @param {Function} [args.log]            (level, payload) -> void (audit logger)
 * @param {boolean} [args.noAutofix=false] If true, skip all recipes and emit no audit events.
 * @param {Function} [args.print]          (line) -> void  default: process.stdout.write(line+"\n")
 * @returns {Array<object>} attempt records (see contract above)
 */
function runAutofixes(args) {
  args = args || {};
  const rca = Array.isArray(args.rca) ? args.rca : [];
  const probeOne = typeof args.probeOne === "function" ? args.probeOne : null;
  const logFn = typeof args.log === "function" ? args.log : null;
  const noAutofix = !!args.noAutofix;
  const print =
    typeof args.print === "function"
      ? args.print
      : (s) => {
          process.stdout.write(s);
        };

  // AC-5.3: --no-autofix bypass. Print exactly one line, emit no events,
  // return empty attempts so the orchestrator falls through to remediation.
  if (noAutofix) {
    if (rca.some((e) => e && e.safe_to_autofix === true)) {
      print("Auto-fix skipped (--no-autofix)\n");
    }
    return [];
  }

  if (!probeOne) {
    // Without a re-prober we cannot fulfil AC-5.1 (re-probe once). Skip
    // the whole batch with a single audit event so we leave a trace.
    if (logFn) {
      try {
        logFn("audit", {
          type: "autofix",
          action: "provider-autofix-skipped",
          reason: "probeOne_missing",
        });
      } catch (e) {
        /* never crash on logging */
      }
    }
    return [];
  }

  const out = [];

  for (const e of rca) {
    if (!e || typeof e !== "object") continue;
    // AC-5.2: skip safe_to_autofix=false. NO audit event emitted (the rca
    // event upstream already records the entry).
    if (e.safe_to_autofix !== true) continue;

    const provider = e.provider;
    const originalStatus = e.status;
    const recipe = e.fix_recipe;
    const recipeKind = recipe && recipe.kind;

    // Closed-set check first — unknown kinds are dead on arrival.
    if (!ALLOWED_RECIPE_KINDS.includes(recipeKind)) {
      const rec = {
        provider: provider,
        original_status: originalStatus,
        fix_recipe_kind: recipeKind || null,
        applied: false,
        success: false,
        reprobe_status: null,
        reason: null,
        skipped_reason: "unknown_recipe_kind",
      };
      out.push(rec);
      if (logFn) {
        try {
          logFn("audit", {
            type: "autofix",
            action: "provider-autofix-skipped",
            provider: provider,
            original_status: originalStatus,
            fix_recipe_kind: recipeKind || null,
            applied: false,
            success: false,
            reason: "unknown_recipe_kind",
          });
        } catch (err) {
          /* never crash on logging */
        }
      }
      continue;
    }

    // Apply the recipe.
    let applyResult;
    if (recipeKind === "set_env_and_reprobe") {
      applyResult = applySetEnvAndReprobe(recipe);
    } else if (recipeKind === "retry_with_same_timeout") {
      applyResult = applyRetryWithSameTimeout(recipe);
    } else {
      // Unreachable given the ALLOWED_RECIPE_KINDS check above.
      applyResult = { ok: false, skipped_reason: "unknown_recipe_kind" };
    }

    if (!applyResult.ok) {
      const rec = {
        provider: provider,
        original_status: originalStatus,
        fix_recipe_kind: recipeKind,
        applied: false,
        success: false,
        reprobe_status: null,
        reason: null,
        skipped_reason: applyResult.skipped_reason,
      };
      out.push(rec);
      if (logFn) {
        try {
          logFn("audit", {
            type: "autofix",
            action: "provider-autofix-skipped",
            provider: provider,
            original_status: originalStatus,
            fix_recipe_kind: recipeKind,
            applied: false,
            success: false,
            reason: applyResult.skipped_reason,
          });
        } catch (err) {
          /* never crash on logging */
        }
      }
      continue;
    }

    // AC-5.1: re-probe exactly once. probeOne is defensive — if it throws
    // for any reason, we record applied:true success:false.
    let reprobe;
    try {
      reprobe = probeOne(provider, {});
    } catch (err) {
      reprobe = {
        provider: provider,
        status: "unknown_error",
        reason:
          "reprobe_threw: " + (err && err.message ? err.message : String(err)),
      };
    }
    const reprobeStatus =
      reprobe && typeof reprobe.status === "string"
        ? reprobe.status
        : "unknown_error";
    const success = reprobeStatus === "ok";

    // C-4 stdout. We deliberately use a one-line summary plus the re-probe
    // verdict; the verbose remediation lives with the smoke renderer.
    print(
      "Auto-fix: " +
        provider +
        "." +
        originalStatus +
        " -> recipe " +
        recipeKind +
        "\n",
    );
    print("  re-probe: " + (success ? "ok" : reprobeStatus) + "\n");

    const rec = {
      provider: provider,
      original_status: originalStatus,
      fix_recipe_kind: recipeKind,
      applied: true,
      success: success,
      reprobe_status: reprobeStatus,
      reason: truncateReason(reprobe && reprobe.reason),
      skipped_reason: null,
    };
    out.push(rec);

    if (logFn) {
      try {
        logFn("audit", {
          type: "autofix",
          action: "provider-autofix-attempted",
          provider: provider,
          original_status: originalStatus,
          fix_recipe_kind: recipeKind,
          applied: true,
          success: success,
          reprobe_status: reprobeStatus,
        });
      } catch (err) {
        /* never crash on logging */
      }
    }
  }

  return out;
}

module.exports = {
  runAutofixes: runAutofixes,
  ALLOWED_RECIPE_KINDS: ALLOWED_RECIPE_KINDS,
  ALLOWED_ENV_KEYS: ALLOWED_ENV_KEYS,
  FORBIDDEN_ENV_SUBSTRINGS: FORBIDDEN_ENV_SUBSTRINGS,
  isAuthMutatingEnvKey: isAuthMutatingEnvKey,
  // Exported for unit tests; not part of the public contract.
  _applySetEnvAndReprobe: applySetEnvAndReprobe,
  _applyRetryWithSameTimeout: applyRetryWithSameTimeout,
};
