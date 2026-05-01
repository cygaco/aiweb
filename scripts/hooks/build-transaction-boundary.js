#!/usr/bin/env node
/**
 * Agent hook that writes a per-build transaction boundary for builder/fixer
 * dispatches. PreToolUse starts the transaction; PostToolUse completes it.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PROJECT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");

function roleOf(event) {
  const explicit = event.tool_input?.subagent_type || "";
  if (explicit) return String(explicit).toLowerCase();
  const prompt = event.tool_input?.prompt || "";
  if (/^feature:\s*\S+/im.test(prompt.slice(0, 500))) return "builder";
  if (/\bfix(er| agent)\b/i.test(prompt.slice(0, 500))) return "fixer";
  return "unknown";
}

function featureOf(prompt) {
  const m = String(prompt || "").match(/^feature:\s*(\S+)/im);
  return m ? m[1] : "unknown";
}

function scopeFromPrompt(prompt) {
  const files = [];
  const re = /^\s*-\s+([A-Za-z0-9_.\/\\-]+\.(?:ts|tsx|js|jsx|json|md|css|html|ps1))\s*$/gm;
  let m;
  while ((m = re.exec(prompt)) !== null) files.push(m[1].replace(/\\/g, "/"));
  return [...new Set(files)].slice(0, 200);
}

function txId(role, feature, prompt) {
  const hash = crypto.createHash("sha256").update(`${role}:${feature}:${prompt}`).digest("hex").slice(0, 10);
  return `${role}-${feature}-${hash}`;
}

function txPath(id) {
  return path.join(PROJECT, ".claude", "project", "builds", id, "transaction.json");
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function start(event) {
  const prompt = event.tool_input?.prompt || "";
  const role = roleOf(event);
  if (!["builder", "fixer"].includes(role)) return null;
  const feature = featureOf(prompt);
  const id = txId(role, feature, prompt);
  const allowedFiles = scopeFromPrompt(prompt);
  const tx = {
    $schema: "warpos/build-transaction/v1",
    buildId: id,
    role,
    feature,
    startedAt: new Date().toISOString(),
    cwd: event.cwd || PROJECT,
    allowedFiles,
    forbiddenFiles: ["package.json", "package-lock.json", ".env", ".claude/project/events/"],
    expectedOutputs: ["json-envelope", "typecheck-clean", "commit-sha"],
    validationGates: [
      "node scripts/agents/output-validator.js",
      "node scripts/deps/admission.js",
      "node scripts/requirements/gate.js",
    ],
    rollbackPlan: "Revert the agent branch or discard the worktree; main worktree is not modified by build-chain agents.",
    status: "started",
  };
  writeJson(txPath(id), tx);
  return tx;
}

function finish(event) {
  const prompt = event.tool_input?.prompt || "";
  const role = roleOf(event);
  if (!["builder", "fixer"].includes(role)) return null;
  const id = txId(role, featureOf(prompt), prompt);
  const file = txPath(id);
  if (!fs.existsSync(file)) return null;
  const tx = JSON.parse(fs.readFileSync(file, "utf8"));
  tx.finishedAt = new Date().toISOString();
  tx.status = event.tool_response?.error ? "failed" : "completed";
  tx.gateResults = [];
  tx.finalReport = {
    responseBytes: Buffer.byteLength(
      typeof event.tool_response === "string" ? event.tool_response : JSON.stringify(event.tool_response || {}),
      "utf8",
    ),
  };
  writeJson(file, tx);
  return tx;
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    if (event.tool_name !== "Agent") process.exit(0);
    if (event.tool_response === undefined) start(event);
    else finish(event);
  } catch {
    // Never block dispatch for transaction logging.
  }
  process.exit(0);
});

module.exports = { start, finish, scopeFromPrompt, txId };
