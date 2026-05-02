#!/usr/bin/env node
/**
 * fix-deep-trace-run09-cleanup.js — Phase 5.0 trace + 5.1 learning for the
 * /fix:deep run that closed 11 critical+high findings from /check:all triage
 * (run-09 cleanup batch).
 *
 * One-off — do not re-run.
 */
const fs = require("fs");
const path = require("path");
const { PATHS } = require(path.join(__dirname, "hooks", "lib", "paths"));

const ts = new Date().toISOString();

function nextRtId() {
  if (!fs.existsSync(PATHS.tracesFile)) return "RT-001";
  const lines = fs
    .readFileSync(PATHS.tracesFile, "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
  let max = 0;
  for (const ln of lines) {
    try {
      const m = (JSON.parse(ln).id || "").match(/^RT-(\d+)$/);
      if (m) max = Math.max(max, Number(m[1]));
    } catch {}
  }
  return `RT-${String(max + 1).padStart(3, "0")}`;
}

const rtId = nextRtId();
const learningId = `L-${ts.slice(0, 10)}-fix-deep-run09-cleanup`;

const trace = {
  id: rtId,
  ts,
  problem_type: "spec_logic",
  mode: "deep",
  framework_selected: "Direct Investigation",
  framework_rationale:
    "Inputs already specified exact files + line numbers; no detective work needed. The 11 findings were a single class (post-deletion dangling refs) batchable in 8 same-shape edits.",
  history_match: null,
  problem:
    "/check:all returned 9 critical + 28 high findings; ~15 were concrete run-09-cleanup leftovers (dangling refs to deleted task-manifest.md / file-ownership.md, missing systems.jsonl entries for emergent systems, 2 architecture quick fixes).",
  root_cause:
    "Run-09 deletions of two WarpOS template files left dangling references in 11 dependent docs + SPEC_GRAPH edges + systems.jsonl. The run-09 commit updated the obvious agent .md files but missed canonical docs (PRDs, GLOSSARY, FLOW_SPEC, etc.), audit maps, and the manifest. A reference-checking pre-commit hook would have caught this at deletion time.",
  fix: "8-batch /fix:deep: A=SPEC_GRAPH 3 edges, B=LAUNCH-CHECKLIST 4 refs, C=2 PRDs, D=5 architecture/canonical docs, E=evolution.md + .system.md hub, F=learn-events-write.js obsolete entry, G=alpha.md repointed + framework-manifest-guard registered, H=systems.jsonl (store path corrected, installer annotated, 5 emergent systems declared).",
  files_touched: 17,
  commit_sha: "6e1211c",
  quality_score: 3,
  source: "fix:deep",
  learning_id: learningId,
  outcome:
    "all batches green; verified by grep on each touched file (zero matches for deleted-file refs)",
};

fs.mkdirSync(path.dirname(PATHS.tracesFile), { recursive: true });
fs.appendFileSync(PATHS.tracesFile, JSON.stringify(trace) + "\n");
console.log(`[trace] appended ${rtId} to ${PATHS.tracesFile}`);

const learning = {
  id: learningId,
  ts,
  intent: "process",
  tip: "When deleting a file referenced across the project (e.g. WarpOS templates removed in run-09), grep for the basename across all .md/.json/.js BEFORE the deletion commit. The deletion-time scan caught direct refs in 9 files; a separate /check:all pass surfaced 11 more in canonical docs, SPEC_GRAPH, and audit maps. Wire a pre-commit hook (similar to framework-manifest-guard) that runs ref-checker on any 'D' (delete) status file and blocks the commit on dangling refs unless --force.",
  conditions: { event: "deletion-of-canonical-template", scope: "cross-repo" },
  effective: null,
  pending_validation: true,
  score: 0.85,
  source: "fix:deep",
  related_trace: rtId,
};

fs.appendFileSync(PATHS.learningsFile, JSON.stringify(learning) + "\n");
console.log(`[learning] appended ${learningId} to ${PATHS.learningsFile}`);
console.log("Phase 5.0 + 5.1 complete.");
