#!/usr/bin/env node
/**
 * provider-smoke.js -- Orchestrator that wraps probeAll + classifies
 * green/yellow/red + emits a single smoke event. T-019 ships the
 * skeleton; downstream tickets fill the RCA + autofix slots.
 *
 * Sprint:  SP-20260513-002
 * Ticket:  T-20260513-019
 * Schema:  warpos/provider-smoke/v1
 *
 * Usage:
 *   node scripts/warpos/provider-smoke.js
 *     [--providers a,b,c]   default: claude,openai,gemini
 *     [--probe list]        default: ""  (presence-only)
 *     [--json]              default: false (human output, see COPY C-1)
 *     [--exit-on-yellow]    default: false (PRD R-7 -- yellow exits 0)
 *     [--no-autofix]        default: false (T-023 will honour)
 *     [--target <root>]     default: cwd
 *
 * Exit codes (PRD R-7):
 *   0 -- all green.
 *   0 -- yellow-only (unless --exit-on-yellow -> 2).
 *   1 -- internal error (catalog-load failure once T-021 lands; argv validation
 *        failures also exit 1: unknown_provider, unknown_probe_mode, invalid_target).
 *   2 -- at least one red required-provider.
 *
 * CONTRACT -- DO NOT BREAK without bumping schema version.
 *
 *   JSON output:
 *     { schema, verdict, results, rca, autofixes, duration_ms,
 *       catalog_version, invoked_from }
 *
 *   `rca` and `autofixes` are STUB arrays in T-019 (always []). T-022 / T-023
 *   will populate them. SP-20260513-005's postflight-recovery chain consumes
 *   the same JSON envelope (generic fallback per beta directive c2_wording).
 *
 *   COPY C-1 (human mode): "Provider Smoke -- GREEN/YELLOW/RED" header,
 *   48-char separator, icons ok/!!/xx, padded provider+status columns.
 *
 *   Cross-platform Windows stdin-bug guard (PRD R-8, RT-5):
 *   This orchestrator NEVER shells out to `codex exec` / `gemini -p` directly.
 *   All provider probing routes through probeAll() in provider-health.js,
 *   which uses execSync with explicit stdio:["pipe","pipe","pipe"] and a
 *   bounded timeout. Adding any `cat | codex` / `cat | gemini` invocation
 *   here re-introduces the LRN-2026-04-17-n / LRN-2026-04-30 binding-gap bug
 *   class and fails AC-8.1.
 */

"use strict";

const path = require("path");
const fs = require("fs");

const { probeAll, probeProvider } = require(
  path.join(__dirname, "..", "hooks", "lib", "provider-health.js"),
);
const { log } = require(
  path.join(__dirname, "..", "hooks", "lib", "logger.js"),
);
// T-022: pure-function RCA module. Stays at module scope so caller cost is one
// require, not one per invocation. No I/O in the module itself.
const { rcaFor } = require(path.join(__dirname, "lib", "provider-rca.js"));
// T-023: safe-only auto-fix dispatcher. Runs only fix_recipes whose RCA
// entry has safe_to_autofix === true. RT-2 enforced by ALLOWED_RECIPE_KINDS
// + ALLOWED_ENV_KEYS + FORBIDDEN_ENV_SUBSTRINGS allowlists in the module.
const { runAutofixes } = require(
  path.join(__dirname, "lib", "provider-autofix.js"),
);

// Constants ---------------------------------------------------

const SCHEMA = "warpos/provider-smoke/v1";

// Hard-coded for T-019. When T-021 mints provider-failure-modes.json with a
// `known_providers` field, this list will be loaded from the catalog and this
// constant will be replaced.
const KNOWN_PROVIDERS = ["claude", "openai", "gemini"];

const PROBE_MODES = ["", "list"];

// Provider token validation. Rejects shell-meta characters (RT-1 redteam
// defense for malicious `--providers "codex;rm -rf /"` payloads).
const PROVIDER_TOKEN_RE = /^[a-z][a-z0-9_-]{1,31}$/;

const SEP_CHAR = "─"; // box-drawings light horizontal
const SEP = SEP_CHAR.repeat(48);

// Argv parser (mirrors provider-health-check.js style) --------

function parseArgs(argv) {
  const args = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (
        next === undefined ||
        (typeof next === "string" && next.startsWith("--"))
      ) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args.positional.push(a);
    }
  }
  return args;
}

// Validation --------------------------------------------------

