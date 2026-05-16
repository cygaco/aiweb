#!/usr/bin/env node
/**
 * sprint-tracker-guard.js — PreToolUse Edit|Write hook.
 *
 * Sprint Workflow v0.1 (post-Phase-1). Catches hand-edits to sprint
 * tracker yaml that would corrupt the durable record. Two protections:
 *
 *   1. Schema validity. Any *.yaml under paths.sprintRoot (except under
 *      paths.sprintHistory and *.report.md) MUST validate against its
 *      declared schema (warpos/sprint/<name>/v1). Block on schema
 *      mismatch.
 *
 *   2. History immutability. paths.sprintHistory/* is append-only.
 *      Edits to an existing history yaml are blocked. New files are
 *      allowed (that's how a sprint gets archived).
 *
 * Both protections fail OPEN on internal error (parse failure, missing
 * schema dir, etc.) so the hook never accidentally breaks Write/Edit
 * for non-sprint files.
 *
 * Kill switch:
 *   env: SPRINT_GUARD=off
 *
 * The hook ONLY fires on Edit/Write tool events targeting files inside
 * paths.sprintRoot. All other paths return immediately.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

if (process.env.SPRINT_GUARD === "off") process.exit(0);

function readStdinSync() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function emitBlock(detail) {
  try {
    const { logEvent } = require("./lib/logger");
    logEvent(
      "block",
      "system",
      "sprint-tracker-guard",
      "",
      detail.slice(0, 400),
    );
  } catch {
    /* logger optional */
  }
  console.log(JSON.stringify({ decision: "block", reason: detail }));
  process.exit(0);
}

function emitWarn(detail) {
  try {
    const { logEvent } = require("./lib/logger");
    logEvent(
      "warn",
      "system",
      "sprint-tracker-guard",
      "",
      detail.slice(0, 400),
    );
  } catch {
    /* logger optional */
  }
  process.stderr.write("[sprint-tracker-guard] " + detail + "\n");
}

// Path-pattern → schema-kind. Keep in sync with schemas/sprint/*.schema.json.
// Order matters: more-specific patterns first. Each entry's regex matches
// against the repo-relative file_path (forward slashes only).
const SCHEMA_KIND_RULES = [
  // file-level singletons under sprintRoot
  {
    re: /^\.claude\/project\/sprint\/active-sprints\.yaml$/,
    kind: "active-sprints",
  },
  // per-sprint subdir layout (v0.2)
  {
    re: /^\.claude\/project\/sprint\/sprints\/SP-[0-9]{8}-[0-9]{3}\/current\.yaml$/,
    kind: "current-sprint",
  },
  {
    re: /^\.claude\/project\/sprint\/sprints\/SP-[0-9]{8}-[0-9]{3}\/progress\.yaml$/,
    kind: "sprint-progress",
  },
  // legacy v0.1 layout (paths.sprintCurrent / paths.sprintProgress)
  {
    re: /^\.claude\/project\/sprint\/current-sprint\.yaml$/,
    kind: "current-sprint",
  },
  {
    re: /^\.claude\/project\/sprint\/sprint-progress\.yaml$/,
    kind: "sprint-progress",
  },
  // id-prefixed artifacts under typed subdirs
  {
    re: /^\.claude\/project\/sprint\/approvals\/AP-[0-9]{8}-[0-9]{3}\.yaml$/,
    kind: "approval",
  },
  {
    re: /^\.claude\/project\/sprint\/tickets\/T-[0-9]{8}-[0-9]{3}\.yaml$/,
    kind: "ticket",
  },
  {
    re: /^\.claude\/project\/sprint\/releases\/RL-[0-9]{8}-[0-9]{3}\.yaml$/,
    kind: "release",
  },
  {
    re: /^\.claude\/project\/sprint\/issues\/I-[0-9]{8}-[0-9]{3}\.yaml$/,
    kind: "issue",
  },
  {
    re: /^\.claude\/project\/sprint\/plan-contracts\/PC-[0-9]{8}-[0-9]{4}\.yaml$/,
    kind: "plan-contract",
  },
  {
    re: /^\.claude\/project\/sprint\/external-services\/ESD-[0-9]{8}-[0-9]{3}\.yaml$/,
    kind: "external-service-dependency",
  },
  // checkpoint filename is "<SP-id>-NNNN.yaml" — checkpoints are sprint-progress shape
  {
    re: /^\.claude\/project\/sprint\/checkpoints\/SP-[0-9]{8}-[0-9]{3}-[0-9]{4}\.yaml$/,
    kind: "sprint-progress",
  },
  // ralph per-sprint subdir holds ralph-progress
  {
    re: /^\.claude\/project\/sprint\/ralph\/SP-[0-9]{8}-[0-9]{3}\/.*\.yaml$/,
    kind: "ralph-progress",
  },
  // history archive (also caught by Protection 2, but harmless to mention)
  {
    re: /^\.claude\/project\/sprint\/history\/SP-[0-9]{8}-[0-9]{3}\/sprint-history\.yaml$/,
    kind: "sprint-history",
  },
  // retrospective lives under sprint dir (free-form naming)
  {
    re: /^\.claude\/project\/sprint\/sprints\/SP-[0-9]{8}-[0-9]{3}\/retrospective\.yaml$/,
    kind: "sprint-retrospective",
  },
];

