#!/usr/bin/env node
// One-shot: write the onboarding fix-1 brief to the dispatch directory.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DISPATCH_DIR = path.join(ROOT, ".claude", "runtime", "dispatch");
fs.mkdirSync(DISPATCH_DIR, { recursive: true });

const brief = `# Fix Brief — onboarding fix-1

## TASK
Fix 3 evaluator violations + 1 QA finding in the onboarding feature.

### Violation 1 — softSkills chips missing (EVALUATOR HARD FAIL)
**File:** src/components/steps/Step4Profile.tsx
**Issue:** Profile.softSkills: string[] (types.ts:132) is never rendered as deselectable chips.
INPUTS.md Profile Review Section 3 explicitly lists "Soft skills (Secondary/muted chips)" as a user-curated
deselectable field. The builder renders hardSkills and domains chips but omits softSkills entirely.
HYGIENE Rule 48: cross-reference INPUTS.md fields against TypeScript interface.
**Fix:** Add a softSkills chip section alongside the existing hardSkills section. Use the same deselectable
chip pattern (secondary/muted styling). Chips should read from localProfile.softSkills and toggle membership
on click, saving back through the same profile state path as hardSkills.

### Violation 2 — Raw <button> in tab switcher (EVALUATOR HARD FAIL)
**File:** src/components/steps/Step1Resume.tsx lines 376, 396
**Issue:** Raw <button> elements used for the file/paste tab switcher instead of <Btn> from src/components/ui/.
Design rule: no raw <button>, <input>, or <select> elements. TabBar component is available at src/components/ui/TabBar.tsx.
**Fix:** Replace the two raw <button> elements in the tab switcher with <TabBar> or <Btn> from the UI library.
Preserve the existing tab-switch behavior (state toggle between 'file' and 'paste' modes).

### Violation 3 — Hardcoded hex color (EVALUATOR HARD FAIL)
**File:** src/components/steps/Step3Preferences.tsx line 149
**Issue:** color: '#fff' hardcoded in CardToggle indicator style object. Design rule: all color values must use
CSS custom properties var(--token); no hardcoded hex values.
**Fix:** Replace '#fff' with var(--text-inverse) or var(--bg-base) — whichever CSS variable correctly
represents white/inverted text. Check src/app/globals.css for the correct token name.

### QA-003 — Uncancelled reload timer (QA LOW — include if easy)
**File:** src/components/pages/OnboardingPage.tsx line 383
**Issue:** setTimeout for window.location.reload() not stored in a ref; unmount cleanup does not cancel it.
**Fix:** Store timer in a ref (const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)),
assign it, and clear in unmount cleanup.

## DONE MEANS
- Step4Profile.tsx renders softSkills as deselectable chips (same pattern as hardSkills/domains)
- Step1Resume.tsx tab switcher uses <TabBar> or <Btn> — zero raw <button> elements in scope files
- Step3Preferences.tsx:149 uses var(--token) CSS custom property, not hardcoded '#fff'
- OnboardingPage.tsx reload timer stored in ref and cleared on unmount
- node node_modules/typescript/bin/tsc --noEmit passes clean
- No regressions to other onboarding functionality

## CONSTRAINTS
- File scope: ONLY these files
  - src/components/steps/Step4Profile.tsx
  - src/components/steps/Step1Resume.tsx
  - src/components/steps/Step3Preferences.tsx
  - src/components/pages/OnboardingPage.tsx
- Do NOT touch any other files
- Do NOT refactor or restructure — surgical fixes only

## IF STUCK
After 3 failed attempts: revert and report

## QUALITY STANDARDS
- Evaluator checks 5 things: structural, grounding, coverage, negative, open-loop
- Violations 1-3 are the specific failures — fix all 3 or the re-review will fail
- QA-003 is a bonus — include if straightforward, skip if it risks breaking other things
`;

const outPath = path.join(DISPATCH_DIR, "onboarding-fix-1-brief.md");
fs.writeFileSync(outPath, brief);
console.log("wrote:", outPath);