function validateProviders(rawList) {
  // rawList comes from `--providers a,b,c`. Split ONLY on ',' (no shell
  // metachars passed through, no whitespace trimmed). Each token must match
  // PROVIDER_TOKEN_RE AND appear in KNOWN_PROVIDERS. Empty tokens (consecutive
  // commas, leading/trailing comma, or whitespace-only) are rejected. Exit 1
  // on first failure. Strict validation = RT-1 defense.
  //
  // `--providers` with no value (rawList === true) or unset (undefined) -> default.
  if (rawList === undefined || rawList === true) {
    return KNOWN_PROVIDERS.slice();
  }
  if (typeof rawList !== "string") {
    process.stderr.write("unknown_provider: " + String(rawList) + "\n");
    process.exit(1);
  }
  // NO trim, NO filter. Strict CSV.
  const tokens = rawList.split(",");
  if (tokens.length === 0) {
    process.stderr.write("unknown_provider: <empty>\n");
    process.exit(1);
  }
  for (const t of tokens) {
    if (t === "") {
      // Empty token from `claude,,openai` or trailing comma.
      process.stderr.write("unknown_provider: <empty>\n");
      process.exit(1);
    }
    if (!PROVIDER_TOKEN_RE.test(t)) {
      process.stderr.write("unknown_provider: " + t + "\n");
      process.exit(1);
    }
    if (!KNOWN_PROVIDERS.includes(t)) {
      process.stderr.write("unknown_provider: " + t + "\n");
      process.exit(1);
    }
  }
  return tokens;
}

function validateProbe(rawProbe) {
  // Default probe mode is "" (presence-only). Both `--probe` with no value
  // and `--probe ""` resolve to the default; only an explicit non-enum value
  // (e.g. `--probe list-secret`) is rejected.
  if (rawProbe === undefined) return "";
  if (rawProbe === true) return ""; // bare `--probe` = use default
  const val = String(rawProbe);
  if (!PROBE_MODES.includes(val)) {
    process.stderr.write("unknown_probe_mode: " + val + "\n");
    process.exit(1);
  }
  return val;
}

function validateTarget(rawTarget) {
  // Optional. If supplied, must be a non-empty string with NO `..` segments
  // before resolve (so `../outside` is rejected, not silently normalized).
  // T-019 only stores --target on the result object; future tickets will
  // act on it, so the strict pre-resolve check is the right place to plant
  // the defense.
  if (rawTarget === undefined) return process.cwd();
  if (rawTarget === true || rawTarget === "") {
    process.stderr.write("invalid_target: <empty>\n");
    process.exit(1);
  }
  const s = String(rawTarget);
  if (s.length === 0) {
    process.stderr.write("invalid_target: <empty>\n");
    process.exit(1);
  }
  // Check `..` BEFORE resolve. path.resolve normalizes `..` away, which would
  // mask traversal attempts. Inspect the raw input string for any `..` segment
  // surrounded by separators (\\, /, start/end of string). Trim each segment
  // first so Windows trailing-space tricks (e.g. `.. /x` or `.../..  `) cannot
  // smuggle a parent ref past the literal-match check.
  const segments = s.split(/[\\/]/);
  if (segments.some((seg) => seg.trim() === "..")) {
    process.stderr.write("invalid_target: " + s + "\n");
    process.exit(1);
  }
  // Null byte rejection (defense-in-depth).
  if (s.indexOf("\0") !== -1) {
    process.stderr.write("invalid_target: <null-byte>\n");
    process.exit(1);
  }
  let resolved;
  try {
    resolved = path.resolve(s);
  } catch (e) {
    process.stderr.write("invalid_target: " + s + "\n");
    process.exit(1);
  }
  return resolved;
}

// Verdict classification (mirrors provider-health-check.js 60-71) -----

function classify(results) {
  const isGreen = (r) => r && r.status === "ok";
  const isYellow = (r) =>
    r &&
    ["cli_missing", "auth_source_mismatch", "stale_cli_registry"].includes(
      r.status,
    );
  const isRed = (r) => r && !isGreen(r) && !isYellow(r);
  if (results.some(isRed)) return "red";
  if (results.some(isYellow)) return "yellow";
  return "green";
}

// Catalog loader (stub; T-021 mints the real file) ------------