function inferSchemaKind(filePath) {
  for (const r of SCHEMA_KIND_RULES) {
    if (r.re.test(filePath)) return r.kind;
  }
  return null;
}

function emitAutoInject(filePath, kind, content) {
  // Prepend the schema header. Newline-safe.
  const header = `schema: warpos/sprint/${kind}/v1\n`;
  const newContent = header + content;
  try {
    const { logEvent } = require("./lib/logger");
    logEvent(
      "audit",
      "system",
      "sprint-tracker-auto-injected",
      filePath.slice(0, 120),
      `kind=${kind}`,
    );
  } catch {
    /* logger optional */
  }
  process.stderr.write(
    `[sprint-tracker-guard] auto-injected schema: warpos/sprint/${kind}/v1 → ${filePath}\n`,
  );
  // PreToolUse mutation: emit hookSpecificOutput.updatedInput with the
  // mutated tool input. Claude Code's PreToolUse hook contract supports
  // input mutation when a hook returns hookSpecificOutput with the
  // tool-specific updated input shape. If the harness ignores the mutated
  // input, the schema-missing case will fall through to the warn-only
  // branch below (we never block on auto-injectable paths anymore).
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: { content: newContent },
    },
  };
  console.log(JSON.stringify(output));
  process.exit(0);
}

function loadSprintPaths() {
  try {
    const raw = fs.readFileSync(
      path.join(PROJECT_DIR, ".claude", "paths.json"),
      "utf8",
    );
    const j = JSON.parse(raw);
    return {
      root: j.sprintRoot,
      history: j.sprintHistory,
      schemas: j.sprintSchemas,
    };
  } catch {
    return {
      root: ".claude/project/sprint",
      history: ".claude/project/sprint/history",
      schemas: "schemas/sprint",
    };
  }
}

function rel(absOrRel) {
  if (!absOrRel) return "";
  if (path.isAbsolute(absOrRel)) {
    return path.relative(PROJECT_DIR, absOrRel).replace(/\\/g, "/");
  }
  return absOrRel.replace(/\\/g, "/");
}

function extractTarget(event) {
  const input = event.tool_input || {};
  return {
    file_path: rel(input.file_path || ""),
    content:
      typeof input.content === "string"
        ? input.content
        : typeof input.new_string === "string"
          ? input.new_string
          : null,
    old_string: typeof input.old_string === "string" ? input.old_string : "",
  };
}

function isUnderSprintRoot(rel, root) {
  if (!rel || !root) return false;
  return rel === root || rel.startsWith(root.replace(/\/$/, "") + "/");
}

