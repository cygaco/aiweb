/**
 * role-files.js — auto-derive ROLE_FILES by walking .claude/agents/ and
 * parsing each frontmatter `name:` field.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parse: parseFm, getValue } = require("./frontmatter");

const PROJECT_ROOT = process.cwd();
const AGENTS_ROOT = path.join(PROJECT_ROOT, ".claude", "agents");

function walk(dir, out) {
  out = out || [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".system")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && e.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function buildRoleFileMap() {
  const files = walk(AGENTS_ROOT);
  const map = {};
  for (const f of files) {
    let raw;
    try {
      raw = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    const parsed = parseFm(raw);
    if (parsed.fmLines.length === 0) continue;
    const name = getValue(parsed, "name");
    if (!name) continue;
    if (!map[name]) map[name] = [];
    map[name].push(f);
  }
  return map;
}

function filesForRole(role) {
  return buildRoleFileMap()[role] || [];
}

module.exports = { buildRoleFileMap, filesForRole, AGENTS_ROOT };
