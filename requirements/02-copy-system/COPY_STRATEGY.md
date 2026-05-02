# [Project Name] — Copy Strategy

The voice, tone, and rules for every word in the product. Consistent copy builds trust. Inconsistent copy feels like multiple products stitched together.

---

## Voice

<!-- GUIDANCE: Define your product's personality in 3-5 adjectives. Then explain what each means in practice.

Example:
- **Confident** — States facts, doesn't hedge. "Your profile is ready" not "Your profile should be ready."
- **Warm** — Acknowledges the user's effort. "Great choice" not just "Saved."
- **Direct** — Gets to the point. No filler words, no corporate speak.
- **Slightly playful** — Moments of personality without being unprofessional. Celebration copy can be fun.
-->

---

## Tone Adaptation

The voice stays the same. The tone adapts to context.

| Context | Tone | Example |
|---------|------|---------|
| Onboarding | Encouraging, low-friction | "Let's get started — this takes about 5 minutes" |
| Success | Celebratory, validating | "Your profile is ready. Looking sharp." |
| Error | Calm, solution-focused | "That didn't work. Here's what to try." |
| Empty state | Inviting, actionable | "Nothing here yet. [Create your first X]" |
| Loading | Informative, reassuring | "Analyzing your data... this usually takes 10 seconds" |
| Confirmation | Clear, consequential | "This will delete all your data. This cannot be undone." |
| Achievement | Warm, earned | "Milestone reached. You're ahead of most users." |

---

## Grammar & Mechanics

### Capitalization

- **Sentence case** for all UI text (headings, buttons, labels, toasts)
- **Title Case** only for proper nouns and product names
- Never ALL CAPS except for acronyms (API, URL)

### Punctuation

- **No periods** on buttons, labels, headings, toasts, or single-sentence descriptions
- **Periods** on multi-sentence descriptions and body text
- **Oxford comma** — always ("resume, cover letter, and LinkedIn profile")
- **Em dash (—)** for breaks in thought. No en dash for this purpose.
- **Straight quotes** in code. Curly quotes in prose (if your renderer supports it).

### Contractions

- **Use contractions** in user-facing copy ("you'll", "it's", "don't")
- **Don't use contractions** in error messages or legal text

### Numbers

- Spell out one through nine. Use digits for 10+.
- Always use digits for: percentages (5%), time (3 seconds), counts in UI (2 items), money ($5.00)
- Use commas in thousands (1,000 not 1000)

### Date & Time

- Relative when recent: "2 minutes ago", "Yesterday"
- Absolute when older: "March 15, 2026"
- 12-hour format with am/pm: "2:30 pm" (no caps, no periods)

---

## Button Copy

### Rules

