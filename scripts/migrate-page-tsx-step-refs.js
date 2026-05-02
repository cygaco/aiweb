#!/usr/bin/env node
// Replace src/app/page.tsx integer step comparisons with STEP_TO_INT[Step.X]
// lookups so step-registry-guard goes fully strict (drop the
// KNOWN_VIOLATIONS_FILES entry).
//
// One-shot migration; safe to delete after src/app/page.tsx is removed
// from KNOWN_VIOLATIONS_FILES.

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "src", "app", "page.tsx");
const orig = fs.readFileSync(FILE, "utf8");

const replacements = [
  {
    from: `import { validateFile, extractText } from "@/lib/upload";\nimport type { SessionData } from "@/lib/types";`,
    to: `import { validateFile, extractText } from "@/lib/upload";\nimport { Step, STEP_TO_INT } from "@/lib/types";\nimport type { SessionData } from "@/lib/types";`,
  },
  {
    from: `      // Steps 1-3: OnboardingPage handles these
      if (currentStep <= 3) {
        return <OnboardingPage />;
      }
      // Steps 4-5: AimPage (search + analysis) — recon flow locked
      if (currentStep <= 5) {
        return <AimPage />;
      }
      // Step 6: ReadyPage (deep-dive Q&A)
      if (currentStep === 6) {`,
    to: `      // Steps 1-3 (UPLOAD..PROFILE): OnboardingPage handles these
      if (currentStep <= STEP_TO_INT[Step.PROFILE]) {
        return <OnboardingPage />;
      }
      // Steps 4-5 (SEARCH..MARKET_ANALYSIS): AimPage — recon flow locked
      if (currentStep <= STEP_TO_INT[Step.MARKET_ANALYSIS]) {
        return <AimPage />;
      }
      // Step 6 (DEEP_DIVE): ReadyPage (deep-dive Q&A)
      if (currentStep === STEP_TO_INT[Step.DEEP_DIVE]) {`,
  },
  {
    from: `                onClick={() => currentStep > 1 && go(currentStep - 1)}
                disabled={currentStep <= 1}
                style={{
                  color:
                    currentStep > 1 ? "var(--text-muted)" : "var(--border)",`,
    to: `                onClick={() =>
                  currentStep > STEP_TO_INT[Step.UPLOAD] &&
                  go(currentStep - 1)
                }
                disabled={currentStep <= STEP_TO_INT[Step.UPLOAD]}
                style={{
                  color:
                    currentStep > STEP_TO_INT[Step.UPLOAD]
                      ? "var(--text-muted)"
                      : "var(--border)",`,
  },
];

let body = orig;
for (const r of replacements) {
  if (!body.includes(r.from)) {
    console.error("MISSING anchor:", r.from.slice(0, 80));
    process.exit(1);
  }
  body = body.replace(r.from, r.to);
}

fs.writeFileSync(FILE, body, "utf8");
console.log("page.tsx migrated; lines now:", body.split("\n").length);
