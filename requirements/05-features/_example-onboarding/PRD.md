# PRD: Onboarding

> **Agent Instructions**
>
> 1. Read this entire PRD before writing any code — Section 8 (Feature Description) is your primary implementation guide
> 2. The acceptance criteria in linked stories are your contract — if it's not specified, don't build it
> 3. Check Section 9 (Dependencies) — if a dependency isn't built yet, stop and report
> 4. Your output will be evaluated against criteria you cannot see — build to the spec, not to assumed tests
> 5. If something in this PRD is ambiguous or contradictory, escalate — do not guess

## 1. Title + Classification

**Onboarding (Setup Wizard)** — MVP

## 2. Screen

<!-- Which step/screen/phase does this feature live on? Include component filenames matching the project GLOSSARY. -->

Onboarding, Steps 1–3. Composite component: `OnboardingPage.tsx`. The entire onboarding flow is self-contained.

## 3. Context

Onboarding is the foundation of the entire product. Every downstream feature depends on the data collected here. A user who abandons onboarding produces zero value. The flow must feel fast, low-friction, and progressively rewarding.

## 4. JTBD (Jobs To Be Done)

> When I start using this product for the first time, I want to quickly provide my information and set my preferences, so I can get personalized results without extensive manual setup.

> When I see my generated profile, I want to verify it understood me correctly, so I can trust the system going forward.

## 5. Emotional Framing

- **Entry**: Hopeful but skeptical — "Will this actually work for me?" The user needs to feel this is different within 60 seconds.
- **During**: Progressive confidence — each completed step builds trust. The system should feel smart ("it got everything right").
- **Exit**: Energized and ready — "Everything is set up. Let's go."

## 6. Goals

- User completes full onboarding in under 5 minutes
- Zero data loss — every field the user fills is persisted
- Generated profile is accurate on first attempt for 90%+ of users
- Preferences capture enough signal to drive downstream features

## 7. Assumptions

- Users have relevant input data available (file, text, or manual entry)
- Standard file formats are supported (PDF, DOCX, TXT)
- AI parsing succeeds on well-formatted input
- Users will correct parsing errors if prompted

## 8. Feature Description

<!-- Write this as if building from scratch. No "before/after" language. This is the complete target state. -->

### Step 1: Data Import

The user provides their input data via file upload or text paste. Accepted formats: PDF, DOCX, TXT, MD. Max file size: 10MB. The system parses the input using AI and extracts structured data.

**Parsing flow:**
1. User uploads file or pastes text
2. System sends raw text to AI for structured extraction
3. AI returns typed data object
4. System displays parsed preview for user review
5. User confirms or edits the extracted data

**Error handling:** If parsing fails, show a clear error with the option to retry or paste text manually. Never show a blank screen.

### Step 2: Preferences

The user sets their preferences through a multi-section form. Each section captures a different dimension of what the user wants.

**Sections:**
- Direction (what they're looking for)
- Type (format/category preferences)
- Constraints (hard requirements)
- Quick Check (validation questions)

All preferences persist to encrypted session storage. Each section auto-saves on completion.

### Step 3: Profile Generation

The system generates a comprehensive profile from the imported data + preferences. This is the AI's understanding of the user — displayed for review and confirmation.

**Profile includes:** Core identity, domain expertise, key strengths, areas for growth, and recommended focus areas.

The user reviews the profile and can regenerate if unsatisfied (costs system resources — track usage).

## 9. Dependencies / Blockers

- Foundation types must be defined (data interfaces)
- AI integration must be functional (API calls)
- Encrypted storage must be implemented

## 10. Feature Cost

AI calls per onboarding: 2 (parse + profile generation). Track per-user usage.

## 11. Impact Metrics

- Onboarding completion rate (target: 85%+)
- Time to complete (target: < 5 min)
- Profile accuracy (user acceptance rate on first generation)

## 12. UI Reference

<!-- ASCII wireframe, screenshot link, or mockup reference -->

```
┌──────────────────────────────────────┐
│  Step 1: Import Your Data            │
│  ┌────────────────────────────┐      │
│  │  Drop file here or paste   │      │
│  │  text below                │      │
│  └────────────────────────────┘      │
│  [Upload File]  [Paste Text]         │
│                           [Next →]   │
└──────────────────────────────────────┘
```

## 13. Implementation Map

| File | Changes | Reuse |
|------|---------|-------|
| `src/components/steps/Step1Import.tsx` | New — file upload + paste UI | Use foundation UI components |
| `src/components/steps/Step2Preferences.tsx` | New — multi-section form | Use foundation form components |
| `src/components/steps/Step3Profile.tsx` | New — profile display + regenerate | Use foundation card components |
| `src/components/pages/OnboardingPage.tsx` | New — step routing + progress | Foundation layout |

## 14. Test Plan

1. Upload a valid PDF → data parsed and displayed correctly
2. Upload an invalid file type → error message with accepted formats
3. Complete all preference sections → data persists across refresh
4. Generate profile → meaningful output displayed
5. Refresh mid-onboarding → resume at current step with data intact

## 15. Out of Scope

- Account creation (separate feature)
- Payment integration
- Advanced profile editing post-onboarding

## 16. Open Questions

n/a
