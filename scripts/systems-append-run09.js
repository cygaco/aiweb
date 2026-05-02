#!/usr/bin/env node
/**
 * systems-append-run09.js
 * Appends 5 emergent-system entries to .claude/project/memory/systems.jsonl.
 * Declared as part of post-run-09 cleanup (batch H).
 */
const fs = require("fs");
const path = require("path");

const target = path.join(
  __dirname,
  "..",
  ".claude",
  "project",
  "memory",
  "systems.jsonl",
);

const entries = [
  {
    id: "oneshot-lifecycle",
    category: "orchestration",
    files: [
      "scripts/oneshot-store-reset.js",
      "scripts/oneshot-heartbeat.js",
      "scripts/oneshot-phase-complete.js",
      "scripts/oneshot-halt.js",
      "scripts/oneshot-store-file-sync.js",
    ],
    notes: "Delta phase-transition + store sync scripts (run-09)",
    added: "2026-04-22",
  },
  {
    id: "agent-stub-scaffold",
    category: "agents",
    files: [".claude/agents/02-oneshot/stub-scaffold/stub-scaffold.md"],
    notes:
      "Sub-agent dispatched by /preflight:run --gut Pass 7.9 to regenerate stubs from current spec when drift detected",
    added: "2026-04-22",
  },
  {
    id: "runtime-notes",
    category: "memory",
    path: ".claude/runtime/notes/",
    writer: "/session:takenotes",
    notes: "Per-topic markdown notes; replaces legacy .claude/runtime/notes.md",
    added: "2026-04-22",
  },
  {
    id: "mode-config-system",
    category: "orchestration",
    files: [
      ".claude/commands/mode/oneshot.md",
      ".claude/commands/mode/adhoc.md",
      ".claude/commands/mode/solo.md",
      "scripts/hooks/smart-context.js",
    ],
    state_file: ".claude/runtime/mode.json",
    notes:
      "Mode marker SSoT; smart-context emits ONESHOT/TEAM MODE/no-directive based on heartbeat + mode.json",
    added: "2026-04-22",
  },
  {
    id: "preflight-workflow",
    category: "orchestration",
    files: [
      ".claude/commands/preflight/run.md",
      ".claude/commands/preflight/setup.md",
      "scripts/oneshot-store-reset.js",
    ],
    notes:
      "7-pass verification + branch creation + skeleton gut; --gut mode strips feature code to stubs",
    added: "2026-04-22",
  },
];

let appended = 0;
for (const e of entries) {
  fs.appendFileSync(target, JSON.stringify(e) + "\n", "utf8");
  appended++;
  console.log(`[ok] appended id=${e.id}`);
}
console.log(`\nAPPENDED ${appended} entries to ${target}`);
