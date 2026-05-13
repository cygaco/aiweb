#!/usr/bin/env node
/**
 * Build inlined gauntlet prompts for SP-20260512-002 CYCLE 2.
 *
 * Cycle 1 ran on diff f5801e9..0b7a03b — verdict was FAIL (reviewer, qa)
 * with PASS on redteam and ETIMEDOUT on compliance. Cycle 2 fixes landed
 * in c71165a (MEDIUM findings) + cfd7895 (remaining blocking findings).
 *
 * This script builds the cycle-2 prompts to verify cycle-1 issues are
 * resolved on the new HEAD.
 *
 *   Old HEAD: 0b7a03b   (cycle-1 commit under review)
 *   New HEAD: cfd7895   (cycle-2 commit — fixes applied)
 *
 * Output: 4 prompt files under .claude/runtime/.gauntlet-sp002-cycle2/
 *
 * Usage: node scripts/one-off/build-sp002-gauntlet-prompts-cycle2.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const RUNTIME = path.join(ROOT, ".claude/runtime/.gauntlet-sp002-cycle2");
fs.mkdirSync(RUNTIME, { recursive: true });

function R(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const SPRINT_DIR = ".claude/project/sprint/requirements/SP-20260512-002";
const prd = R(`${SPRINT_DIR}/prd.md`);
const stories = R(`${SPRINT_DIR}/granular-stories.md`);
const ac = R(`${SPRINT_DIR}/acceptance-criteria.md`);
const copy = R(`${SPRINT_DIR}/copy.md`);
const diff = R(".claude/runtime/.sp002-cycle2.diff");

const FEATURE_NAME = "SP-20260512-002 compatibility-layer (cycle 2)";
const HEAD_SHA = "cfd7895";
const BASE_SHA = "0b7a03b";
const BRANCH = "feat/SP-20260512-002-compat-layer";
const FILE_LIST = [
  "src/a2a/executor.ts",
  "src/lib/compatibility.ts",
  "src/lib/event-log.ts",
  "src/server.ts",
  "tests/cart-flow-surface.test.ts",
  "tests/compatibility.test.ts",
  "webapp/app/api/chat/route.ts",
];

// ---- CYCLE-1 FINDINGS (verbatim from gauntlet-sp002-results/) -----------------

const CYCLE_1_FINDINGS = `### Cycle-1 findings to verify resolved on HEAD ${HEAD_SHA}

Reviewer (verdict: FAIL, score 46) — three blocking issues:
  R-B1. src/server.ts:652 — intent_items zod schema not .strict() → AC-1.1 violated.
  R-B2. src/server.ts:743 — no-intent presets branch still runs compatibility
        scoring/sorting/enrichment → S-8, R-3, AC-8.1 violated. primaryRestaurant
        was a compat-ranked winner instead of source-order first.
  R-B3. src/server.ts:1079 — side/drink-only intent fell through to
        styleToUse = "pepperoni" and orderFromIntent → PRD R-1 grounding violated.
  Plus low warnings: unused Deal import + makeCart helper + DOMINOS_REAL fixture.

QA (verdict: FAIL):
  QA-001 (high) — side/drink-only fabricates pepperoni order. Same as R-B3.
  QA-002 (medium) — intent_items not strict. Same as R-B1.
  QA-003 (medium) — presets path performs ranking + enrichment side-effects. Same as R-B2.
  QA-004 (medium) — AC-14.3: result.presets[].estimated_only flag missing when
                    estimatedTotal === null.

RedTeam (verdict: PASS) — no security findings.
Compliance — DID NOT COMPLETE in cycle 1 (codex ETIMEDOUT). Re-run from scratch
            in cycle 2.

### Cycle-2 fix commits

c71165a — TR-4 occasion label, drinks-only guard (R-B3 / QA-001),
          zod strict (R-B1 / QA-002), nextStep injection defuse.
cfd7895 — shouldRank gate (R-B2 / QA-003) — wraps assessCompatibility,
          sort, enrichment, re-sort in a single if(shouldRank); presets path
          now skips all three so primaryRestaurant stays in source order.
        — AC-14.3 estimated_only flag on result.presets[].
        — test hygiene: drop unused Deal import, makeCart helper, DOMINOS_REAL fixture.

### Your verification task

For each cycle-1 finding, judge whether the cycle-2 diff resolves it. If you
believe a finding is NOT resolved, surface it with the same id (R-B1 / QA-002 etc.)
plus the new evidence. If a finding IS resolved, list it under clean checks.

Also run your full standard protocol on the diff for any NEW issues introduced
by the fix.
`;

// ---- SHARED HEADER -----------------------------------------------------------

const SCOPE_BLOCK = `
### Scope
- Feature: ${FEATURE_NAME}
- Branch: ${BRANCH}
- Commit under review: ${HEAD_SHA}
- Base for diff: ${BASE_SHA} (the cycle-1 HEAD that failed gauntlet)
- Files changed in cycle-2 scope:
${FILE_LIST.map((f) => `  - ${f}`).join("\n")}

### What is OUT of scope for this review
- Pre-existing code outside the cycle-2 diff window (the bundle landed in
  84165ea/f5801e9/0b7a03b was already reviewed in cycle 1; cycle 2 only reviews
  what changed since 0b7a03b).
- WarpOS framework drift files in the working tree (install.ps1-owned).
- Anything outside the SP-20260512-002 sprint scope.

You MUST evaluate only the diff ${BASE_SHA}..${HEAD_SHA} below.

${CYCLE_1_FINDINGS}

### Pre-check
The orchestrator runs you OUTSIDE the worktree CWD by design (you are running
on OpenAI via codex stdin, not a Claude Agent tool with git access). DO NOT
attempt 'git rev-parse' or 'git branch' shell calls — there is no shell.
You have only the inlined documents below.
`;

// ---- REVIEWER ----------------------------------------------------------------

const reviewerPrompt = `You are the **Reviewer** agent for cycle 2 of an adhoc gauntlet on Sprint SP-20260512-002.

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
No per-feature golden fixtures apply. Evaluate against the inlined PRD + STORIES +
ACCEPTANCE-CRITERIA + COPY plus the cycle-1 findings list above.

### Evaluation sources (cite these in evaluationSources)
- "SP-20260512-002/prd.md"
- "SP-20260512-002/granular-stories.md"
- "SP-20260512-002/acceptance-criteria.md"
- "SP-20260512-002/copy.md"
- "cycle-1 findings (gauntlet-sp002-results/)"

### Output
Produce a single ReviewResult JSON object as the LAST fenced \`\`\`json block of
your response. Schema:

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
  "cycle_1_resolution": {
    "R-B1_zod_strict":         "resolved" | "not_resolved" | "partial",
    "R-B2_presets_unranked":   "resolved" | "not_resolved" | "partial",
    "R-B3_drinks_only_guard":  "resolved" | "not_resolved" | "partial"
  },
  "blocking_issues": [],
  "warnings": [],
  "suggested_fixes": []
}
\`\`\`

Verdict: score >= 80 PASS, 50–79 WARNING, < 50 FAIL. Verdict cannot be PASS
if checks.code_quality.passed === false OR any cycle_1_resolution is "not_resolved".

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

const compliancePrompt = `You are the **Compliance** agent for cycle 2 of an adhoc gauntlet on Sprint SP-20260512-002.

Your stance is adversarial — assume the builder cut corners until proven otherwise.
Find evidence that code is broken, not confirmation that it works.

**Note**: cycle 1 compliance failed to complete (codex ETIMEDOUT). This is a fresh
compliance pass on the cycle-2 HEAD. You must verify cycle-1 stories AND the
cycle-2 fixes hold.

${SCOPE_BLOCK}

### Compliance Checks
- Every cycle-1 story's acceptance criteria is met in code (cross-check S-1, S-7,
  S-8, S-9, S-10, S-13, S-15, S-18, S-19, S-20, S-21, S-22, S-23) on the cycle-2 HEAD.
- AC-1.1 (zod .strict()) — verify intent_items schema rejects unknown top-level keys.
- AC-8.1 / AC-8.2 (no-intent presets unranked) — verify the diff's shouldRank gate
  short-circuits sort + enrichment when intent_items is undefined or empty.
- AC-14.3 (estimated_only flag) — verify result.presets[] now carries estimated_only.
- COPY parity (C-1, C-2, C-3, C-4) verbatim across MCP / webapp / A2A.
- No phantom features (code without story coverage).
- No dropped features (stories without code).
- Hallucinated deps: any new import in the diff must resolve.
- Hygiene: no console.log noise, no debugger, no committed secrets.

### Output
Produce a single ComplianceResult JSON object as the LAST fenced \`\`\`json block:

\`\`\`json
{
  "feature": "${FEATURE_NAME}",
  "pass": true,
  "violations": [],
  "stories_checked": ["S-1","S-7","S-8","S-9","S-10","S-13","S-15","S-18","S-19","S-20","S-21","S-22","S-23"],
  "cycle_1_resolution": {
    "R-B1_zod_strict":         "resolved" | "not_resolved" | "partial",
    "R-B2_presets_unranked":   "resolved" | "not_resolved" | "partial",
    "R-B3_drinks_only_guard":  "resolved" | "not_resolved" | "partial",
    "QA-004_estimated_only":   "resolved" | "not_resolved" | "partial"
  },
  "phantoms": [],
  "dropped": [],
  "summary": "..."
}
\`\`\`

\`pass\` is \`true\` iff violations is empty OR every violation has severity \`low\`,
AND every cycle_1_resolution is "resolved".

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

const qaPersonas = `### QA Personas (13 across scan + analyze)

**Scan-mode (passive — file-level scan for failure modes):**
1. Boundary Bandit — off-by-one, fencepost, empty-array, overflow
2. Race Wraith — concurrent mutation, lost-update, async-ordering
3. State Specter — invalid transitions, dangling state, request-leakage
4. Schema Saboteur — zod schema mismatches, optional/required confusion
5. Null Nyaa — null/undefined gaps in optional fields
6. Side-Effect Sentry — unintended writes, log noise, console pollution
7. Idempotency Inspector — repeated calls leave inconsistent state

**Analyze-mode (active — flow/dataflow/contract tracing):**
8. Flow Forensicist — multi-step flow assertion
9. Data-Flow Detective — taint analysis, untrusted input propagation
10. State-Diff Diviner — before/after state comparison
11. Timing Tachyon — order-dependent bugs, async resolution races
12. Contract Cartographer — public API contract drift vs callers
13. Lifecycle Lurker — resource cleanup, leak detection

### Cycle-2 special focus
- Does the shouldRank gate skip enrichment side-effects (logEnrichmentEvent)
  in the no-intent path? (QA-003 concern)
- Does the presets branch now use restaurants[0] in source-order, not
  compat-ranked? (R-B2 concern)
- Does intent_items.pasta:'foo' get rejected by zod? (R-B1 / QA-002 concern)
- Does intent_items.drinks=[{name:'coke'}] with no pizza intent NOT produce a
  pepperoni suggested_order? (R-B3 / QA-001 concern)
- Does result.presets[] now carry estimated_only:true when total is null?
  (QA-004 concern)
`;

const qaPrompt = `You are the **QA** agent (collapsed orchestrator+scan+analyze) for cycle 2 of an
adhoc gauntlet on Sprint SP-20260512-002.

The standard QA agent self-orchestrates two sub-agents via the Agent tool. You
are running cross-provider via OpenAI stdin — Agent tool not available. Run all
13 personas inline in one pass.

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
  "cycle_1_resolution": {
    "QA-001_drinks_only_pepperoni": "resolved" | "not_resolved" | "partial",
    "QA-002_zod_strict":            "resolved" | "not_resolved" | "partial",
    "QA-003_presets_side_effects":  "resolved" | "not_resolved" | "partial",
    "QA-004_estimated_only":        "resolved" | "not_resolved" | "partial"
  },
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

Verdict: \`pass\` if no critical/high AND every cycle_1_resolution is "resolved";
\`warn\` if medium-only and resolutions are clean; \`fail\` otherwise.

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

**Scan-mode (deterministic):**
1. Auth Auditor — broken auth, session fixation, missing authz
2. Input Inquisitor — injection (SQL/cmd/template/prompt), unsafe deserialization
3. Output Overseer — XSS, open redirect, sensitive data in logs/responses
4. Secret Sentry — hardcoded creds, exposed keys
5. Dependency Defender — known-vulnerable packages
6. Config Crawler — debug in prod, permissive CORS, weak crypto

**Analyze-mode (active attack tracing):**
7. Auth-Flow Tracer — multi-hop auth, token lifecycle, scope escalation
8. Injection Probe — payload propagation across layers
9. Logic Manipulator — race-to-overwrite, TOCTOU
10. Chain Choreographer — multi-step attack chains
11. Extension Bridge — cross-surface trust boundary (MCP↔webapp↔A2A; LLM-input)

### Cycle-2 special focus
- The shouldRank gate adds a new control-flow split. Any way to flip it to
  bypass a safety check? (e.g. craft intent_items that toggles shouldRank but
  doesn't actually rank.)
- The new estimated_only boolean is server-derived — no user-input path.
- Test fixture deletions are non-runtime. No security surface.
- Cycle 1 redteam was PASS. Re-verify nothing introduced.
`;

const redteamPrompt = `You are the **Red Team** agent (collapsed orchestrator+scan+analyze) for cycle 2
of an adhoc gauntlet on Sprint SP-20260512-002.

Agent tool not available (running via codex stdin). Run all 11 personas inline.

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
