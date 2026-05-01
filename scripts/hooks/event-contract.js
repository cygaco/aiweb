#!/usr/bin/env node
/**
 * event-contract.js — PostToolUse hook for Edit|Write on .ts/.tsx files.
 *
 * Pairs `addEventListener("jz:X")` ↔ `dispatchEvent(new (Custom)Event("jz:X"))`
 * across src/. Warns when an edited file contains a `jz:*` event name that
 * has only one side defined project-wide. Catches the bug class from
 * P-07-04 (retros 03/07): incomplete event renames where the dispatch
 * site was renamed but the listener wasn't (or vice versa).
 *
 * Advisory only. Never blocks. Fail-open on parse errors.
 */

const fs = require("fs");
const path = require("path");
const { PROJECT } = require("./lib/paths");

const SRC_DIR = path.join(PROJECT, "src");
const LISTEN_RE = /addEventListener\s*\(\s*["'`](jz:[a-z0-9_-]+)["'`]/gi;
const DISPATCH_RE =
  /dispatchEvent\s*\(\s*new\s+(?:Custom)?Event\s*\(\s*["'`](jz:[a-z0-9_-]+)["'`]/gi;
// Also catches dispatchEvent of a pre-built event variable's name reference
const DISPATCH_NAME_RE = /["'`](jz:[a-z0-9_-]+)["'`]/g;

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const filePath = event.tool_input?.file_path || "";
    if (!filePath || !/\.(ts|tsx|js|jsx)$/.test(filePath)) {
      process.exit(0);
    }
    if (!filePath.includes(`${path.sep}src${path.sep}`)) {
      process.exit(0);
    }

    // Scan only the edited file's diff for jz: tokens — if there are none,
    // skip the project-wide pass. This keeps the hook cheap on unrelated edits.
    const newText =
      (event.tool_input?.content || "") +
      "\n" +
      (event.tool_input?.new_string || "");
    if (!/["'`]jz:[a-z0-9_-]+["'`]/i.test(newText)) {
      process.exit(0);
    }

    // Project-wide scan. Walk src/ collecting addEventListener + dispatchEvent
    // call sites. Cap at ~600 source files; bail if larger.
    const listeners = new Map(); // name → Set(file)
    const dispatchers = new Map();
    let scanned = 0;

    function walk(dir) {
      if (scanned > 600) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name.startsWith(".")) continue;
          walk(full);
        } else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
          let body;
          try {
            body = fs.readFileSync(full, "utf8");
          } catch {
            continue;
          }
          scanned++;
          let m;
          LISTEN_RE.lastIndex = 0;
          while ((m = LISTEN_RE.exec(body)) !== null) {
            if (!listeners.has(m[1])) listeners.set(m[1], new Set());
            listeners.get(m[1]).add(full);
          }
          DISPATCH_RE.lastIndex = 0;
          while ((m = DISPATCH_RE.exec(body)) !== null) {
            if (!dispatchers.has(m[1])) dispatchers.set(m[1], new Set());
            dispatchers.get(m[1]).add(full);
          }
        }
      }
    }
    walk(SRC_DIR);

    const orphanListeners = [];
    const orphanDispatchers = [];
    for (const name of listeners.keys()) {
      if (!dispatchers.has(name)) orphanListeners.push(name);
    }
    for (const name of dispatchers.keys()) {
      if (!listeners.has(name)) orphanDispatchers.push(name);
    }

    if (orphanListeners.length === 0 && orphanDispatchers.length === 0) {
      process.exit(0);
    }

    const lines = ["event-contract: orphan jz:* event names detected"];
    if (orphanListeners.length > 0) {
      lines.push(
        `  listened but never dispatched: ${orphanListeners.join(", ")}`,
      );
    }
    if (orphanDispatchers.length > 0) {
      lines.push(
        `  dispatched but never listened: ${orphanDispatchers.join(", ")}`,
      );
    }
    lines.push("  (advisory — incomplete rename or dead code)");
    process.stderr.write(lines.join("\n") + "\n");
    process.exit(0);
  } catch {
    process.exit(0);
  }
});