1. **Verb-first.** "Save changes" not "Changes saved" (that's a confirmation, not a button)
2. **Specific over generic.** "Generate resume" not "Submit" or "Go"
3. **Match the outcome.** The button text = what happens when you click it
4. **One action per button.** Never "Save and Continue" if they're separate operations

### Common Patterns

| Action | Button Text | NOT |
|--------|------------|-----|
| Advance to next step | "Continue" or "[Specific action] →" | "Next" (too vague) |
| Save data | "Save [thing]" | "Submit" (too formal) |
| Generate output | "Generate [output]" | "Go" or "Run" |
| Cancel/dismiss | "Cancel" or "Never mind" | "Close" (for modals, use X) |
| Destructive action | "Delete [thing]" | "Remove" (too soft for permanent) |
| Retry | "Try again" | "Retry" (too technical) |
| Final CTA | "[Outcome verb]" — "Launch", "Download", "Apply" | "Finish" (anticlimactic) |

---

## Error Copy

### Structure

Every error message: **What happened** + **Why** (if helpful) + **What to do next**.

### Patterns

| Error Type | Pattern | Example |
|------------|---------|---------|
| Validation | "[Field] needs to be [requirement]" | "Job title needs to be at least 2 characters" |
| File error | "We couldn't [action] that file. [Alternative]" | "We couldn't read that file. Try a PDF or paste your text" |
| API failure | "[Action] didn't work. [Recovery]" | "Profile generation didn't work. [Try again]" |
| Timeout | "[Action] is taking longer than usual. [Options]" | "Analysis is taking longer than usual. [Keep waiting] or [Cancel]" |
| Permission | "You need to [requirement] before [action]" | "You need to log in before downloading" |

### Anti-Patterns

- Technical jargon: "Error 500" → "Something went wrong on our end"
- Blame: "You entered invalid data" → "That doesn't look right"
- Dead ends: "An error occurred." → "An error occurred. [Try again]"
- Passive voice: "An error was encountered" → "We hit a snag"

---

## Empty State Copy

### Structure

**Headline** (what's missing) + **Body** (why it matters or what to expect) + **CTA** (how to fill it)

### Examples

| Screen | Headline | Body | CTA |
|--------|----------|------|-----|
| No results | "No results yet" | "Complete [step] to see your [output] here" | "[Do the step]" |
| Empty list | "Nothing here yet" | "Your [items] will appear here once created" | "[Create first item]" |
| No data | "Ready when you are" | "[Feature] needs [input] to work" | "[Provide input]" |

---

## Loading Copy

### Rules

1. **Be specific.** "Analyzing your resume..." not "Loading..."
2. **Show progress.** "Step 2 of 4: Extracting keywords..." not just a spinner
3. **Set expectations.** "This usually takes about 10 seconds" for known durations
4. **Acknowledge long waits.** After 15 seconds: "Still working... this one's taking a bit longer"

### Phased Loading

For multi-step operations, show distinct phases:

```
"Preparing your data..."        (0-2s)
"Analyzing patterns..."         (2-5s)
"Building your profile..."      (5-8s)
"Almost there..."               (8-10s)
"Done!"                         (complete)
```

---

## Celebration Copy

### When to Celebrate

- Phase completion (onboarding done, analysis complete)
- Milestone achievement (first output generated, all steps complete)
- Score threshold crossed (if applicable)

### Tone

- Brief and warm, never over-the-top
- Acknowledge the achievement without being patronizing
- Match intensity to significance

### Examples

| Milestone | Copy |
|-----------|------|
| First step completed | "Off to a great start" |
| Phase completed | "Phase complete. You're building momentum" |
| Major output generated | "Your [output] is ready. Looking sharp" |
| All steps complete | "Everything's ready. Time to take action" |

---

## Tooltip & Help Copy

### Rules

1. **One sentence max.** If it needs more, it should be a help article or inline explanation
2. **Answer "what is this?" or "why should I care?"** — not "how does this work?"
3. **No marketing language.** Help text is functional, not promotional

---

## Microcopy Surfaces

Every feature needs a companion `COPY.md` file documenting all user-facing strings:

- **Headings and subheadings** for each screen/step
- **Button labels** for all actions
- **Loading states** for all async operations
- **Error messages** for all failure modes
- **Empty states** for all data-dependent views
- **Tooltips** for all non-obvious elements
- **Confirmation dialogs** for all destructive actions

See `requirements/03-requirement-standards/` for the COPY.md template.

---

## Review Checklist

Copy passes review if:

1. [ ] Voice is consistent (confident, warm, direct — per your voice definition)
2. [ ] Tone matches context (encouraging in onboarding, calm in errors)
3. [ ] Sentence case everywhere (no random Title Case)
4. [ ] Buttons are verb-first and specific
5. [ ] Errors have what happened + what to do next
6. [ ] Loading states are specific, not generic "Loading..."
7. [ ] Empty states have headline + body + CTA
8. [ ] No technical jargon in user-facing copy
9. [ ] No blame language in errors
10. [ ] Contractions used consistently (or consistently not used)
