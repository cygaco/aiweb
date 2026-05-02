/**
 * manifest-patch.js — JSON patch for .claude/manifest.json that preserves
 * indentation and trailing newline.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = process.cwd();
const MANIFEST_PATH = path.join(PROJECT_ROOT, ".claude", "manifest.json");

function detectIndent(raw) {
  const m = raw.match(/^(\s+)"/m);
  return m ? m[1] : "  ";
}

function detectEol(raw) {
  return raw.includes("\r\n") ? "\r\n" : "\n";
}

function readManifest() {
  const raw = fs.readFileSync(MANIFEST_PATH, "utf8");
  return {
    data: JSON.parse(raw),
    raw,
    indent: detectIndent(raw),
    eol: detectEol(raw),
  };
}

function writeManifest(data, indent, eol) {
  let serialized = JSON.stringify(data, null, indent);
  if (eol === "\r\n") serialized = serialized.replace(/\n/g, "\r\n");
  if (!serialized.endsWith(eol)) serialized += eol;
  fs.writeFileSync(MANIFEST_PATH, serialized, "utf8");
}

function setRoleProvider(role, provider) {
  const { data, indent, eol } = readManifest();
  data.agentProviders = data.agentProviders || {};
  data.agentProviders[role] = provider;
  writeManifest(data, indent, eol);
}

module.exports = {
  MANIFEST_PATH,
  readManifest,
  writeManifest,
  setRoleProvider,
};
