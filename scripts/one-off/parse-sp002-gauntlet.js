#!/usr/bin/env node
/**
 * Parse the 4 gauntlet result files for SP-20260512-002 Part 3.
 * Extracts the inner JSON envelope and prints a digest.
 */
const fs = require("fs");
const path = require("path");
const { parseProviderJson } = require("../hooks/lib/providers");

const RESULTS = path.resolve(
  __dirname,
  "../../.claude/runtime/gauntlet-sp002-results",
);
const ROLES = ["reviewer", "compliance", "qa", "redteam"];

function safeRead(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch (e) {
    return null;
  }
}

const out = {};
for (const role of ROLES) {
  const file = path.join(RESULTS, `${role}.json`);
  const raw = safeRead(file);
  const stderr = safeRead(path.join(RESULTS, `${role}.stderr`));
  if (!raw) {
    out[role] = { ok: false, reason: "no result file", stderr };
    continue;
  }
  // dispatch-agent wraps the provider output: {ok, provider, model, role, output, ...}
  let envelope = null;
  try {
    envelope = JSON.parse(raw);
  } catch (e) {
    out[role] = {
      ok: false,
      reason: "outer JSON parse failed",
      raw_head: raw.slice(0, 500),
      stderr,
    };
    continue;
  }
  const inner = envelope.output;
  if (!inner) {
    out[role] = {
      ok: false,
      reason: "no .output field in envelope",
      envelope,
      stderr,
    };
    continue;
  }
  // parseProviderJson extracts the last ```json fence
  const parsed = parseProviderJson(inner);
  out[role] = {
    ok: envelope.ok,
    provider: envelope.provider,
    model: envelope.model,
    inner_chars: inner.length,
    parsed,
    stderr_tail: stderr ? stderr.split(/\r?\n/).slice(-15).join("\n") : null,
  };
}

console.log(JSON.stringify(out, null, 2));
