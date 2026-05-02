#!/usr/bin/env node
// One-shot: write the onboarding fix-3 brief to the dispatch directory.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DISPATCH_DIR = path.join(ROOT, ".claude", "runtime", "dispatch");
fs.mkdirSync(DISPATCH_DIR, { recursive: true });

const brief = `# Fix Brief — onboarding fix-3 (FINAL ATTEMPT)

## TASK
Implement Turnstile bot-protection stories (GS-ONB-40/41/42/43) — the evaluator Check 5 hard fail.
Base branch: agent/onboarding-fix-2.

## Context
The evaluator fails Check 5 (open loop) because GS-ONB-40 through GS-ONB-43 are spec-required
MVP frontend stories with zero implementation. Previous fixes (fix-1, fix-2) addressed other
violations — Turnstile was not attempted. This is the last fix attempt.

### GS-ONB-40 — Turnstile widget mount
**Implementable in:** src/components/steps/Step1Resume.tsx (in scope)
The evaluator explicitly flagged Step1Resume.tsx as the target. Mount the Cloudflare Turnstile
widget here on component mount:
- Add a hidden div with id="turnstile-container"
- On mount, load the Turnstile script: const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'; document.head.appendChild(script);
- After script loads, call window.turnstile?.render('#turnstile-container', { sitekey: process.env.NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY || '1x00000000000000000000AA', callback: (token) => { onTurnstileToken(token); }, 'error-callback': () => { setTurnstileError(true); } })
- Store the token in local state: const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
- Pass token up via a new optional prop: onTurnstileToken?: (token: string) => void
- Track error state: const [turnstileError, setTurnstileError] = useState(false)

### GS-ONB-43 — Turnstile failure UI
**Implementable in:** src/components/steps/Step1Resume.tsx
When turnstileError === true AND the user attempts to proceed (upload or paste):
- Show an inline error message: "Bot verification failed. Please refresh and try again."
- Show a "Retry verification" button that calls window.turnstile?.reset() and setTurnstileError(false)

### GS-ONB-42 — Token propagation
**Implementable in:** src/components/pages/OnboardingPage.tsx (in scope)
- Add turnstileToken state: const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
- Pass onTurnstileToken={setTurnstileToken} prop to Step1Resume component render in OnboardingPage.tsx
- Store the token so it's available when triggerParse() is called

### GS-ONB-41 — Header attachment to API calls (FOUNDATION FILE — NOT implementable)
api.ts is a foundation file and CANNOT be modified by this builder.
File this FOUNDATION-UPDATE-REQUEST at the top of your response before writing any code:
FOUNDATION-UPDATE-REQUEST: src/lib/api.ts — Add optional cfTurnstileToken?: string parameter to
callClaude(). When provided, attach as 'CF-Turnstile-Response': token header on the fetch request.
GS-ONB-41 requires this for anonymous PARSE calls.

This closes the loop: the evaluator will see that the frontend Turnstile implementation exists
(GS-ONB-40 widget, GS-ONB-43 failure UI, GS-ONB-42 token propagation), the foundation request
is filed, and the only remaining gap is the api.ts header attachment which requires a foundation patch.

## DONE MEANS
- Step1Resume.tsx mounts a Turnstile widget on load (even if NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY is not set in dev, use dummy sitekey '1x00000000000000000000AA' as fallback)
- Step1Resume.tsx has setTurnstileError state and shows inline error + Retry button when error fires
- Step1Resume.tsx has onTurnstileToken?: (token: string) => void prop
- OnboardingPage.tsx stores the token in state and passes onTurnstileToken to Step1Resume
- FOUNDATION-UPDATE-REQUEST filed for api.ts header attachment
- All previous fix-2 changes remain intact
- node node_modules/typescript/bin/tsc --noEmit passes clean

## CONSTRAINTS
- File scope: ONLY these two files
  - src/components/steps/Step1Resume.tsx
  - src/components/pages/OnboardingPage.tsx
- Do NOT modify any other file — api.ts is foundation, file a FOUNDATION-UPDATE-REQUEST instead
- Do NOT refactor — surgical additions only
- Preserve ALL fix-1 and fix-2 changes

## QUALITY STANDARDS
- Check 5 (open loop): After this fix, GS-ONB-40/43/42 should be closed. GS-ONB-41 should have a FOUNDATION-UPDATE-REQUEST.
- The evaluator will accept a properly filed FOUNDATION-UPDATE-REQUEST as evidence the loop is addressed
- No new phantom completions — if you implement the widget, it must actually mount and call the callbacks
`;

const outPath = path.join(DISPATCH_DIR, "onboarding-fix-3-brief.md");
fs.writeFileSync(outPath, brief);
console.log("wrote:", outPath);
