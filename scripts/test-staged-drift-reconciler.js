#!/usr/bin/env node
// Unit test for the staged-drift reconciler.

const path = require("path");
const fs = require("fs");
const { reconcile } = require("./lib/staged-drift-reconciler");

let pass = 0;
let fail = 0;

function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// Test 1: real production file — confirms existing 1-pending finding survives
{
  const file = path.resolve(
    __dirname,
    "..",
    ".claude/project/events/requirements-staged.jsonl",
  );
  const r = reconcile(file);
  check(
    "production file: at least 200 envelopes",
    r.all.length >= 200,
    `got ${r.all.length}`,
  );
  check(
    "production file: pending count <= 5",
    r.pending.length <= 5,
    `got ${r.pending.length}`,
  );
  check(
    "production file: byStatus has rejected + deferred",
    r.byStatus.rejected > 0 && r.byStatus.deferred > 0,
    JSON.stringify(r.byStatus),
  );
}

// Test 2: synthetic file — envelope + status_update join
{
  const tmpFile = path.resolve(__dirname, "..", "runtime", "test-tmp.jsonl");
  fs.mkdirSync(path.dirname(tmpFile), { recursive: true });
  const envelope = {
    id: "DRIFT-test-1",
    ts: "2026-04-29T10:00:00.000Z",
    cat: "requirement_staged",
    actor: "system",
    data: {
      file: "src/foo.ts",
      feature: "feature-x",
      drift_type: "extension",
      confidence: "high",
      status: "pending",
      group: "G1",
      spec_file: "requirements/05-features/feature-x/PRD.md",
      suggested_update: "add a story",
    },
  };
  const update = {
    id: "DRIFT-test-1",
    ts: "2026-04-29T10:05:00.000Z",
    type: "status_update",
    status: "approved",
    reviewed_at: "2026-04-29T10:05:00.000Z",
    reviewed_by: "alex",
  };
  fs.writeFileSync(
    tmpFile,
    JSON.stringify(envelope) + "\n" + JSON.stringify(update) + "\n",
  );
  const r = reconcile(tmpFile);
  check(
    "synthetic: 1 envelope detected",
    r.all.length === 1,
    `got ${r.all.length}`,
  );
  check(
    "synthetic: status resolved to approved",
    r.all[0].status === "approved",
    `got ${r.all[0].status}`,
  );
  check("synthetic: no pending", r.pending.length === 0);
  fs.unlinkSync(tmpFile);
}

// Test 3: synthetic file — envelope without status_update stays pending
{
  const tmpFile = path.resolve(__dirname, "..", "runtime", "test-tmp.jsonl");
  fs.mkdirSync(path.dirname(tmpFile), { recursive: true });
  const envelope = {
    id: "DRIFT-test-2",
    ts: "2026-04-29T10:00:00.000Z",
    cat: "requirement_staged",
    data: {
      file: "src/bar.ts",
      feature: "feature-y",
      drift_type: "matching",
      confidence: "high",
      status: "pending",
    },
  };
  fs.writeFileSync(tmpFile, JSON.stringify(envelope) + "\n");
  const r = reconcile(tmpFile);
  check("synthetic-2: 1 pending", r.pending.length === 1);
  check(
    "synthetic-2: feature counted",
    r.byFeature["feature-y"] === 1,
    JSON.stringify(r.byFeature),
  );
  fs.unlinkSync(tmpFile);
}

// Test 4: missing file returns empty result, not throw
{
  const r = reconcile("/nonexistent/file.jsonl");
  check(
    "missing file: empty result",
    r.all.length === 0 && r.pending.length === 0,
  );
}

// Test 5: envelope-form status_update (cat=requirement_staged, data.type=status_update)
{
  const tmpFile = path.resolve(__dirname, "..", "runtime", "test-tmp.jsonl");
  const envelope = {
    id: "DRIFT-test-3",
    ts: "2026-04-29T10:00:00.000Z",
    cat: "requirement_staged",
    data: {
      file: "src/baz.ts",
      drift_type: "removal",
      confidence: "low",
      status: "pending",
    },
  };
  const updateEnvelope = {
    id: "EVT-wrapper-1",
    ts: "2026-04-29T10:10:00.000Z",
    cat: "requirement_staged",
    actor: "system",
    data: {
      id: "DRIFT-test-3",
      type: "status_update",
      status: "deferred",
      reviewed_at: "2026-04-29T10:10:00.000Z",
      reviewed_by: "alex-batch",
    },
  };
  fs.writeFileSync(
    tmpFile,
    JSON.stringify(envelope) + "\n" + JSON.stringify(updateEnvelope) + "\n",
  );
  const r = reconcile(tmpFile);
  check(
    "synthetic-3: envelope-form status_update resolves",
    r.all[0]?.status === "deferred",
    `got ${r.all[0]?.status}`,
  );
  fs.unlinkSync(tmpFile);
}

console.log(`\n${pass}/${pass + fail} pass${fail ? ` (${fail} fail)` : ""}`);
process.exit(fail ? 1 : 0);
