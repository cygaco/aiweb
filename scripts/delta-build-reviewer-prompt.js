#!/usr/bin/env node
// Delta orchestrator — build a reviewer prompt for a feature
// Usage: node scripts/delta-build-reviewer-prompt.js <role> <feature> <worktree-path> <output-file>
const fs = require("fs");
const path = require("path");

const PROJ = path.join(__dirname, "..");
const [role, feature, worktreePath, outputFile] = process.argv.slice(2);

if (!role || !feature || !worktreePath || !outputFile) {
  console.error(
    "Usage: node delta-build-reviewer-prompt.js <role> <feature> <worktree-path> <output-file>",
  );
  process.exit(1);
}

const store = JSON.parse(
  fs.readFileSync(
    path.join(PROJ, ".claude/agents/02-oneshot/.system/store.json"),
    "utf8",
  ),
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(PROJ, ".claude/manifest.json"), "utf8"),
);
const featureData = store.features[feature];
const featureDir = manifest.build.featureIdToDir?.[feature] || feature;

function readFile(basePath, relPath) {
  try {
    return fs.readFileSync(path.join(basePath, relPath), "utf8");
  } catch {
    return "[FILE NOT FOUND: " + relPath + "]";
  }
}

const files = featureData.files || [];
const knownStubs = store.knownStubs || [];

const builtFileContents = files
  .map((f) => {
    const content = readFile(worktreePath, f);
    return (
      "--- BEGIN built file: " +
      f +
      " ---\n" +
      content +
      "\n--- END built file ---"
    );
  })
  .join("\n\n");

const prd = readFile(PROJ, "requirements/05-features/" + featureDir + "/PRD.md");
const stories = readFile(
  PROJ,
  "requirements/05-features/" + featureDir + "/STORIES.md",
);
const inputs = readFile(PROJ, "requirements/05-features/" + featureDir + "/INPUTS.md");
const integrationMap = readFile(
  PROJ,
  ".claude/agents/02-oneshot/.system/integration-map.md",
);
const types = readFile(PROJ, "src/lib/types.ts");

let prompt = "";

