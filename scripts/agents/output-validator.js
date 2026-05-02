#!/usr/bin/env node
/**
 * Validates and normalizes build-chain agent JSON envelopes.
 */

function extractJson(text) {
  if (!text) return null;
  if (typeof text === "object") return text;
  const raw = String(text).trim();
  try {
    return JSON.parse(raw);
  } catch {
    // fall through
  }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      return null;
    }
  }
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(raw.slice(first, last + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function normalize(role, parsed) {
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, errors: ["no JSON object found"], normalized: null };
  }
  if (parsed.tool_response) {
    parsed = extractJson(parsed.tool_response) || parsed;
  }
  const agent = parsed.agent || role || parsed.role || "unknown";
  let verdict = parsed.verdict || parsed.status || null;
  if (!verdict && typeof parsed.pass === "boolean") verdict = parsed.pass ? "pass" : "fail";
  if (typeof verdict === "string") verdict = verdict.toLowerCase();
  if (verdict === "built") verdict = "pass";
  if (verdict === "skip") verdict = "pass";
  if (verdict === "warning") verdict = "warn";

  const findings = Array.isArray(parsed.findings)
    ? parsed.findings
    : Array.isArray(parsed.violations)
      ? parsed.violations
      : Array.isArray(parsed.vulnerabilities)
        ? parsed.vulnerabilities
        : [];

  const normalized = {
    agent,
    version: parsed.version || 1,
    verdict,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
    findings,
    requiresHuman: Boolean(parsed.requiresHuman || parsed.requires_human),
    raw: parsed,
  };

  const errors = [];
  if (!["pass", "warn", "fail"].includes(normalized.verdict)) {
    errors.push(`invalid verdict ${JSON.stringify(normalized.verdict)}`);
  }
  if (!Array.isArray(normalized.findings)) errors.push("findings must be an array");
  return { ok: errors.length === 0, errors, normalized };
}

function validate(role, output) {
  return normalize(role, extractJson(output));
}

if (require.main === module) {
  const role = process.argv[2] || "unknown";
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (input += c));
  process.stdin.on("end", () => {
    const result = validate(role, input);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 2);
  });
}

module.exports = { extractJson, normalize, validate };
