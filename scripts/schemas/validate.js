#!/usr/bin/env node

/**
 * scripts/schemas/validate.js — config $schema validation (Phase 2E).
 *
 * Validates that each WarpOS-managed JSON config declares its `$schema`
 * field and uses a supported version.
 *
 * Files checked:
 *   .claude/manifest.json             expected: warpos/manifest/v1
 *   .claude/paths.json                expected: warpos/paths/v<registry-version>
 *   .claude/settings.json             expected: https://json.schemastore.org/claude-code-settings.json
 *   .claude/framework-manifest.json   expected: warpos/framework-manifest/v2
 *   .claude/framework-installed.json  expected: warpos/framework-installed/v2 (only if file exists)
 *
 * Usage:
 *   node scripts/schemas/validate.js              # report
 *   node scripts/schemas/validate.js --json       # JSON output
 *   node scripts/schemas/validate.js --strict     # exit 1 on any finding
 *
 * Wired into:
 *   /check:environment   — fails on unsupported schema version
 *   /preflight:run       — Pass (TBD): schema check before build
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const FLAGS = {
  json: argv.includes("--json"),
  strict: argv.includes("--strict"),
};

function readJsonOrNull(file) {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function getRegistryVersion() {
  const reg = readJsonOrNull(path.join(ROOT, "warpos", "paths.registry.json"));
  return reg.ok && reg.data ? reg.data.version : null;
}

function validateFile(rel, expected, optional = false) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    if (optional) return { rel, status: "skip", reason: "file does not exist" };
    return { rel, status: "fail", reason: "file does not exist" };
  }
  const result = readJsonOrNull(file);
  if (!result.ok) {
    return { rel, status: "fail", reason: `invalid JSON: ${result.error}` };
  }
  const actual = result.data && result.data.$schema;
  if (!actual) {
    return {
      rel,
      status: "fail",
      reason: `missing $schema field (expected ${JSON.stringify(expected)})`,
    };
  }
  const expectedList = Array.isArray(expected) ? expected : [expected];
  if (!expectedList.includes(actual)) {
    return {
      rel,
      status: "fail",
      reason: `unsupported $schema ${JSON.stringify(actual)} (expected one of ${JSON.stringify(expectedList)})`,
    };
  }
  return { rel, status: "ok", schema: actual };
}

function main() {
  const registryVersion = getRegistryVersion();
  const expectedPathsSchema = registryVersion
    ? `warpos/paths/v${registryVersion}`
    : null;

  const checks = [
    validateFile(".claude/manifest.json", "warpos/manifest/v1"),
    expectedPathsSchema
      ? validateFile(".claude/paths.json", expectedPathsSchema)
      : {
          rel: ".claude/paths.json",
          status: "skip",
          reason: "registry version unavailable",
        },
    validateFile(
      ".claude/settings.json",
      "https://json.schemastore.org/claude-code-settings.json",
    ),
    validateFile(".claude/framework-manifest.json", [
      "warpos/framework-manifest/v1",
      "warpos/framework-manifest/v2",
    ]),
    validateFile(
      ".claude/framework-installed.json",
      "warpos/framework-installed/v2",
      true,
    ),
  ];

  const fails = checks.filter((c) => c.status === "fail");
  const skips = checks.filter((c) => c.status === "skip");

  if (FLAGS.json) {
    console.log(
      JSON.stringify(
        {
          ok: fails.length === 0,
          counts: {
            fail: fails.length,
            skip: skips.length,
            ok: checks.length - fails.length - skips.length,
          },
          checks,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `\nscripts/schemas/validate.js — ${checks.length} configs checked\n`,
    );
    for (const c of checks) {
      const symbol =
        c.status === "ok" ? "ok   " : c.status === "skip" ? "skip " : "FAIL ";
      console.log(
        `  ${symbol} ${c.rel.padEnd(40)} ${c.reason || c.schema || ""}`,
      );
    }
    if (fails.length > 0) {
      console.log(
        `\n  ${fails.length} validation failure(s). Fix before /preflight:run.`,
      );
    } else {
      console.log("\n  All checked configs declare a supported $schema.");
    }
    console.log("");
  }

  process.exit(fails.length > 0 ? 1 : 0);
}

main();