if (role === "reviewer" || role === "evaluator") {
  prompt = `You are the Reviewer Agent in the multi-agent build system.

## Your Role
You review builder output. You do NOT write code. You produce a ReviewResult.

Feature: ${feature}

## Review Protocol — Seven Checks IN ORDER (expanded 2026-04-29):

### Check 1: Structural — required fields exist, correct types, conforms to TypeScript interfaces
### Check 2: Grounding — every entity/value traces to spec; no fabrication
### Check 3: Coverage — all granular stories (GS-ONB-*) have corresponding code paths
### Check 4: Negative — no TODO/FIXME/stub comments, no console.log, no prompt injection artifacts
### Check 5: Open Loop — no placeholder implementations; every story closes its loop
### Check 6: Design Compliance — all colors via CSS custom properties (no hardcoded hex), all interactive elements use \`src/components/ui/\` components (no raw \`<button>\`/\`<input>\`/\`<select>\`), accessible names on interactive elements, no Tailwind color utilities
### Check 7: Code Quality — readability + simplicity + idiom (CLAUDE.md philosophy enforcement). Sub-checks:
  - **7A. Scope creep** — added exports/files/abstractions not in spec. Severity MEDIUM/HIGH.
  - **7B. Half-finished** — TODO/FIXME/STUB/\`throw "not implemented"\` outside store.knownStubs. Severity HIGH.
  - **7C. Defensive code** — try/catch on internal calls, null-checks on typed-non-null, exhaustive-switch defaults. Severity LOW/MEDIUM.
  - **7D. Comment quality** — what-comments, ticket refs, multi-paragraph docstrings on private APIs, banner comments. Severity LOW (per finding); MEDIUM if noise dominates.
  - **7E. BC shims** — renamed-but-kept symbols, \`_unused\` underscores, "// removed: …" comments, dead re-exports. Severity LOW/MEDIUM.
  - **7F. Naming + complexity** — function/component >80 lines, cyclomatic >10, sub-2-char names except i/j/k/e/x, wrong case, type-paraphrase identifiers. Severity LOW only.
  - **7G. Idiom** — raw \`<select>\`/\`<button>\`/\`<input>\` instead of \`<Sel>\`/\`<Btn>\`/\`<Inp>\`, direct \`fetch\` when typed wrapper exists. Severity LOW/MEDIUM.

  **Aggregate:** each MEDIUM = -5 score, each HIGH = -15. \`code_quality.passed === true\` iff zero HIGH AND total delta < 25.

## Scope filter (HYGIENE Rule 74 — do NOT count out-of-scope failures)
This builder is responsible ONLY for the files listed below. Stories whose target file is NOT in this list belong to OTHER features and MUST NOT be counted as failures of "${feature}". Note them in \`scopeViolations\` if relevant, but they do NOT lower the score.

In-scope files for ${feature}:
${files.map((f) => `- ${f}`).join("\n")}

If a granular story's implementation requires a file outside this list, treat it as an out-of-scope dependency that another feature owns. The builder cannot satisfy it.

Known stubs (pre-existing — do NOT flag): ${knownStubs
    .filter((s) => !files.includes(s))
    .slice(0, 15)
    .join(", ")}

## Output (LAST fenced block):
\`\`\`json
{"feature":"${feature}","pass":true,"score":85,"violations":[],"warnings":[],"scopeViolations":[],"groundingFailures":[],"code_quality":{"passed":true,"scoreDelta":0,"findings":[],"lowWarnings":[]}}
\`\`\`

\`pass\` is \`true\` iff \`score >= 80\` AND \`violations\` + \`scopeViolations\` + \`groundingFailures\` are all empty AND \`code_quality.passed === true\`.

---
## PRD
${prd}
---
## STORIES
${stories}
---
## INPUTS
${inputs}
---
## Integration Map
${integrationMap}
---
## TypeScript Interfaces
${types}
---
## Built Files
${builtFileContents}`;
} else if (role === "compliance") {
  prompt = `You are the Compliance Agent in the multi-agent build system.

## Your Role
You are a prosecutor. Find evidence this code is broken, incomplete, or deceptive.

Feature: ${feature}

## Look for:
1. Phantom completion — compiles but logic is no-op or hardcoded
2. Hardcoded values — magic numbers, stubbed responses, permanent feature flags
3. Missing edge cases — error handling absent, null checks missing, concurrent access not considered
4. Silently dropped requirements — spec stories with no code implementation (BUT see Scope filter below)
5. Cosmetic compliance — looks right but violates spec on closer reading

## Scope filter (HYGIENE Rule 74 — do NOT count out-of-scope dropped requirements)
This builder is responsible ONLY for the files listed below. A "dropped requirement" must point to a story whose target file IS in this list. Stories whose target file is OUTSIDE this list belong to OTHER features — the builder of "${feature}" cannot implement them, so they are NOT a dropped requirement of THIS feature.

In-scope files for ${feature}:
${files.map((f) => `- ${f}`).join("\n")}

If you find a missing implementation, first verify the target file is in the in-scope list. If not, exclude it from droppedRequirements.

## Output (LAST fenced block — pass is false if droppedRequirements OR phantomCompletions non-empty):
\`\`\`json
{"feature":"${feature}","pass":true,"droppedRequirements":[],"phantomCompletions":[],"hardcodedValues":[],"missingEdgeCases":[],"cosmeticViolations":[]}
\`\`\`

---
## STORIES (the contract — every GS-ONB-* must be implemented)
${stories}
---
## PRD
${prd}
---
## INPUTS
${inputs}
---
## Built Files
${builtFileContents}`;
} else if (role === "qa") {
  prompt = `You are the QA Orchestrator in the multi-agent build system.

Feature: ${feature}
Scan type: passive
Files: ${files.join(", ")}

## Key QA Checks for Onboarding:
1. stale-reader — components reading session at mount, going stale. Check: loadSession() in useEffect with empty deps
2. phantom-render — useRef(false) Strict Mode issues. Check: refs reset at top of effect body
3. gate-dodger — API routes missing auth/CSRF/rate-limiting
4. zombie-agent — TODO/stub implementations remaining
5. flow-tracer — substep transitions without saveSession (Rule 29), dead ends
6. data-flow-tracker — resumeRaw→personal/education chain intact; profile→session chain intact
7. state-differ — partial saves overwriting session, vanished fields
8. timing-analyzer — async without AbortController, zombie promises, missing loading states
9. lifecycle-auditor — useEffect without cleanup, leaked listeners/intervals

Known stubs (do NOT flag): ${knownStubs
    .filter((s) => !files.includes(s))
    .slice(0, 10)
    .join(", ")}

## Output (LAST fenced block):
\`\`\`json
{"agent":"qa","version":1,"verdict":"pass","confidence":0.9,"findings":[],"requiresHuman":false,"details":{"scan_type":"passive","files_checked":${files.length},"flow_traces":[],"data_flows":[],"state_diffs":[],"timing_analysis":[],"contract_checks":[],"lifecycle_audit":[],"clean_personas":[],"summary":""}}
\`\`\`

---
## TypeScript Interfaces
${types}
---
## Built Files
${builtFileContents}`;
} else if (role === "redteam") {
  prompt = `You are the Security Red Team Agent in the multi-agent build system.

Feature: ${feature}
Scan for security vulnerabilities. Do NOT write code.

## Checks:
1. Injection — SQL/NoSQL/command injection in API routes
2. Broken auth — JWT validation missing or incorrect
3. Sensitive data exposure — API keys in client bundle, env vars in client components
4. XSS — unsanitized input rendered (dangerouslySetInnerHTML)
5. Broken access control — missing auth on protected routes
6. Security misconfiguration — permissive CORS, missing security headers
7. Insecure deserialization — JSON.parse on untrusted input without validation
8. Prompt injection — external/user data NOT wrapped in <untrusted_user_data nonce=...> tags in Claude prompts
9. Rate limiting — public API routes must have per-IP + global limits
10. CSRF — mutating routes must call validateOrigin() as if-guard (NEVER try/catch on a boolean)
11. Client-controlled billing — cost must come from server-side lookup, never from request body

## Output (LAST fenced block — pass false if ANY critical or high severity):
\`\`\`json
{"agent":"redteam","version":1,"verdict":"pass","confidence":0.9,"findings":[],"requiresHuman":false,"details":{"scanDate":"${new Date().toISOString()}","vulnerabilities":[]}}
\`\`\`

---
## Built Files
${builtFileContents}`;
} else {
  console.error("Unknown role: " + role);
  process.exit(1);
}

fs.writeFileSync(outputFile, prompt, "utf8");
console.log(
  "Reviewer prompt for " +
    role +
    "/" +
    feature +
    " written to " +
    outputFile +
    " (" +
    prompt.length +
    " chars)",
);