function isUnderHistory(rel, history) {
  if (!rel || !history) return false;
  return rel.startsWith(history.replace(/\/$/, "") + "/");
}

function loadSchemas(schemasDir) {
  const abs = path.join(PROJECT_DIR, schemasDir);
  if (!fs.existsSync(abs)) return {};
  const out = {};
  for (const f of fs.readdirSync(abs)) {
    if (!f.endsWith(".schema.json")) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(abs, f), "utf8"));
      if (j.$id) out[j.$id] = j;
    } catch {
      /* skip bad schema */
    }
  }
  return out;
}

// Minimal yaml subset parser — matches scripts/sprint/fs.js#parseMiniYaml
// enough to extract the `schema:` field. Full validation happens after
// requiring scripts/sprint/validate.js.
function extractSchemaField(text) {
  if (!text) return null;
  const m = text.match(/^schema:\s*(.+)$/m);
  if (!m) return null;
  let v = m[1].trim();
  // strip quotes
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  return v;
}

function tryYamlParse(text) {
  // Try to use scripts/sprint/fs.js#parseMiniYaml. If unavailable, return
  // null (we'll fall back to extractSchemaField + crude shape checks).
  try {
    const sprintFs = require(
      path.join(PROJECT_DIR, "scripts", "sprint", "fs.js"),
    );
    // readYamlMaybe expects a file; we have text. Walk to the underlying
    // parseMiniYaml via writeYaml's sibling — not exported. Fall back to
    // a temp-file roundtrip.
    const tmp = path.join(
      PROJECT_DIR,
      ".claude",
      "runtime",
      ".sprint-guard-tmp.yaml",
    );
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, text, "utf8");
    const parsed = sprintFs.readYamlMaybe(tmp);
    fs.unlinkSync(tmp);
    return parsed;
  } catch {
    return null;
  }
}

function validate(parsed, schema, rootSchema, pathStr, errors) {
  if (!schema) return;
  if (schema.$ref) {
    if (!schema.$ref.startsWith("#/")) {
      errors.push(`${pathStr}: external $ref not supported (${schema.$ref})`);
      return;
    }
    const target = resolveRef(rootSchema, schema.$ref);
    if (!target) {
      errors.push(`${pathStr}: cannot resolve $ref ${schema.$ref}`);
      return;
    }
    validate(parsed, target, rootSchema, pathStr, errors);
    return;
  }
  if (schema.const !== undefined && parsed !== schema.const) {
    errors.push(
      `${pathStr}: expected const=${JSON.stringify(schema.const)} got ${JSON.stringify(parsed)}`,
    );
  }
  if (schema.enum && !schema.enum.includes(parsed)) {
    errors.push(`${pathStr}: value ${JSON.stringify(parsed)} not in enum`);
  }
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const t = typeOf(parsed);
    const matched = allowed.some((a) => {
      if (a === "integer") return t === "number" && Number.isInteger(parsed);
      if (a === "number") return t === "number";
      return a === t;
    });
    if (!matched) {
      errors.push(`${pathStr}: type ${t} not in ${JSON.stringify(allowed)}`);
      return;
    }
  }
  if (typeof parsed === "string" && schema.pattern) {
    const re = new RegExp(schema.pattern);
    if (!re.test(parsed)) {
      errors.push(
        `${pathStr}: ${JSON.stringify(parsed)} fails pattern /${schema.pattern}/`,
      );
    }
  }
  if (typeOf(parsed) === "array" && schema.items) {
    for (let i = 0; i < parsed.length; i++) {
      validate(parsed[i], schema.items, rootSchema, `${pathStr}[${i}]`, errors);
    }
  }
  if (typeOf(parsed) === "object" && parsed !== null) {
    if (Array.isArray(schema.required)) {
      for (const r of schema.required) {
        if (!(r in parsed)) {
          errors.push(`${pathStr}.${r}: required property missing`);
        }
      }
    }
    if (schema.properties) {
      for (const [k, sub] of Object.entries(schema.properties)) {
        if (k in parsed) {
          validate(parsed[k], sub, rootSchema, `${pathStr}.${k}`, errors);
        }
      }
    }
  }
}

