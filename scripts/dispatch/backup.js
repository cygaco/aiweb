/**
 * backup.js — directory-based backup ring.
 *
 * Each backup is a directory under .claude/agents/.system/dispatch-backups/<ISO-ts>/
 * with the original relative paths preserved. index.jsonl records the change
 * summary. Ring keeps the most recent N (default 50).
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = process.cwd();
const BACKUP_DIR = path.join(
  PROJECT_ROOT,
  ".claude",
  "agents",
  ".system",
  "dispatch-backups",
);
const INDEX_FILE = path.join(BACKUP_DIR, "index.jsonl");
const RING_SIZE = 50;

function tsId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dst) {
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
}

function relPosix(absPath) {
  return path.relative(PROJECT_ROOT, absPath).split(path.sep).join("/");
}

function createBackup(files, meta) {
  ensureDir(BACKUP_DIR);
  const id = tsId();
  const ts = new Date().toISOString();
  const dest = path.join(BACKUP_DIR, id);
  ensureDir(dest);
  for (const f of files) {
    const rel = relPosix(f);
    const dst = path.join(dest, rel);
    try {
      copyFile(f, dst);
    } catch {
      /* file missing — skip */
    }
  }
  const entry = {
    id,
    ts,
    summary: meta.summary,
    changedFiles: files.map(relPosix),
    diffSummary: meta.diffSummary || null,
  };
  fs.appendFileSync(INDEX_FILE, JSON.stringify(entry) + "\n", "utf8");
  pruneRing();
  return entry;
}

function listBackups() {
  let raw;
  try {
    raw = fs.readFileSync(INDEX_FILE, "utf8");
  } catch {
    return [];
  }
  return raw
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .reverse(); // newest first
}

function restoreBackup(id) {
  const entry = listBackups().find((b) => b.id === id);
  if (!entry) throw new Error(`Backup not found: ${id}`);
  const src = path.join(BACKUP_DIR, id);
  const restored = [];
  for (const rel of entry.changedFiles) {
    const srcFile = path.join(src, rel);
    const dstFile = path.join(PROJECT_ROOT, rel);
    try {
      copyFile(srcFile, dstFile);
      restored.push(rel);
    } catch {
      /* missing — skip */
    }
  }
  return { restored };
}

function pruneRing() {
  const all = listBackups();
  if (all.length <= RING_SIZE) return;
  const toPrune = all.slice(RING_SIZE);
  for (const e of toPrune) {
    const dir = path.join(BACKUP_DIR, e.id);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  const kept = all.slice(0, RING_SIZE);
  const reversed = [...kept].reverse();
  const body = reversed.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.writeFileSync(INDEX_FILE, body, "utf8");
}

module.exports = { createBackup, listBackups, restoreBackup, BACKUP_DIR };
