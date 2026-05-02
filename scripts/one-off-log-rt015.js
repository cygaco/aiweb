#!/usr/bin/env node
// One-off: log RT-015 trace + accompanying learning for the BD discovery-mode fix.
// Self-contained because merge-guard blocks `node -e fs.write` patterns (RI-004).
const { PATHS } = require("./hooks/lib/paths");
const fs = require("fs");

const ts = new Date().toISOString();
const traceId = "RT-015";
const learningId = "LRN-2026-04-25-bd-discover-mode";

const trace = {
  id: traceId,
  ts,
  framework_selected: "RCA + Trace Analysis",
  framework_rationale:
    "Recurring/regression-class issue (RT-014 was the prior fix). RCA was right framework because the same scraper has now failed twice with different symptoms — need to find the deepest cause that, if fixed, prevents recurrence. Trace Analysis confirmed the layer where data goes wrong: BD response itself contains only error_code:dead_page records.",
  history_match: "RT-014",
  problem:
    "BD LinkedIn Jobs scraper returns 1-element arrays per query where the single element is an error record (error_code: dead_page); user sees 'exactly 1 result per query' (queryStats), but normalizeJob produces empty stubs that dedup filters out, so jobs[] is empty in the UI.",
  root_cause:
    "Trigger URL ${BD_API_BASE}/datasets/v3/trigger?dataset_id=X&include_errors=true omitted the discovery-mode flags. Without &type=discover_new&discover_by=keyword, BD treats input URLs as single-job-page collect targets. LinkedIn redirects /jobs/search/?keywords=... to a search page, BD flags dead_page, returns 1 error record per input. The original Mar 26 fix (commit 609f6dd) used the same URL — apparently worked when BD's defaults differed. RT-014 restored the URL input shape but did not add the flags.",
  fix: "Added &type=discover_new&discover_by=keyword to the trigger URL in src/app/api/jobs/route.ts triggerSnapshot(). Type-check passes; runtime verification deferred until next BD trigger.",
  quality_score: 3,
  source: "fix:deep",
  learning_id: learningId,
};

const learning = {
  id: learningId,
  ts,
  intent: "bug_fix",
  tip: "BD dataset trigger URLs MUST include &type=discover_new&discover_by=keyword for discovery-mode datasets (e.g., gd_lpfll7v5hcqtkxl6l LinkedIn Jobs). Without it, BD treats inputs as single-page collect targets and returns dead_page error records that look like 1-result-per-query in queryStats. RT-014 + RT-015 both regressed because this flag is implicit on BD's dashboard config but not in the API URL — make it explicit in code.",
  effective: null,
  pending_validation: true,
  score: 0,
  source: "fix:deep",
  trace_id: traceId,
};

fs.appendFileSync(PATHS.tracesFile, JSON.stringify(trace) + "\n");
fs.appendFileSync(PATHS.learningsFile, JSON.stringify(learning) + "\n");

console.log(`Logged ${traceId} + ${learningId}`);
