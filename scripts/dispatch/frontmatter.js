/**
 * frontmatter.js — minimal hand-rolled YAML frontmatter parser/patcher.
 *
 * Why not gray-matter? gray-matter reserializes YAML, which loses comments,
 * quoting style, and key order — all of which we want to preserve when the
 * CLI patches one or two keys in a 30-line frontmatter block.
 *
 * Files round-trip byte-identical when no panel-managed keys change.
 */

"use strict";

const fs = require("node:fs");

const FENCE = "---";
const KEY_LINE_RE = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/;

function readFile(p) {
  return parse(fs.readFileSync(p, "utf8"));
}

function parse(raw) {
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.split(/\r?\n/);
  if (lines[0] !== FENCE) {
    return { fmLines: [], bodyLines: lines, eol, entries: [] };
  }
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === FENCE) {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) {
    return { fmLines: [], bodyLines: lines, eol, entries: [] };
  }
  const fmLines = lines.slice(0, closeIdx + 1);
  const bodyLines = lines.slice(closeIdx + 1);
  const entries = [];
  for (let i = 1; i < closeIdx; i++) {
    const m = lines[i].match(KEY_LINE_RE);
    if (m) entries.push({ key: m[1], rawValue: m[2], lineIndex: i });
  }
  return { fmLines, bodyLines, eol, entries };
}

function getValue(parsed, key) {
  const e = parsed.entries.find((x) => x.key === key);
  if (!e) return null;
  return unquote(e.rawValue);
}

function unquote(raw) {
  const t = raw.trim();
  if (t.length >= 2) {
    const q = t[0];
    if ((q === '"' || q === "'") && t[t.length - 1] === q) {
      return t.slice(1, -1);
    }
  }
  return t;
}

function reformat(rawOriginal, newValue) {
  const t = rawOriginal.trim();
  if (t.length >= 2) {
    const q = t[0];
    if ((q === '"' || q === "'") && t[t.length - 1] === q) {
      return `${q}${escapeQuoted(newValue, q)}${q}`;
    }
  }
  if (/[:#]/.test(newValue) || /^\s|\s$/.test(newValue)) {
    return `"${escapeQuoted(newValue, '"')}"`;
  }
  return newValue;
}

function escapeQuoted(s, q) {
  if (q === '"') return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return s.replace(/'/g, "''");
}

function setValue(parsed, key, value) {
  const fmLines = [...parsed.fmLines];
  const existing = parsed.entries.find((e) => e.key === key);
  if (existing) {
    const original = fmLines[existing.lineIndex];
    const idxAfterKey = original.indexOf(":");
    const before = original.slice(0, idxAfterKey + 1);
    const space = original[idxAfterKey + 1] === " " ? " " : "";
    fmLines[existing.lineIndex] =
      `${before}${space}${reformat(existing.rawValue, value)}`;
  } else {
    const insertAt = fmLines.length - 1;
    fmLines.splice(insertAt, 0, `${key}: ${reformat("", value)}`);
  }
  return reparse(fmLines, parsed.bodyLines, parsed.eol);
}

function removeKey(parsed, key) {
  const existing = parsed.entries.find((e) => e.key === key);
  if (!existing) return parsed;
  const fmLines = [...parsed.fmLines];
  fmLines.splice(existing.lineIndex, 1);
  return reparse(fmLines, parsed.bodyLines, parsed.eol);
}

function reparse(fmLines, bodyLines, eol) {
  return parse([...fmLines, ...bodyLines].join(eol));
}

function serialize(parsed) {
  if (parsed.fmLines.length === 0) {
    return parsed.bodyLines.join(parsed.eol);
  }
  return [...parsed.fmLines, ...parsed.bodyLines].join(parsed.eol);
}

function writeFile(p, parsed) {
  fs.writeFileSync(p, serialize(parsed), "utf8");
}

module.exports = {
  parse,
  readFile,
  writeFile,
  getValue,
  setValue,
  removeKey,
  serialize,
};
