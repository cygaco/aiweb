# Fix Brief: market-research fix-1
Feature: market-research
Worktree branch: agent/market-research-fix-1
Base: skeleton-test10 HEAD

## Priority order — fix in this sequence:

### P0 — Runtime crashes (fix first)
1. **QA-001: Hook ordering violation in StepCollect.tsx**
   - useState/useRef calls appear AFTER conditional early-return blocks
   - React will crash: "Rendered more hooks than during the previous render"
   - Move ALL hook declarations to top of component, before any conditional returns (HYGIENE Rule 32)

2. **QA-002: setScraping(false) never called on success path in launchScrape()**
   - Only the catch block resets scraping=false
   - After a successful scrape, the Launch button stays disabled=true indefinitely
   - Fix: call setScraping(false) before calling onScrapeComplete()

### P1 — Spec violations (block gate pass)
3. **EVAL: BD progress URL path wrong in /api/jobs/route.ts**
   - Current: `${BD_API_BASE}/datasets/v3/progress/${snapshotId}`
   - Correct:  `${BD_API_BASE}/datasets/v3/snapshot/${snapshotId}/progress`
   - Per BD-API-REFERENCE.md; every progress poll returns 404 currently

4. **EVAL: BD job_apply_link field not mapped in normalizeJob**
   - The BD response field `job_apply_link` is not in the URL fallback chain
   - Current chain: url, job_url, link — add `job_apply_link` to the chain
   - File: src/app/api/jobs/route.ts, normalizeJob function

5. **EVAL/QA: GS-MKT-08 polling interval 10s, spec requires 30s**
   - File: src/lib/api.ts, POLL_INTERVAL_MS constant
   - Change from 10_000 to 30_000

6. **COMP-001: GS-MKT-21 phantom completion in handleAddManualUrl**
   - The function validates the URL then does nothing (silent no-op)
   - Per GS-MKT-21 (Post-MVP): show a "Manual URL import coming soon" toast
   - OR per spec: append a minimal job stub to marketRaw with the URL
   - Either way: the current silent UX (input clears with no feedback) is a phantom completion
   - Minimum fix: after validation, show a Toast with "Manual URL import coming soon" and don't clear the input silently

### P2 — Design compliance
7. **EVAL: Hardcoded rgba colors — replace with CSS variables**
   - StepCollect.tsx lines ~445-446: rgba(234,179,8,0.08) → color-mix(in srgb, var(--warning) 8%, transparent)
   - StepCollect.tsx lines ~445-446: rgba(234,179,8,0.3) → color-mix(in srgb, var(--warning) 30%, transparent)
   - Step6Analysis.tsx lines ~453-454: rgba(239,68,68,0.08) → color-mix(in srgb, var(--error) 8%, transparent)
   - Step6Analysis.tsx lines ~453-454: rgba(239,68,68,0.3) → color-mix(in srgb, var(--error) 30%, transparent)
   - Step6Analysis.tsx lines ~572-573, ~837-838: same warning rgba values → same fix

8. **EVAL: Raw <button> and <input> elements — replace with ui components**
   - StepCollect.tsx ~line 849: raw <button> for avoid term dismiss → use Btn variant="ghost" size="sm"
   - Step6Analysis.tsx ~line 713: raw <button> for why-you-fit toggle → use Btn variant="ghost" size="sm"
   - Step6Analysis.tsx ~line 641: raw <input type="checkbox"> for category toggle → use a styled Btn with selected state or a custom checkbox using Btn

9. **COMP-005: Manual URL input visible pre-scrape**
   - INPUTS.md Control 3: "Only visible after scrape completes"
   - Wrap the manual URL input section in a condition: only render when hasScrapeResult === true

### P3 — Functional gaps
10. **COMP-004: Analysis complete CTA missing summary stats**
    - PRD §8 requires: category count, comp range, jobs analyzed on completion card
    - StepCollect currently only shows job count
    - Add: category count (from rankedCategories.length) and comp range if available

11. **QA-003: Save mutex silently drops concurrent saves**
    - AimPage handleSessionUpdate: if saveInProgress.current is true, update is dropped
    - Fix: queue the update instead of dropping (use a pending ref that gets flushed after current save completes)
    - Or simpler: after the save completes, check if a new update arrived and run it

12. **QA-006: fetchJobs polling loop has no AbortSignal**
    - The while(true) poll in api.ts continues if component unmounts
    - Pass an AbortSignal from StepCollect's useEffect cleanup into fetchJobs
    - Inside the loop, check signal.aborted before each iteration

13. **QA-007: Step6Analysis reads session from stale prop instead of loadSession**
    - runAnalysis reads session.marketRaw etc. from closed-over prop
    - Per BUG-012 pattern: call loadSession() at start of runAnalysis for fresh data

14. **COMP-006: No avoid-term add UI**
    - INPUTS.md Control 2 requires: text input + Add button to append new avoid terms
    - Only removal is implemented; add an Inp + Btn pair to add new avoid terms

### P4 — Async ticket model (GS-MKT-29-39)
This is the largest missing block. The v3 async ticket architecture requires:

- **src/lib/types.ts**: Add `activeTicketId?: string | null` to SessionData
- **src/lib/api.ts**: Rewrite fetchJobs to use ticket model:
  - POST /api/jobs/scrape returns { ticketId }
  - Store ticketId in session (activeTicketId)
  - Poll GET /api/jobs/poll?ticketId={id} every 30s
  - On QUEUE_UNAVAILABLE (503): surface to UI
  - On tab-close recovery: if activeTicketId exists in session on mount, resume polling
- **src/app/api/jobs/route.ts**: Add separate action branches for "scrape" (trigger → return ticketId) and "poll" (poll by ticketId)
- **src/components/steps/StepCollect.tsx**:
  - On mount: if session.activeTicketId exists, resume polling (tab-close recovery)
  - On QUEUE_UNAVAILABLE: show "Market scraping temporarily unavailable — please try again in a minute" + disable Launch for 30s
  - Map progressStage from ticket response to human-readable phases

**Note for fixer**: If the ticket model is too large to implement cleanly in one pass, implement GS-MKT-29-33 (basic ticket flow + tab-close recovery) and defer GS-MKT-34-39 (idempotency, FOMO warning) to fix-2.

## Scope guard
Only modify:
- src/lib/types.ts (SessionData.activeTicketId only)
- src/lib/api.ts (fetchJobs function only)
- src/app/api/jobs/route.ts
- src/components/steps/StepCollect.tsx
- src/components/steps/Step6Analysis.tsx
- src/components/pages/AimPage.tsx
- src/lib/scraper-scripts.ts

Do NOT modify any other files.

## Typecheck requirement
npx tsc --noEmit must pass with zero errors before reporting complete.
