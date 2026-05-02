#!/usr/bin/env node
// Delta orchestrator — build a complete inlined agent prompt for a feature
// Usage: node scripts/delta-build-prompt.js <feature> <output-file>
const fs = require("fs");
const path = require("path");

const PROJ = path.join(__dirname, "..");
const feature = process.argv[2];
const outputFile = process.argv[3];

if (!feature || !outputFile) {
  console.error("Usage: node delta-build-prompt.js <feature> <output-file>");
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
if (!featureData) {
  console.error(`Feature not found in store: ${feature}`);
  process.exit(1);
}

// Map feature id to spec directory
const featureDir = manifest.build.featureIdToDir?.[feature] || feature;

function readFile(relPath) {
  try {
    return fs.readFileSync(path.join(PROJ, relPath), "utf8");
  } catch (e) {
    return `[FILE NOT FOUND: ${relPath}]`;
  }
}

// Find highest retro with HYGIENE.md
const retrosDir = path.join(PROJ, ".claude/agents/02-oneshot/.system/retros");
const retros = fs
  .readdirSync(retrosDir)
  .filter((d) => /^\d+$/.test(d))
  .sort((a, b) => parseInt(b) - parseInt(a));

let hygieneContent = "[HYGIENE.md NOT FOUND]";
for (const r of retros) {
  const hygPath = path.join(retrosDir, r, "HYGIENE.md");
  if (fs.existsSync(hygPath)) {
    hygieneContent = fs.readFileSync(hygPath, "utf8");
    break;
  }
}

const topBugs = (store.bugDataset || []).slice(0, 10);

const fileList = (featureData.files || []).join("\n- ");
const knownStubs = (store.knownStubs || []).join("\n- ");

const prompt = `feature: ${feature}

You are a Builder Agent in the multi-agent build system.

## MANDATORY FIRST ACTION
Before any git command, run: \`pwd && git worktree list --porcelain | head\`
Your cwd MUST be inside a \`.worktrees/wt-*\` path. If it resolves to the main project root, halt immediately and return \`{"status": "isolation-violation", "cwd": "<resolved-path>"}\`. Do not commit, do not checkout, do not branch. This closes the Phase-1 isolation leak observed 2026-04-21 where a parallel builder leaked its work to the main repo HEAD.

## Your Role
You build ONE feature: ${feature}.
You are stateless. You receive context, produce code, and return. You know nothing about other features.

## File Scope
You may ONLY modify these files:
- ${fileList}

All other files are read-only. If you need a change to a foundation file, write:
FOUNDATION-UPDATE-REQUEST: <file> — <reason>

## Environment
You are running in an isolated worktree on branch agent/${feature}. Commit all work before returning.

## Build Verification
Use \`node node_modules/typescript/bin/tsc --noEmit\` (NOT \`npx tsc\`, NOT \`npm run build\`). Run after every major piece.

## Known Bug Patterns — You will be scored more harshly if you repeat these

**#1 MOST REPEATED BUG (recurrence 4):** validateOrigin() returns a boolean. Use \`if (!validateOrigin(req))\` — NEVER wrap it in try/catch. See HYGIENE Rule 27.

**#2 REPEATED BUG (recurrence 4):** Components that read session data at mount time go stale when upstream saves. If your component consumes data written by another step, read fresh from \`loadSession()\` on every render or accept data via props — do NOT cache in state at mount and never update. See BUG-012.

**#3 REPEATED BUG (recurrence 3):** Composite pages (OnboardingPage, AimPage, ReadyPage) MUST call \`saveSession()\` at every substep boundary BEFORE advancing the substep index. Crash between substeps = total data loss. See HYGIENE Rule 29.

**#4 REPEATED BUG (recurrence 3):** Global components (toasts, badges, meters) must mount in \`page.tsx\` or use a portal — NEVER inside a conditional parent like HubScreen that unmounts on other screens. See HYGIENE Rule 47.

**#5 BUG-030:** Every dispatchEvent MUST have a corresponding addEventListener in the parent tree — verify BOTH sides exist (Rule 33).

**#6 BUG-037 (recurrence 2):** File picker opens twice — label + div onClick double-fire. Prevent click event bubbling from label to parent handlers with stopPropagation.

**#7 BUG-034:** Stale closure in complete() — always read fresh session from \`loadSession()\` before spreading in callbacks with async background work (Rule 37).

**#8 BUG-032/035 (recurrence 3):** mountedRef permanently false in React Strict Mode. Every ref modified in useEffect MUST be reset at top of effect body (Rule 35).

**#9 BUG-018 (recurrence 3):** No auto-save between substeps. saveSession() BEFORE advancing substep index (Rule 29).

**#10 BUG-046 (recurrence 2):** PARSE prompt without untrusted_user_data wrapping. Wrap all user-sourced data in <untrusted_user_data nonce=...> tags.

## Security Checklist (Mandatory)
Before marking complete, verify:
1. Every POST/PUT/DELETE route calls \`validateOrigin()\` before processing (if-guard, never try/catch)
2. Every route that accesses user data verifies JWT via \`verifyToken()\`
3. Error responses never expose stack traces, file paths, or API keys
4. User-generated content rendered with React built-in escaping — no \`dangerouslySetInnerHTML\`
5. All external/user data in Claude prompts wrapped in \`<untrusted_user_data nonce=...>\` tags

## Known Stubs (do NOT fail or recreate these — they are pre-existing)
- ${knownStubs}

---

## HYGIENE Rules (cumulative — violations are hard fails)

${hygieneContent}

---

## Feature Spec: PRD

--- BEGIN file: requirements/05-features/${featureDir}/PRD.md ---
${readFile(`requirements/05-features/${featureDir}/PRD.md`)}
--- END file ---

---

## Feature Spec: STORIES

--- BEGIN file: requirements/05-features/${featureDir}/STORIES.md ---
${readFile(`requirements/05-features/${featureDir}/STORIES.md`)}
--- END file ---

---

## Feature Spec: COPY

--- BEGIN file: requirements/05-features/${featureDir}/COPY.md ---
${readFile(`requirements/05-features/${featureDir}/COPY.md`)}
--- END file ---

---

## Feature Spec: INPUTS

--- BEGIN file: requirements/05-features/${featureDir}/INPUTS.md ---
${readFile(`requirements/05-features/${featureDir}/INPUTS.md`)}
--- END file ---

---

## Integration Map (data contracts)

--- BEGIN file: .claude/agents/02-oneshot/.system/integration-map.md ---
${readFile(".claude/agents/02-oneshot/.system/integration-map.md")}
--- END file ---

---

## TypeScript Interfaces (src/lib/types.ts)

--- BEGIN file: src/lib/types.ts ---
${readFile("src/lib/types.ts")}
--- END file ---

---

## Output
When done, commit all work and return a JSON envelope as your final output:

\`\`\`json
{
  "feature": "${feature}",
  "status": "built",
  "branch": "agent/${feature}",
  "commit": "<sha>",
  "filesModified": ["<list>"],
  "typecheckClean": true,
  "foundationUpdateRequests": [],
  "notes": "<any notes>"
}
\`\`\`
`;

fs.writeFileSync(outputFile, prompt, "utf8");
console.log(`Prompt written to ${outputFile} (${prompt.length} chars)`);
