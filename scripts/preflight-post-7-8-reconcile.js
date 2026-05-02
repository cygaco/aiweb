#!/usr/bin/env node
/**
 * preflight-post-7-8-reconcile.js
 *
 * After 7.8 sync writes the new store, reconcile the filesystem:
 *  1. Delete files that the new store no longer references (orphan stubs from
 *     gut). Compute via prev-run-backup ∖ current.
 *  2. Generate minimal skeleton stubs for files that the new store DOES
 *     reference but that don't exist on disk yet.
 *  3. Update store.knownStubs to reflect the new union.
 *  4. Print summary.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STORE = path.join(ROOT, ".claude/agents/02-oneshot/.system/store.json");
const BACKUP = STORE + ".prev-run-backup.json";

const cur = JSON.parse(fs.readFileSync(STORE, "utf8"));
const prev = JSON.parse(fs.readFileSync(BACKUP, "utf8"));

function fileSetFromStore(s) {
  const out = new Set();
  for (const [name, f] of Object.entries(s.features)) {
    if (name.startsWith("foundation-")) continue;
    for (const file of f.files || []) out.add(file);
  }
  return out;
}

const prevFiles = fileSetFromStore(prev);
const curFiles = fileSetFromStore(cur);

const orphanedFromStore = [...prevFiles].filter((f) => !curFiles.has(f));
const newlyInStore = [...curFiles].filter((f) => !prevFiles.has(f));

// 1. Delete orphaned files (only if they exist as files, not directories).
const deleted = [];
const deleteFailed = [];
for (const rel of orphanedFromStore) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) continue;
  try {
    fs.unlinkSync(abs);
    deleted.push(rel);
  } catch (e) {
    deleteFailed.push({ rel, err: String(e.message || e) });
  }
}

// 2. Generate stubs for newly-added store entries.
function isComponent(rel) {
  return rel.endsWith(".tsx");
}
function isRoute(rel) {
  return /route\.ts$/.test(rel) && rel.includes("/app/");
}
function isExt(rel) {
  return rel.startsWith("extension/");
}
function stubComponent(rel) {
  const base = path.basename(rel, ".tsx");
  return [
    '"use client";',
    `// SKELETON: not implemented — ${base}`,
    'import React from "react";',
    "",
    `export function ${base}(_props: any = {}) {`,
    `  return <div data-skeleton="${base}">SKELETON: ${base}</div>;`,
    "}",
    `export default ${base};`,
    "",
  ].join("\n");
}
function stubRoute(rel) {
  return [
    "// SKELETON: route not implemented",
    'import { NextResponse } from "next/server";',
    "",
    "export async function GET() {",
    '  return NextResponse.json({ error: "SKELETON" }, { status: 501 });',
    "}",
    "",
  ].join("\n");
}
function stubGenericTs(rel) {
  const base = path.basename(rel, path.extname(rel));
  return [`// SKELETON: ${base} not implemented`, "export {};", ""].join("\n");
}
function stubExtensionFile(rel) {
  if (rel.endsWith(".html"))
    return `<!-- SKELETON: not implemented -->\n<!DOCTYPE html><html><head><title>SKELETON</title></head><body><p>SKELETON</p></body></html>\n`;
  if (rel.endsWith(".css")) return `/* SKELETON: not implemented */\n`;
  if (rel.endsWith(".json"))
    return (
      JSON.stringify(
        {
          manifest_version: 3,
          name: "SKELETON",
          version: "0.0.0",
          _comment: "SKELETON",
        },
        null,
        2,
      ) + "\n"
    );
  return `// SKELETON: not implemented\n`;
}
function stubMd(rel) {
  const base = path.basename(rel);
  return `# SKELETON: ${base}\n\nNot implemented yet.\n`;
}
function stubYaml(rel) {
  return `# SKELETON: not implemented\n`;
}
function stubSql(rel) {
  return `-- SKELETON: not implemented\n`;
}
function stubEnv(rel) {
  return `# SKELETON: .env.example not implemented\n`;
}
function stubDockerfile(rel) {
  return `# SKELETON: not implemented\nFROM scratch\n`;
}

const created = [];
const skipped = [];
for (const rel of newlyInStore) {
  const abs = path.join(ROOT, rel);
  if (fs.existsSync(abs)) {
    skipped.push({ rel, reason: "exists" });
    continue;
  }
  // Skip glob/dir-shaped entries (defensive — sync should have filtered).
  if (rel.endsWith("/") || /[*?]/.test(rel)) {
    skipped.push({ rel, reason: "glob-shaped" });
    continue;
  }
  let content = null;
  if (isExt(rel)) content = stubExtensionFile(rel);
  else if (isComponent(rel)) content = stubComponent(rel);
  else if (isRoute(rel)) content = stubRoute(rel);
  else if (rel.endsWith(".ts")) content = stubGenericTs(rel);
  else if (rel.endsWith(".js")) content = `// SKELETON: not implemented\n`;
  else if (rel.endsWith(".md")) content = stubMd(rel);
  else if (rel.endsWith(".yml") || rel.endsWith(".yaml"))
    content = stubYaml(rel);
  else if (rel.endsWith(".sql")) content = stubSql(rel);
  else if (rel.endsWith(".toml")) content = `# SKELETON: not implemented\n`;
  else if (rel.endsWith(".conf")) content = `# SKELETON: not implemented\n`;
  else if (rel.endsWith(".html")) content = stubExtensionFile(rel);
  else if (path.basename(rel) === "Dockerfile") content = stubDockerfile(rel);
  else if (path.basename(rel) === ".env.example") content = stubEnv(rel);
  else {
    skipped.push({ rel, reason: "unknown-type" });
    continue;
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  created.push(rel);
}

// 3. Update knownStubs in store.
const knownStubs = new Set(cur.knownStubs || []);
for (const f of orphanedFromStore) knownStubs.delete(f);
for (const f of created) knownStubs.add(f);
cur.knownStubs = [...knownStubs].sort();
fs.writeFileSync(STORE, JSON.stringify(cur, null, 2));

console.log(
  JSON.stringify(
    {
      orphanedFromStoreCount: orphanedFromStore.length,
      deletedCount: deleted.length,
      deleteFailedCount: deleteFailed.length,
      newlyInStoreCount: newlyInStore.length,
      createdCount: created.length,
      skippedCount: skipped.length,
      knownStubsCount: cur.knownStubs.length,
      orphanedFromStore,
      deleted,
      deleteFailed,
      newlyInStore,
      created,
      skipped,
    },
    null,
    2,
  ),
);