// AC-3.2: corrupt / unparseable catalog file -> exit 1 with
// `catalog_load_error: <reason>` (NOT exit 2, which is reserved for a red
// provider verdict). MISSING catalog file is still a soft fail: smoke
// continues with empty entries and `catalog_version: null` (lets a fresh
// install run before T-021 has been pulled in). The distinction matters
// because operators can run smoke in environments where the catalog hasn't
// yet been written by the upstream capsule — those should not be hard
// failures, but a broken-JSON catalog IS operator-facing drift.
//
// Return shape: { entries, version, ok, error? }. Callers (run) inspect
// `ok` to decide between continuing and exiting 1.
function loadFailureModeCatalog() {
  const catalogPath = path.join(
    process.cwd(),
    ".claude",
    "agents",
    "00-alex",
    ".system",
    "policy",
    "provider-failure-modes.json",
  );
  if (!fs.existsSync(catalogPath)) {
    return { entries: {}, version: null, ok: true };
  }
  let raw;
  try {
    raw = fs.readFileSync(catalogPath, "utf8");
  } catch (e) {
    return {
      entries: {},
      version: null,
      ok: false,
      error: "read_failed: " + (e && e.message ? e.message : String(e)),
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      entries: {},
      version: null,
      ok: false,
      error: "parse_failed: " + (e && e.message ? e.message : String(e)),
    };
  }
  if (!parsed || typeof parsed !== "object") {
    return {
      entries: {},
      version: null,
      ok: false,
      error: "schema_invalid: not an object",
    };
  }
  if (!parsed.entries || typeof parsed.entries !== "object") {
    return {
      entries: {},
      version: null,
      ok: false,
      error: "schema_invalid: entries map missing",
    };
  }
  return {
    entries: parsed.entries,
    version: parsed.version || null,
    ok: true,
  };
}

// Human output (COPY C-1) -------------------------------------

function iconFor(status) {
  if (status === "ok") return "ok";
  if (
    ["cli_missing", "auth_source_mismatch", "stale_cli_registry"].includes(
      status,
    )
  ) {
    return "!!";
  }
  return "xx";
}

function renderHuman(verdict, results, rca) {
  const out = [];
  const header =
    verdict === "green"
      ? "Provider Smoke — GREEN"
      : verdict === "yellow"
        ? "Provider Smoke — YELLOW (non-fatal)"
        : "Provider Smoke — RED (blocking)";
  out.push(header);
  out.push(SEP);
  // T-022: when rca array is provided, look up the per-provider RCA entry
  // to surface the catalog root_cause on red rows. When rca is omitted
  // (existing T-019 unit-test call sites), fall back to the prior stub
  // behavior so backwards compatibility holds. Build a quick provider->rca
  // map once outside the row loop.
  const rcaByProvider = {};
  if (Array.isArray(rca)) {
    for (const e of rca) {
      if (e && e.provider) rcaByProvider[e.provider] = e;
    }
  }
  for (const r of results) {
    const ic = iconFor(r.status);
    const prov = String(r.provider || "?").padEnd(8);
    const stat = String(r.status || "?").padEnd(12);
    let suffix = "";
    if (r.status === "ok") {
      suffix = r.reason ? r.reason : "";
    } else if (ic === "!!") {
      suffix = r.reason ? r.reason : "";
    } else {
      // RED -- prefer the rca catalog root_cause; fall back to the T-019
      // stub form when no rca was passed (legacy test call sites).
      const rcaEntry = rcaByProvider[r.provider];
      if (rcaEntry && rcaEntry.root_cause) {
        suffix = "root_cause=" + rcaEntry.root_cause;
      } else {
        suffix = "root_cause=" + r.status;
      }
    }
    out.push(("  " + ic + "  " + prov + " " + stat + " " + suffix).trimEnd());
  }
  if (verdict === "green") {
    out.push("All required providers ready.");
  } else if (verdict === "yellow") {
    out.push("Update may proceed. Run `/warp:health` for remediation.");
  } else {
    out.push(
      "Install/update aborted. See remediation above. Re-run after fixing.",
    );
  }
  return out.join("\n") + "\n";
}

// Main run path (callable for tests via require) --------------

