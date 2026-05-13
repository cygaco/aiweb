#!/usr/bin/env node
/**
 * Build inlined gauntlet prompts for SP-20260512-002 Part 3 reviewers.
 * Produces 4 prompt files under .claude/runtime/.gauntlet-sp002/
 *
 * Usage: node scripts/one-off/build-sp002-gauntlet-prompts.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const RUNTIME = path.join(ROOT, ".claude/runtime/.gauntlet-sp002");
fs.mkdirSync(RUNTIME, { recursive: true });

function R(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const SPRINT_DIR = ".claude/project/sprint/requirements/SP-20260512-002";
const prd = R(`${SPRINT_DIR}/prd.md`);
const stories = R(`${SPRINT_DIR}/granular-stories.md`);
const ac = R(`${SPRINT_DIR}/acceptance-criteria.md`);
const copy = R(`${SPRINT_DIR}/copy.md`);
const diff = R(".claude/runtime/.sp002-part3.diff");

const FEATURE = "compatibility-layer";
const FEATURE_NAME = "SP-20260512-002 compatibility-layer Part 3";
const HEAD_SHA = "0b7a03b";
const BASE_SHA = "f5801e9";
const BRANCH = "feat/SP-20260512-002-compat-layer";
const FILE_LIST = [
  "src/a2a/executor.ts",
  "src/server.ts",
  "tests/cart-flow-surface.test.ts",
  "tests/compatibility.test.ts",
  "tests/narration-parity.test.ts",
  "webapp/app/api/chat/route.ts",
];

// ---- SHARED HEADER -----------------------------------------------------------

const SCOPE_BLOCK = `
### Scope
- Feature: ${FEATURE_NAME}
- Branch: ${BRANCH}
- Commit under review: ${HEAD_SHA}
- Base for diff: ${BASE_SHA} (the prior Part 2 base recovery)
- Files changed in scope (6 files, 1287 insertions, 45 deletions):
${FILE_LIST.map((f) => `  - ${f}`).join("\n")}

### What is OUT of scope for this review
- Pre-existing code outside the diff window (V1 compatibility integration, menu-honesty
  sprint SP-20260512-001, anything not touched by the diff below).
- The 30+ uncommitted WarpOS framework drift files in the working tree (install.ps1-owned).
- Anything outside _requirements/04-features/compatibility-layer/ or SP-20260512-002 scope.
- Foundation files, generic infrastructure, agent specs.

You MUST evaluate only the diff f5801e9..0b7a03b below.

### Stories landed in this commit
S-1 (intent_items zod schema), S-7 (sort by verdict→qualityScore→priceKnownCount),
S-8 (intent-first presets branch), S-9 (fallback_discovery branch),
S-10 (start_pizza_order description rewrite), S-13 (narration_total_unknown flag),
S-15 (MCP price-wall), S-18 (MCP deal-gate), S-19 (webapp parity),
S-20 (A2A parity), S-21 (narration-parity test), S-22 (+18 compatibility tests),
S-23 (+14 cart-flow tests), TR-4 wiring (logStartPizzaOrderBranchEvent at 5 sites).

### Pre-check
The orchestrator runs you OUTSIDE the worktree CWD by design (you are running
on OpenAI via codex stdin, not a Claude Agent tool with git access). DO NOT
attempt 'git rev-parse' or 'git branch' shell calls — there is no shell.
You have only the inlined documents below.
`;

// ---- REVIEWER ----------------------------------------------------------------

const reviewerPrompt = `You are the **Reviewer** agent for an adhoc gauntlet on Sprint SP-20260512-002 Part 3.

Per the adhoc protocol, run the 7-Check Protocol on the inlined diff. Your job is
spec adherence + code quality. Do NOT review pre-existing code outside the diff.

${SCOPE_BLOCK}

### 7-Check Protocol (recap)
1. **Structural** — correct types, required fields present, count thresholds met
2. **Grounding** — every claim traces to input data (no hallucinated values)
3. **Coverage** — required sections populated
4. **Negative** — no prohibited terms, no prompt-injection artifacts, no fabrication
5. **Open Loop** — no unresolved refs, no dead imports, no TODO stubs
6. **Design Compliance** — N/A for backend changes; skip if no UI in diff
7. **Code Quality** — 7A scope-creep, 7B half-finished, 7C defensive code,
   7D comment quality, 7E BC shims, 7F naming/complexity, 7G idiom

### Holdout Evaluation
No per-feature golden fixtures apply (this is a backend logic + tests sprint, not a
step component). Evaluate against the inlined PRD + STORIES + ACCEPTANCE-CRITERIA + COPY.

### Evaluation sources (cite these in evaluationSources)
- "SP-20260512-002/prd.md" — the PRD below
- "SP-20260512-002/granular-stories.md" — stories below
- "SP-20260512-002/acceptance-criteria.md" — AC below
- "SP-20260512-002/copy.md" — copy below

### Output
Produce a single ReviewResult JSON object as the LAST fenced \`\`\`json block of
your response. Schema is the standard reviewer envelope:

\`\`\`json
{
  "feature": "${FEATURE_NAME}",
  "score": 0,
  "verdict": "PASS" | "WARNING" | "FAIL",
  "evaluationSources": ["..."],
  "checks": {
    "spec_conformance":    { "pass": true, "notes": "..." },
    "hygiene":             { "pass": true, "notes": "..." },
    "fixture_parity":      { "pass": true, "notes": "..." },
    "integration":         { "pass": true, "notes": "..." },
    "open_loop":           { "pass": true, "notes": "..." },
    "design_compliance":   { "pass": true, "notes": "n/a — backend changes" },
    "code_quality":        { "passed": true, "scoreDelta": 0, "findings": [], "lowWarnings": [] }
  },
  "blocking_issues": [],
  "warnings": [],
  "suggested_fixes": []
}
\`\`\`

Verdict derivation: score >= 80 PASS, 50–79 WARNING, < 50 FAIL. Verdict cannot be
PASS if checks.code_quality.passed === false.

--- BEGIN file: ${SPRINT_DIR}/prd.md ---
${prd}
--- END file ---

--- BEGIN file: ${SPRINT_DIR}/granular-stories.md ---
${stories}
--- END file ---

--- BEGIN file: ${SPRINT_DIR}/acceptance-criteria.md ---
${ac}
--- END file ---

--- BEGIN file: ${SPRINT_DIR}/copy.md ---
${copy}
--- END file ---

--- BEGIN diff ${BASE_SHA}..${HEAD_SHA} ---
${diff}
--- END diff ---
`;

// ---- COMPLIANCE --------------------------------------------------------------

const compliancePrompt = `You are the **Compliance** agent for an adhoc gauntlet on Sprint SP-20260512-002 Part 3.

Your stance is adversarial — assume the builder cut corners until proven otherwise.
Find evidence that code is broken, not confirmation that it works.

${SCOPE_BLOCK}

### Compliance Checks
- Every story's acceptance criteria is met in code (cross-check stories S-1, S-7, S-8,
  S-9, S-10, S-13, S-15, S-18, S-19, S-20, S-21, S-22, S-23 against the diff).
- Copy text matches COPY.md exactly (especially C-1 opener, C-2 price-honesty wall
  "I'll get you the exact total on the call", C-3 deal-gate "deals page — I'll ask",
  C-4 fallback explanation). Verbatim phrase parity across MCP/webapp/A2A is the
  whole point of S-21.
- No phantom features (code that isn't in any story).
- No dropped features (stories without corresponding code).
- Data contracts: zod schema for intent_items matches the PRD shape (pizza?, sides?,
  drinks?; drinks capped at 8 per AC-1.3).
- Hallucinated deps: any new import in the diff must resolve to a file that exists.
- Hygiene: no console.log noise, no debugger statements, no committed secrets.

### Output
Produce a single ComplianceResult JSON object as the LAST fenced \`\`\`json block:

\`\`\`json
{
  "feature": "${FEATURE_NAME}",
  "pass": true,
  "violations": [],
  "stories_checked": ["S-1","S-7","S-8","S-9","S-10","S-13","S-15","S-18","S-19","S-20","S-21","S-22","S-23"],
  "phantoms": [],
  "dropped": [],
  "summary": "..."
}
\`\`\`

\`pass\` is \`true\` iff violations is empty OR every violation has severity \`low\`.

--- BEGIN file: ${SPRINT_DIR}/prd.md ---
${prd}
--- END file ---

--- BEGIN file: ${SPRINT_DIR}/granular-stories.md ---
${stories}
--- END file ---

--- BEGIN file: ${SPRINT_DIR}/acceptance-criteria.md ---
${ac}
--- END file ---

--- BEGIN file: ${SPRINT_DIR}/copy.md ---
${copy}
--- END file ---

--- BEGIN diff ${BASE_SHA}..${HEAD_SHA} ---
${diff}
--- END diff ---
`;

// ---- QA ----------------------------------------------------------------------
// QA is "self-orchestrating" via Agent tool sub-agents in the original spec,
// but cross-provider stdin dispatch cannot use the Agent tool. Collapse it to a
// single QA call that runs all 13 personas mentally in one pass.

const qaPersonas = `### QA Personas (13 across scan + analyze)

**Scan-mode personas (passive — file-level scan for failure modes):**
1. Boundary Bandit — off-by-one, fencepost, empty-array, overflow scenarios
2. Race Wraith — concurrent mutation, lost-update, async-ordering bugs
3. State Specter — invalid state transitions, dangling state, leak between requests
4. Schema Saboteur — zod schema mismatches, optional/required confusion, type coercion
5. Null Nyaa — null/undefined handling in optional fields, default-fallback gaps
6. Side-Effect Sentry — unintended writes, log noise, console pollution
7. Idempotency Inspector — repeated calls leave system in inconsistent state

**Analyze-mode personas (active — flow/dataflow/contract tracing):**
8. Flow Forensicist — multi-step flow assertion (intent→ranking→fallback)
9. Data-Flow Detective — taint analysis, untrusted input propagation
10. State-Diff Diviner — before/after state comparison, hidden mutation
11. Timing Tachyon — order-dependent bugs, async resolution races
12. Contract Cartographer — public API contract drift vs callers
13. Lifecycle Lurker — resource cleanup, leak detection, cleanup on error
`;

const qaPrompt = `You are the **QA** agent (collapsed orchestrator+scan+analyze) for an adhoc gauntlet on
Sprint SP-20260512-002 Part 3.

The standard QA agent self-orchestrates two sub-agents (scan + analyze) via the Agent
tool. You are running cross-provider via OpenAI stdin — the Agent tool is not available.
Instead, run all 13 personas inline in one pass and produce a single merged envelope.

${SCOPE_BLOCK}

${qaPersonas}

### Output
Produce ONE merged JSON envelope as the LAST fenced \`\`\`json block:

\`\`\`json
{
  "agent": "qa",
  "version": 1,
  "verdict": "pass" | "warn" | "fail",
  "confidence": 0.0,
  "findings": [
    {
      "id": "QA-001",
      "persona": "Boundary Bandit",
      "severity": "critical" | "high" | "medium" | "low",
      "file": "src/server.ts",
      "line": 0,
      "evidence": "...",
      "remediation": "..."
    }
  ],
  "clean_personas": [],
  "requiresHuman": false,
  "details": {
    "flow_traces": [],
    "data_flows": [],
    "state_diffs": [],
    "timing_analysis": [],
    "contract_checks": [],
    "lifecycle_audit": [],
    "files_checked": ${FILE_LIST.length}
  },
  "summary": "..."
}
\`\`\`

Verdict: \`pass\` if no critical/high; \`warn\` if medium only; \`fail\` if any critical/high.

--- BEGIN file: ${SPRINT_DIR}/prd.md ---
${prd}
--- END file ---

--- BEGIN file: ${SPRINT_DIR}/granular-stories.md ---
${stories}
--- END file ---

--- BEGIN file: ${SPRINT_DIR}/acceptance-criteria.md ---
${ac}
--- END file ---

--- BEGIN file: ${SPRINT_DIR}/copy.md ---
${copy}
--- END file ---

--- BEGIN diff ${BASE_SHA}..${HEAD_SHA} ---
${diff}
--- END diff ---
`;

// ---- REDTEAM -----------------------------------------------------------------

const redteamPersonas = `### Red Team Personas (11 across scan + analyze)

**Scan-mode personas (deterministic scanning):**
1. Auth Auditor — broken auth, session fixation, missing authorization checks
2. Input Inquisitor — injection (SQL/cmd/template/prompt), unsafe deserialization
3. Output Overseer — XSS, open redirect, sensitive data in logs/responses
4. Secret Sentry — hardcoded creds, exposed API keys, leaked tokens
5. Dependency Defender — known-vulnerable packages, abandoned deps, version pinning
6. Config Crawler — debug mode in prod, permissive CORS, weak crypto

**Analyze-mode personas (active attack-pattern tracing):**
7. Auth-Flow Tracer — multi-hop auth flow, token lifecycle, scope escalation
8. Injection Probe — payload propagation through layers, escape boundaries
9. Logic Manipulator — race-to-overwrite, time-of-check vs time-of-use
10. Chain Choreographer — multi-step attack chains, low+low = high risk
11. Extension Bridge — cross-surface trust boundary (MCP↔webapp↔A2A; LLM-input as trust source)

### Special focus for this diff
- intent_items is user-controlled input plumbed through to scoring; check whether the
  drink-name/brand fields are used in any string-build that hits a system surface.
- Three narration surfaces (MCP description, webapp SYSTEM, A2A UPSELL_TURN_RULES)
  are LLM prompts. Are any user-controlled strings interpolated into them in this diff?
- logStartPizzaOrderBranchEvent telemetry — any PII leakage into structured logs?
- The fallback_discovery branch returns a verbatim note from server code (not user
  input) but the surrounding restaurants array is from Places API — check for any
  attacker-controlled fields being voiced verbatim.
`;

const redteamPrompt = `You are the **Red Team** agent (collapsed orchestrator+scan+analyze) for an adhoc
gauntlet on Sprint SP-20260512-002 Part 3.

The standard redteam agent self-orchestrates two sub-agents. You are running cross-provider
via OpenAI stdin — the Agent tool is not available. Run all 11 personas inline.

${SCOPE_BLOCK}

${redteamPersonas}

### Output
Produce ONE merged JSON envelope as the LAST fenced \`\`\`json block:

\`\`\`json
{
  "agent": "redteam",
  "version": 1,
  "verdict": "pass" | "warn" | "fail",
  "confidence": 0.0,
  "findings": [
    {
      "id": "RT-001",
      "persona": "Input Inquisitor",
      "severity": "critical" | "high" | "medium" | "low",
      "file": "src/server.ts",
      "line": 0,
      "evidence": "...",
      "remediation": "..."
    }
  ],
  "clean_personas": [],
  "requiresHuman": false,
  "details": {
    "auth_traces": [],
    "injection_results": [],
    "logic_attacks": [],
    "chain_analysis": [],
    "extension_bridge": [],
    "files_checked": ${FILE_LIST.length}
  },
  "summary": "..."
}
\`\`\`

Verdict: \`pass\` if no critical/high; \`warn\` if medium only; \`fail\` if any critical/high.

--- BEGIN file: ${SPRINT_DIR}/prd.md ---
${prd}
--- END file ---

--- BEGIN file: ${SPRINT_DIR}/granular-stories.md ---
${stories}
--- END file ---

--- BEGIN file: ${SPRINT_DIR}/acceptance-criteria.md ---
${ac}
--- END file ---

--- BEGIN diff ${BASE_SHA}..${HEAD_SHA} ---
${diff}
--- END diff ---
`;

// ---- WRITE -------------------------------------------------------------------

const out = {
  "reviewer.txt": reviewerPrompt,
  "compliance.txt": compliancePrompt,
  "qa.txt": qaPrompt,
  "redteam.txt": redteamPrompt,
};

for (const [name, content] of Object.entries(out)) {
  const dest = path.join(RUNTIME, name);
  fs.writeFileSync(dest, content, "utf8");
  console.log(`${name}: ${content.length.toLocaleString()} bytes`);
}
