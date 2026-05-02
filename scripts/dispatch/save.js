/**
 * save.js — apply a role config change atomically across manifest.json
 * and the role's agent frontmatter files. Snapshots prior state to a backup
 * before writing.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ROLES, validateTuple } = require("./catalog");
const {
  readManifest,
  writeManifest,
  MANIFEST_PATH,
} = require("./manifest-patch");
const {
  parse: parseFm,
  serialize: serializeFm,
  setValue,
  removeKey,
} = require("./frontmatter");
const { filesForRole } = require("./role-files");
const { validateFallback, requiresFallback } = require("./required-fallback");
const { createBackup } = require("./backup");
const { fileDiff } = require("./diff");

const PROJECT_ROOT = process.cwd();

function validateInput(input) {
  if (!ROLES.includes(input.role)) return `Unknown role: ${input.role}`;
  const tupleErr = validateTuple(input.provider, input.model, input.effort);
  if (tupleErr) return tupleErr;
  const fb = validateFallback(input.provider, input.fallback);
  if (!fb.ok) return fb.reason || "Invalid fallback";
  return null;
}

function planManifestWrite(input) {
  const before = fs.readFileSync(MANIFEST_PATH, "utf8");
  const { data, indent, eol } = readManifest();
  const next = JSON.parse(JSON.stringify(data));
  next.agentProviders = next.agentProviders || {};
  next.agentProviders[input.role] = input.provider;
  let serialized = JSON.stringify(next, null, indent);
  if (eol === "\r\n") serialized = serialized.replace(/\n/g, "\r\n");
  if (!serialized.endsWith(eol)) serialized += eol;
  return { path: MANIFEST_PATH, before, after: serialized };
}

function patchFrontmatter(parsed, input) {
  let next = parsed;
  if (input.provider === "claude") {
    next = setValue(next, "model", input.model);
    if (input.effort) {
      next = setValue(next, "effort", input.effort);
      if (parsed.entries.find((e) => e.key === "provider_reasoning_effort")) {
        next = setValue(next, "provider_reasoning_effort", input.effort);
      }
    } else {
      next = removeKey(next, "effort");
    }
    next = removeKey(next, "provider");
    next = removeKey(next, "provider_model");
    next = removeKey(next, "provider_fallback");
    if (!input.effort) next = removeKey(next, "provider_reasoning_effort");
  } else {
    if (!parsed.entries.find((e) => e.key === "model")) {
      next = setValue(next, "model", "inherit");
    }
    next = setValue(next, "provider", input.provider);
    next = setValue(next, "provider_model", input.model);
    if (input.fallback) {
      next = setValue(next, "provider_fallback", input.fallback);
    } else if (!requiresFallback(input.provider)) {
      next = removeKey(next, "provider_fallback");
    }
    if (input.effort) {
      next = setValue(next, "provider_reasoning_effort", input.effort);
    } else {
      next = removeKey(next, "provider_reasoning_effort");
    }
    next = removeKey(next, "effort");
  }
  return next;
}

function planFrontmatterWrites(input) {
  const files = filesForRole(input.role);
  const writes = [];
  for (const f of files) {
    const before = fs.readFileSync(f, "utf8");
    const parsed = parseFm(before);
    if (parsed.fmLines.length === 0) continue;
    const next = patchFrontmatter(parsed, input);
    const after = serializeFm(next);
    writes.push({ path: f, before, after });
  }
  return writes;
}

function planDiffs(writes) {
  const out = [];
  for (const w of writes) {
    if (w.before === w.after) continue;
    const rel = path.relative(PROJECT_ROOT, w.path).split(path.sep).join("/");
    out.push(fileDiff(rel, w.before, w.after));
  }
  return out;
}

function previewSave(input) {
  const err = validateInput(input);
  if (err) return { ok: false, error: err, diffs: [], changedFiles: [] };
  const writes = [planManifestWrite(input), ...planFrontmatterWrites(input)];
  const diffs = planDiffs(writes);
  return { ok: true, diffs, changedFiles: diffs.map((d) => d.path), writes };
}

function applySave(input) {
  const err = validateInput(input);
  if (err) return { ok: false, error: err, changedFiles: [], diffs: [] };
  const writes = [planManifestWrite(input), ...planFrontmatterWrites(input)];
  const changedWrites = writes.filter((w) => w.before !== w.after);
  if (changedWrites.length === 0) {
    return { ok: true, changedFiles: [], diffs: [] };
  }
  const diffs = planDiffs(writes);
  const changedFiles = changedWrites.map((w) => w.path);

  const backup = createBackup(changedFiles, {
    summary: `${input.role} → ${input.provider}/${input.model}/${input.effort || "—"}`,
    diffSummary: diffs
      .map((d) => `${d.path}: +${d.added} -${d.removed}`)
      .join("; "),
  });

  // Manifest first
  const manifestWrite = changedWrites.find((w) => w.path === MANIFEST_PATH);
  if (manifestWrite) {
    const { indent, eol } = readManifest();
    const nextData = JSON.parse(manifestWrite.after.trim());
    writeManifest(nextData, indent, eol);
  }
  // Then frontmatter files
  for (const w of changedWrites) {
    if (w.path === MANIFEST_PATH) continue;
    fs.writeFileSync(w.path, w.after, "utf8");
  }

  return {
    ok: true,
    backup,
    changedFiles: changedFiles.map((p) =>
      path.relative(PROJECT_ROOT, p).split(path.sep).join("/"),
    ),
    diffs,
  };
}

module.exports = { previewSave, applySave };