function run(rawArgv) {
  const t0 = Date.now();
  const args = parseArgs(rawArgv);

  const providers = validateProviders(args.providers);
  const probeMode = validateProbe(args.probe);
  const jsonMode = !!args.json;
  const exitOnYellow = !!args["exit-on-yellow"];
  const noAutofix = !!args["no-autofix"]; // honoured by T-023 dispatcher
  const target = validateTarget(args.target);

  const catalog = loadFailureModeCatalog();

  // AC-3.2: corrupt catalog -> exit 1 with diagnostic. Log one audit event
  // so the failure shows in events.jsonl (TR-1 invariant: exactly one
  // smoke-related audit event per invocation). No probes run.
  if (catalog.ok === false) {
    const errMsg = "catalog_load_error: " + catalog.error;
    process.stderr.write(errMsg + "\n");
    try {
      log("audit", {
        type: "smoke",
        action: "provider-smoke-aborted",
        verdict: "error",
        providers: providers,
        duration_ms: Date.now() - t0,
        exit_code: 1,
        invoked_from: "standalone",
        schema_version: SCHEMA,
        catalog_version: null,
        no_autofix: !!args["no-autofix"],
        probe_mode: probeMode,
        target: target,
        error: catalog.error,
      });
    } catch (e) {
      /* never crash on logging */
    }
    return {
      exitCode: 1,
      verdict: "error",
      results: [],
      rca: [],
      autofixes: [],
      catalog: { entries: {}, version: null },
    };
  }

  // Run probes. probeAll handles its own per-provider safety and timeouts;
  // it never throws.
  const results = probeAll(providers, { probe: probeMode });

  // `verdict` and `exitCode` are reassigned after the auto-fix dispatcher
  // runs (AC-5.1: a successful auto-fix flips the provider to green and
  // therefore changes the verdict).
  let verdict = classify(results);

  // Exit-code policy (PRD R-7)
  let exitCode;
  if (verdict === "red") exitCode = 2;
  else if (verdict === "yellow") exitCode = exitOnYellow ? 2 : 0;
  else exitCode = 0;

  // T-022: RCA classification — one entry per non-green result, derived
  // from the failure-mode catalog. Pure function, no I/O. Schema slot
  // `rca` on warpos/provider-smoke/v1 unchanged (was already an array).
  const rca = rcaFor(results, catalog);

  // T-023: safe-only auto-fix dispatcher. Only entries with
  // safe_to_autofix === true get a recipe run. RT-2 enforced inside the
  // module (closed recipe-kind set + env-key allowlist + forbidden auth
  // substring check). Re-probes exactly once per attempt; never loops.
  // --no-autofix bypass: prints exactly one notice line and returns [].
  const autofixes = runAutofixes({
    rca: rca,
    probeOne: (providerName) =>
      probeProvider(providerName, { probe: probeMode }),
    log: log,
    noAutofix: noAutofix,
    print: jsonMode ? () => {} : (s) => process.stdout.write(s),
  });

  // AC-5.1: a successful autofix re-probe should flip its provider's verdict
  // to green for the final exit-code decision. Reconcile here: for each
  // applied+success attempt, set results[provider].status to "ok" and
  // re-classify. We keep the original observed status in the rca entry so
  // the events trail is preserved.
  if (autofixes.length > 0) {
    let anyApplied = false;
    for (const a of autofixes) {
      if (a && a.applied && a.success) {
        anyApplied = true;
        for (const r of results) {
          if (r && r.provider === a.provider) {
            r.status = "ok";
            r.reason =
              "auto-fix " +
              a.fix_recipe_kind +
              " -> ok (was " +
              a.original_status +
              ")";
          }
        }
      }
    }
    if (anyApplied) {
      const newVerdict = classify(results);
      // Overwrite verdict + exit code in lockstep so the JSON envelope and
      // human renderer see the same view.
      if (newVerdict !== verdict) {
        verdict = newVerdict;
        if (newVerdict === "red") exitCode = 2;
        else if (newVerdict === "yellow") exitCode = exitOnYellow ? 2 : 0;
        else exitCode = 0;
      }
    }
  }

  // duration_ms is computed AFTER autofix because the re-probe is part of
  // the smoke run from the operator's perspective.
  const duration_ms = Date.now() - t0;

  // Emit ONE smoke event (TR-1).
  try {
    log("audit", {
      type: "smoke",
      action: "provider-smoke-complete",
      verdict: verdict,
      providers: providers,
      duration_ms: duration_ms,
      exit_code: exitCode,
      invoked_from: "standalone",
      schema_version: SCHEMA,
      catalog_version: catalog.version,
      no_autofix: noAutofix,
      probe_mode: probeMode,
      target: target,
    });
  } catch (e) {
    /* never crash on logging */
  }

  if (jsonMode) {
    const payload = {
      schema: SCHEMA,
      verdict: verdict,
      results: results,
      rca: rca,
      autofixes: autofixes,
      duration_ms: duration_ms,
      catalog_version: catalog.version,
      invoked_from: "standalone",
    };
    process.stdout.write(JSON.stringify(payload) + "\n");
  } else {
    process.stdout.write(renderHuman(verdict, results, rca));
  }

  return {
    exitCode: exitCode,
    verdict: verdict,
    results: results,
    rca: rca,
    autofixes: autofixes,
    catalog: catalog,
  };
}

// Exports (for unit tests) ------------------------------------

module.exports = {
  SCHEMA: SCHEMA,
  KNOWN_PROVIDERS: KNOWN_PROVIDERS,
  PROBE_MODES: PROBE_MODES,
  PROVIDER_TOKEN_RE: PROVIDER_TOKEN_RE,
  parseArgs: parseArgs,
  classify: classify,
  loadFailureModeCatalog: loadFailureModeCatalog,
  renderHuman: renderHuman,
  run: run,
};

// CLI entrypoint ----------------------------------------------

if (require.main === module) {
  const result = run(process.argv.slice(2));
  process.exit(result.exitCode);
}