function resolveRef(schema, ref) {
  if (!ref.startsWith("#/")) return null;
  const parts = ref.slice(2).split("/");
  let node = schema;
  for (const p of parts) {
    if (node == null) return null;
    node = node[p];
  }
  return node;
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function main() {
  let event;
  try {
    event = JSON.parse(readStdinSync() || "{}");
  } catch {
    process.exit(0);
  }
  const target = extractTarget(event);
  if (!target.file_path) process.exit(0);

  const sp = loadSprintPaths();
  if (!isUnderSprintRoot(target.file_path, sp.root)) process.exit(0);

  // Protection 2: history immutability.
  if (isUnderHistory(target.file_path, sp.history)) {
    const abs = path.join(PROJECT_DIR, target.file_path);
    if (fs.existsSync(abs)) {
      emitBlock(
        `sprint history is append-only. ${target.file_path} already exists; refuse to edit. ` +
          "Sprints are archived once closed — preserve the historical record. " +
          "If you must amend, write a new addendum file alongside it (e.g. addendum-<date>.md), " +
          "or set SPRINT_GUARD=off in your environment to override.",
      );
    }
    process.exit(0);
  }

  // Protection 1: schema validity (yaml only).
  if (!target.file_path.endsWith(".yaml")) process.exit(0);
  if (target.content === null) {
    // Edit with new_string only — we don't have full content. Allow.
    process.exit(0);
  }

  const schemaId = extractSchemaField(target.content);
  if (!schemaId) {
    // Auto-inject path: if the path matches a known sprint kind, prepend
    // the schema header and let the write proceed with mutated content.
    // This collapses the 126×/day "missing schema header" block class into
    // a silent fix-forward. Source: /check:patterns 2026-05-13.
    const kind = inferSchemaKind(target.file_path);
    if (kind) {
      emitAutoInject(target.file_path, kind, target.content);
      // emitAutoInject exits the process
    }
    // Unknown path with no schema: keep prior warn-only behavior so we
    // never accidentally break a write to a sprint file we don't recognize.
    emitWarn(
      `${target.file_path}: no schema: field detected and path doesn't match any known sprint-kind rule. ` +
        "Sprint tracker yaml MUST declare its schema. Allowing (warn-only). " +
        "If this is a new sprint artifact type, add a SCHEMA_KIND_RULES entry to sprint-tracker-guard.js.",
    );
    process.exit(0);
  }

  if (!schemaId.startsWith("warpos/sprint/")) {
    // Not a sprint-managed schema. Allow.
    process.exit(0);
  }

  const schemas = loadSchemas(sp.schemas);
  if (!schemas[schemaId]) {
    emitWarn(
      `${target.file_path}: declared schema ${schemaId} not found in ${sp.schemas}/. ` +
        "Allowing (warn-only) — install may be stale; consider running paths/build.js.",
    );
    process.exit(0);
  }

  const parsed = tryYamlParse(target.content);
  if (parsed === null || typeof parsed !== "object") {
    emitWarn(
      `${target.file_path}: yaml parse failed. Allowing (warn-only). ` +
        "Sprint helpers will validate at read time.",
    );
    process.exit(0);
  }

  const errors = [];
  validate(parsed, schemas[schemaId], schemas[schemaId], "$", errors);
  if (errors.length) {
    emitBlock(
      `${target.file_path} fails ${schemaId} validation (${errors.length} error(s)):\n` +
        errors
          .slice(0, 5)
          .map((e) => "  " + e)
          .join("\n") +
        (errors.length > 5 ? `\n  ... ${errors.length - 5} more` : "") +
        `\n\nUse the corresponding scripts/sprint/* helper to write tracker files rather than ` +
        `hand-editing yaml. To override, set SPRINT_GUARD=off.`,
    );
  }
  process.exit(0);
}

main();
