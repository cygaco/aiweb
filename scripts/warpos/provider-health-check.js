#!/usr/bin/env node
/**
 * provider-health-check.js — CLI wrapper for provider-health.js. Surfaces
 * green/yellow/red per provider with a one-line suggestion for every
 * non-green state.
 *
 * Phase 0 workstream E. Invoked by /warp:health, /warp:setup, and any
 * operator who just wants to know "can I dispatch right now?".
 *
 * Usage:
 *   node scripts/warpos/provider-health-check.js [--summary] [--probe list]
 *                                                [--providers claude,openai,gemini]
 *                                                [--json]
 *
 * Exit codes:
 *   0 — all providers ok OR only warnings.
 *   2 — at least one required provider is red.
 */

"use strict";

const path = require("path");
const { probeAll } = require(
  path.join(__dirname, "..", "hooks", "lib", "provider-health.js"),
);

function parseArgs(argv) {
  const args = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
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

const args = parseArgs(process.argv.slice(2));
const probeMode = args.probe || "";
const json = !!args.json;
const summary = !!args.summary;
const providers = args.providers
  ? String(args.providers)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : ["claude", "openai", "gemini"];

const results = probeAll(providers, { probe: probeMode });

const isGreen = (r) => r.status === "ok";
const isYellow = (r) =>
  ["cli_missing", "auth_source_mismatch", "stale_cli_registry"].includes(
    r.status,
  );
const isRed = (r) => !isGreen(r) && !isYellow(r);

const verdict = results.some(isRed)
  ? "red"
  : results.some(isYellow)
    ? "yellow"
    : "green";

if (json) {
  process.stdout.write(JSON.stringify({ verdict, results }, null, 2) + "\n");
} else {
  process.stdout.write(`Provider Health — ${verdict.toUpperCase()}\n`);
  process.stdout.write("─".repeat(48) + "\n");
  for (const r of results) {
    const icon = isGreen(r) ? "✓" : isYellow(r) ? "!" : "✗";
    process.stdout.write(`  ${icon} ${r.provider.padEnd(8)} ${r.status}\n`);
    if (!summary) {
      if (r.reason) process.stdout.write(`     reason: ${r.reason}\n`);
      if (r.suggestion) process.stdout.write(`     fix:    ${r.suggestion}\n`);
      if (r.detail) {
        const detail =
          typeof r.detail === "string" ? r.detail : JSON.stringify(r.detail);
        process.stdout.write(`     detail: ${detail}\n`);
      }
    }
  }
}

// Hard-fail only on a required-provider red. claude is always ok (harness).
// gemini / openai red is yellow at the top-level for now (fall-back path
// exists). Exit 2 reserved for future use when policy requires one specific
// provider.
process.exit(0);
