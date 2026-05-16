#!/usr/bin/env node

/**
 * scripts/sprint/validate.js — Sprint Workflow v0.1 schema validator.
 *
 * Loads every schemas/sprint/*.schema.json, verifies it parses as JSON,
 * and (optionally) validates a tracker file against its declared schema.
 *
 * Usage:
 *   node scripts/sprint/validate.js                 (load + parse-check all schemas)
 *   node scripts/sprint/validate.js <file.yaml>     (validate file against schema)
 *
 * No new dependencies. The validator is a minimal subset:
 *   - required (recursive)
 *   - type (object, array, string, integer, boolean, number, null)
 *   - enum
 *   - const
 *   - pattern
 *   - additionalProperties: false (warn-only — we accept extras)
 *   - $ref to #/definitions/<name>
 *
 * Full JSON-Schema features (allOf/oneOf/dependentRequired/format) are
 * out of scope for v0.1. The tracker files we write are simple enough
 * that this subset catches real bugs.
 *
 * Exit codes:
 *   0  pass
 *   1  schema parse error or validation failure
 *   2  bad usage
 */

"use strict";

const fs = require("fs");
const path = require("path");
const SPRINT = require("./paths");
const { readYamlMaybe } = require("./fs");

function loadSchemas() {
  const dir = SPRINT.schemas;
  if (!fs.existsSync(dir)) {
    return { schemas: {}, errors: [`schemas dir missing: ${dir}`] };
  }
  const schemas = {};
  const errors = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".schema.json")) continue;
    const full = path.join(dir, f);
    try {
      const text = fs.readFileSync(full, "utf8");
      const parsed = JSON.parse(text);
      if (!parsed.$id) {
        errors.push(`${f}: missing $id`);
        continue;
      }
      schemas[parsed.$id] = parsed;
    } catch (err) {
      errors.push(`${f}: ${err.message}`);
    }
  }
  return { schemas, errors };
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

function validate(value, schema, rootSchema, pathStr, errors) {
  if (!schema) return;
  if (schema.$ref) {
    const target = resolveRef(rootSchema, schema.$ref);
    if (!target) {
      errors.push(`${pathStr}: cannot resolve $ref ${schema.$ref}`);
      return;
    }
    validate(value, target, rootSchema, pathStr, errors);
    return;
  }
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(
      `${pathStr}: expected const=${JSON.stringify(schema.const)} got ${JSON.stringify(value)}`,
    );
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(
      `${pathStr}: value ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`,
    );
  }
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const t = typeOf(value);
    const matched = allowed.some((a) => {
      if (a === "integer") return t === "number" && Number.isInteger(value);
      if (a === "number") return t === "number";
      return a === t;
    });
    if (!matched) {
      errors.push(`${pathStr}: type ${t} not in ${JSON.stringify(allowed)}`);
      return;
    }
  }
  if (typeof value === "string" && schema.pattern) {
    const re = new RegExp(schema.pattern);
    if (!re.test(value)) {
      errors.push(
        `${pathStr}: string ${JSON.stringify(value)} does not match pattern /${schema.pattern}/`,
      );
    }
  }
  if (typeOf(value) === "array" && schema.items) {
    for (let i = 0; i < value.length; i++) {
      validate(value[i], schema.items, rootSchema, `${pathStr}[${i}]`, errors);
    }
  }
  if (typeOf(value) === "object") {
    if (Array.isArray(schema.required)) {
      for (const r of schema.required) {
        if (!(r in value)) {
          errors.push(`${pathStr}.${r}: required property missing`);
        }
      }
    }
    if (schema.properties) {
      for (const [k, sub] of Object.entries(schema.properties)) {
        if (k in value) {
          validate(value[k], sub, rootSchema, `${pathStr}.${k}`, errors);
        }
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const k of Object.keys(value)) {
        if (!(k in schema.properties)) {
          // warn-only: do not push to errors. Print to stderr for visibility.
          process.stderr.write(
            `warn: ${pathStr}.${k} not declared in schema\n`,
          );
        }
      }
    }
  }
}

function validateFile(file) {
  const { schemas, errors: schemaErrors } = loadSchemas();
  if (schemaErrors.length) {
    for (const e of schemaErrors) process.stderr.write(`schema-error: ${e}\n`);
    return 1;
  }
  const parsed = readYamlMaybe(file);
  if (!parsed || typeof parsed !== "object") {
    process.stderr.write(`cannot parse: ${file}\n`);
    return 1;
  }
  if (!parsed.schema || !schemas[parsed.schema]) {
    process.stderr.write(
      `unknown schema id: ${parsed.schema} (file: ${file})\n`,
    );
    return 1;
  }
  const errs = [];
  validate(parsed, schemas[parsed.schema], schemas[parsed.schema], "$", errs);
  if (errs.length) {
    process.stderr.write(`${file}: ${errs.length} validation error(s)\n`);
    for (const e of errs) process.stderr.write(`  ${e}\n`);
    return 1;
  }
  process.stdout.write(`${file}: valid against ${parsed.schema}\n`);
  return 0;
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    const { schemas, errors } = loadSchemas();
    if (errors.length) {
      for (const e of errors) process.stderr.write(`schema-error: ${e}\n`);
      return 1;
    }
    process.stdout.write(
      `scripts/sprint/validate.js — ${Object.keys(schemas).length} schema(s) loaded\n`,
    );
    for (const id of Object.keys(schemas)) process.stdout.write(`  ${id}\n`);
    return 0;
  }
  return validateFile(path.resolve(arg));
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { loadSchemas, validate, validateFile };
