#!/usr/bin/env node
// Write the market-research fix-1 brief to /tmp/mr-fix1-brief2.md
const fs = require("fs");

const brief = `# Fix Brief — market-research — Fix Attempt 1 (Continuation)

## Context
Feature: market-research
Worktree: /c/Users/Vladislav Zhirnov/Desktop/Claude/Projects/.worktrees/wt-9da358-gsfz
Branch: agent/market-research-fix-1
Files in scope (ONLY modify these):
- src/components/steps/StepCollect.tsx
- src/components/steps/Step6Analysis.tsx
- src/components/pages/AimPage.tsx
- src/app/api/jobs/route.ts
- src/lib/scraper-scripts.ts

## MANDATORY FIRST ACTION
Before any git command, run: \`pwd && git worktree list --porcelain | head\`
Your cwd MUST be inside a \`.worktrees/wt-*\` path. If it resolves to the main project root, halt immediately.

## Build Verification
Use \`node node_modules/typescript/bin/tsc --noEmit\` (NOT \`npx tsc\`). Run after every fix group.

## What Has Already Been Applied (DO NOT RE-APPLY)
The files inlined below already contain these partial fixes from a prior session:
- v3 ticket model polling (pollTicket, 30s+jitter interval, progressStage display)
- Mount recovery for in-flight ticket on tab-close
- X-Idempotency-Key header on scrape request
- 503 QUEUE_UNAVAILABLE handler
- snapshotId validation regex in poll action
- hasRun.current = false reset (BUG-035)
- Auth import added to route.ts (BUT SEE FIX-A — these are throwing stubs)
- Color changes using color-mix() (BUT SEE FIX-B — should use CSS vars instead)

---

## FIXES REQUIRED

### FIX-A: REVERT broken auth stub import in route.ts (URGENT — these throw at runtime)
**File:** src/app/api/jobs/route.ts
**Problem:** The import \`import { getAuthToken, verifyJWT } from "@/lib/auth"\` was added, and then used in the trigger action. BUT src/lib/auth.ts exports ONLY throwing SKELETON stubs:
  - \`getAuthToken\`: throws \`Error("SKELETON: getAuthToken not implemented")\`
  - \`verifyJWT\`: throws \`Error("SKELETON: verifyJWT not implemented")\`
Using these in production will throw on every request. Auth is a separate feature not yet built.
**Fix:**
1. Remove the \`import { getAuthToken, verifyJWT } from "@/lib/auth"\` import line
2. Remove the auth check block (lines with \`const authToken = await getAuthToken();\` and \`if (!authToken || !verifyJWT(authToken))\`)
3. Add a comment in the trigger action:
   \`// FOUNDATION-UPDATE-REQUEST: src/lib/auth.ts — add getAuthToken/verifyJWT implementation; /api/jobs needs JWT auth guard on trigger action\`

### FIX-1: Implement handleAddManualUrl to actually append to marketRaw (HARD FAIL)
**File:** src/components/steps/StepCollect.tsx
**Problem:** \`handleAddManualUrl()\` validates the URL but the body ends with:
  \`// Append as a placeholder entry to marketRaw — would normally scrape the URL\`
  \`// Post-MVP: actual scraping. For now, acknowledge the intent.\`
  No append happens. This is a committed open-loop placeholder — evaluator hard fail.
**Fix:** Remove both placeholder comments. Implement the append:
1. Get current session: \`const session = loadSession();\`
2. Parse existing marketRaw: \`const existing = session.marketRaw ? JSON.parse(session.marketRaw) : [];\`
3. Create a minimal job entry from the URL (use domain as title):
   \`\`\`
   const domain = new URL(trimmed).hostname.replace(/^www\\./, "");
   const manualEntry = {
     job_title: domain,
     company_name: domain,
     url: trimmed,
     manual: true,
   };
   \`\`\`
4. Append and save:
   \`\`\`
   const updated = [...existing, manualEntry];
   saveSession({ ...session, marketRaw: JSON.stringify(updated) });
   \`\`\`
5. Call onScrapeComplete if this is the first manual entry and no scrape was done yet, OR simply update session and let the parent re-read it.

### FIX-B: Replace color-mix() with CSS custom properties (evaluator expects CSS vars)
The design system has these CSS vars defined in globals.css:
  - \`--warning-light: rgba(234, 179, 8, 0.1)\`
  - \`--warning-border: rgba(234, 179, 8, 0.3)\`
  - \`--error-light: rgba(239, 68, 68, 0.1)\`
  - \`--error-border: rgba(239, 68, 68, 0.3)\`
  - \`--success: #acd229\`

**In StepCollect.tsx:** Replace all \`color-mix(in srgb, var(--warning) 8%, transparent)\` with \`var(--warning-light)\`
  and \`color-mix(in srgb, var(--warning) 30%, transparent)\` with \`var(--warning-border)\`
  and any wrong \`var(--success, #22c55e)\` fallback → \`var(--success, #acd229)\`

**In Step6Analysis.tsx:** Replace:
  - \`color-mix(in srgb, var(--error) 8%, transparent)\` → \`var(--error-light)\`
  - \`color-mix(in srgb, var(--error) 30%, transparent)\` → \`var(--error-border)\`
  - \`color-mix(in srgb, var(--warning) 8%, transparent)\` → \`var(--warning-light)\`
  - \`color-mix(in srgb, var(--warning) 30%, transparent)\` → \`var(--warning-border)\`

### FIX-5: Increment budget by queries.length (REDTEAM high)
**File:** src/app/api/jobs/route.ts, trigger action
**Problem:** \`checkAndIncrementBudget()\` is called once and increments by 1, but the trigger fires N BD snapshots (one per query). A 50-query batch costs 50× but spends only 1 budget unit.
**Fix:** Change \`checkAndIncrementBudget()\` to accept a count parameter:
  \`async function checkAndIncrementBudget(count: number = 1)\`
  Inside: change \`await redis.incr(key)\` to \`await redis.incrby(key, count)\`
  In trigger action: call \`await checkAndIncrementBudget(queryEmploymentPairs.length)\`

### FIX-6: Fix mutex silently dropping marketAnalysis phase-2 save (QA-500 / HYGIENE Rule 29)
**File:** src/components/steps/Step6Analysis.tsx
**Problem:** \`handleSessionUpdate\` has a mutex pattern (\`saveInProgress\`) that silently drops the marketAnalysis save when the mutex is held. HYGIENE Rule 29: saveSession BEFORE advancing substep index. Silent drops violate this.
**Fix:** Replace the silent-drop pattern with a queued/awaited save. If saveInProgress is true, queue the update to run when the current save completes. Do NOT drop saves. A simple approach: use a ref-based queue (\`pendingSave\`) and flush after each save completes.

### FIX-7: Step6Analysis — use loadSession() not stale prop (QA-507 / BUG-012)
**File:** src/components/steps/Step6Analysis.tsx
**Problem:** \`runAnalysis()\` reads data from the \`session\` React prop. BUG-012 requires handlers to call \`loadSession()\` for fresh data.
**Fix:** At the start of \`runAnalysis()\`, add: \`const freshSession = loadSession();\`
Use \`freshSession.marketRaw\`, \`freshSession.marketAnalysis\`, \`freshSession.profile\`, etc. instead of the \`session\` prop values throughout \`runAnalysis()\`.

---

## After Applying All Fixes
1. Run \`node node_modules/typescript/bin/tsc --noEmit\` — must be clean
2. Commit all changes to branch \`agent/market-research-fix-1\`

## Output
\`\`\`json
{
  "feature": "market-research",
  "fixAttempt": 1,
  "status": "fixed",
  "branch": "agent/market-research-fix-1",
  "commit": "<sha>",
  "fixesApplied": ["FIX-A", "FIX-1", "FIX-B", "FIX-5", "FIX-6", "FIX-7"],
  "fixesSkipped": [],
  "typecheckClean": true,
  "foundationUpdateRequests": ["src/lib/auth.ts — add getAuthToken/verifyJWT for /api/jobs trigger auth guard"],
  "notes": "..."
}
\`\`\`
`;

const outPath =
  process.argv[2] ||
  require("path").join(__dirname, "../.claude/runtime/mr-fix1-brief2.md");
fs.writeFileSync(outPath, brief, "utf8");
console.log(`Brief written: ${brief.length} chars`);
