#!/usr/bin/env node
// Add a new sprint to active-sprints.yaml and set it as primary.
// Usage: node scripts/sprint/add-sprint.js --id <id> --title <title>
const fs = require("fs");
const path = require("path");
const { readYamlMaybe, writeYaml } = require("./fs");

function get(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
}

const id = get("--id");
const title = get("--title");
if (!id || !title) {
  process.stderr.write("Usage: --id <id> --title <title>\n");
  process.exit(2);
}

const repo = path.resolve(__dirname, "..", "..");
const regPath = path.join(
  repo,
  ".claude",
  "project",
  "sprint",
  "active-sprints.yaml",
);
const reg = readYamlMaybe(regPath);
const now = new Date().toISOString();
const pointer = `.claude/project/sprint/sprints/${id}`;

if (reg.sprints.some((s) => s.id === id)) {
  process.stderr.write(`sprint ${id} already exists\n`);
  process.exit(1);
}

reg.sprints.push({
  id,
  title,
  status: "planning",
  lane: { type: "default", value: null, isolation_notes: "" },
  layout: "per_sprint_subdir",
  pointer,
  created_at: now,
  updated_at: now,
});
reg.primary = id;
reg.updated_at = now;

writeYaml(regPath, reg);
fs.mkdirSync(path.join(repo, pointer), { recursive: true });
process.stdout.write(`added ${id} as primary\n`);
