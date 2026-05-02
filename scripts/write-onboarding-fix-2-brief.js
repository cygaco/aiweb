#!/usr/bin/env node
// One-shot: write the onboarding fix-2 brief to the dispatch directory.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DISPATCH_DIR = path.join(ROOT, ".claude", "runtime", "dispatch");
fs.mkdirSync(DISPATCH_DIR, { recursive: true });

const brief = `# Fix Brief — onboarding fix-2

## TASK
Fix 3 issues in Step4Profile.tsx (all in scope). Base branch: agent/onboarding-fix-1.

### Issue 1 — Full-page spinner blocks Personal/Education review (EVALUATOR HARD FAIL)
**File:** src/components/steps/Step4Profile.tsx lines 708-762
**Issue:** When genStatus === 'generating', the component returns a full-page spinner that hides
the entire form. Holdout fixture antiPattern: "Idle spinner while profile generates (user should
be reviewing parsed data)". structuralRule: "Personal/Education give user something to review
while profile generates below."
**Fix:** Remove the full-page spinner early return at lines 708-762. Instead, render the
Personal and Education sections always (so the user can review/edit parsed data), and show an
inline progress indicator ONLY in the "Who you are" section (the section that needs generated data).
The "Who you are" section should show a loading state inline (spinner + progress text like
"Generating your profile...") while genStatus === 'generating', but the rest of the form stays
visible and interactive.

### Issue 2 — GS-ONB-38 phantom completion (EVALUATOR HARD FAIL)
**File:** src/components/steps/Step4Profile.tsx line 968
**Issue:** Comment '{/* GS-ONB-38: show error box in profile section if gen failed after partial use */}'
exists with zero implementation after it. The actual GS-ONB-38 error handling is a full-page
takeover (lines 759-810) not an inline error in the "Who you are" section. Per spec: if profile
generation fails AFTER the user has started using partial data, show an inline error box in the
"Who you are" section with a Retry button and "Use partial data" option — NOT a full-page takeover.
**Fix:** In the "Who you are" section, when genStatus === 'error' AND there is some partial
generated data already (fallback: domains/hardSkills/softSkills arrays are non-empty), show an
inline error box with:
- Error message: "Profile generation failed"
- "Retry" button that calls triggerGeneration()
- "Continue with what we have" button that sets genStatus to 'done' using available partial data
If genStatus === 'error' AND no partial data exists, the full-page error takeover is acceptable.
This distinction is what GS-ONB-38 requires.

### Issue 3 — Missing untrusted_user_data wrapper (REDTEAM HIGH)
**File:** src/components/steps/Step4Profile.tsx — triggerGeneration() function
**Issue:** triggerGeneration() builds profileInput as JSON.stringify of resumeStructured + personal
info, then passes it to callClaude() WITHOUT wrapping in <untrusted_user_data nonce=...> tags.
OnboardingPage.tsx correctly applies this wrapper in triggerProfileGen(). Resume text with crafted
prompt injection payloads can manipulate the PROFILE model output.
**Fix:** In triggerGeneration(), before calling callClaude(), wrap the payload:
  const nonce = crypto.randomUUID();
  const wrappedInput = '<untrusted_user_data nonce="' + nonce + '">' + JSON.stringify(payload) + '</untrusted_user_data>';
Then pass wrappedInput to callClaude() instead of the raw JSON string. Mirror exactly what
OnboardingPage.tsx triggerProfileGen() does.

## DONE MEANS
- Step4Profile.tsx no longer early-returns a full-page spinner during genStatus==='generating'
- Personal and Education sections render and are interactive while "Who you are" section shows inline loading
- "Who you are" section shows inline error with Retry + "Continue with partial" when genStatus==='error' AND partial data exists
- triggerGeneration() wraps profileInput in <untrusted_user_data nonce=...> tags before callClaude()
- node node_modules/typescript/bin/tsc --noEmit passes clean
- Existing fix-1 changes remain intact (softSkills chips, TabBar, CSS token, reload timer ref)

## CONSTRAINTS
- File scope: ONLY src/components/steps/Step4Profile.tsx
- Do NOT modify any other file
- Do NOT refactor — surgical changes only
- Preserve all fix-1 changes (softSkills chip rendering must remain)
- This is fix attempt 2 of 3 — do not burn the last attempt

## IF STUCK
After exhausting approaches: revert and report with specifics

## QUALITY STANDARDS
- Evaluator will re-check structural, grounding, coverage, negative, open-loop
- Check 5 (open-loop): NO phantom completion comments — if GS-ONB-38 comment is there, implement it or remove the comment
- Redteam will re-check security: untrusted_user_data wrapper must be present
`;

const outPath = path.join(DISPATCH_DIR, "onboarding-fix-2-brief.md");
fs.writeFileSync(outPath, brief);
console.log("wrote:", outPath);
