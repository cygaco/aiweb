# [Project Name] — Golden Paths

Critical user journeys end-to-end. These are the paths that MUST work flawlessly. If any golden path breaks, the product is broken.

---

## Golden Path 1: [Primary Journey Name]

**The primary journey.** The core use case from start to finish.

### Flow

<!-- GUIDANCE: Show the complete journey as a linear flow:
```
Step 1 → Step 2 → Step 3 → ... → Final Output
```
-->

### Emotional Arc

<!-- GUIDANCE: Document how the user should FEEL at each step. This guides UX decisions (loading states, celebrations, transitions).

| Phase | Step | Emotion | What Happens |
|-------|------|---------|-------------|
| Setup | 1 | Trust | "It understood my input" |
| Setup | 2 | Control | "I'm setting my terms" |
| Setup | 3 | Validation | "It gets me" |
| — | Celebration | Commitment | Confetti, progress shown |
| Analysis | 4 | Anticipation | "Let's see what's possible" |
| Analysis | 5 | Discovery | "I didn't know about this" |
| Creation | 6 | Tangible output | "I have real, usable results" |
| Action | 7 | Momentum | "Everything is ready. Let's go." |
-->

### Critical Details

<!-- GUIDANCE: For complex steps, document the detailed sub-flow. This is especially important for steps that took significant iteration to get right.

```
STEP N SCREEN
├── Sub-element A
├── Sub-element B
└── [Action Button]
        │
        ▼
PROCESSING (same screen or new screen)
├── Phase 1: "Processing..."
├── Phase 2: "Analyzing..."
└── "Complete" → [Next Action CTA]
```

Mark any flows that are locked: "This flow took weeks to get right. Do NOT restructure without approval."
-->

### Failure Points

<!-- GUIDANCE: For each step, what can go wrong and what's the recovery?

| Step | Failure | Impact | Recovery |
|------|---------|--------|----------|
| 1 | File upload fails | Can't proceed | Retry upload, offer paste fallback |
| 4 | API timeout | No analysis | Retry with backoff, show partial results |
-->

### Test Checklist

- [ ] Can complete the entire path from Step 1 to final output without errors
- [ ] Each step loads in under 3 seconds
- [ ] Refreshing at any step resumes correctly
- [ ] Error at any step shows recovery options, doesn't dead-end
- [ ] Final output is usable (downloadable, shareable, actionable)

---

## Golden Path 2: [Secondary Journey Name]

<!-- GUIDANCE: Repeat the full structure for each critical journey. Most products have 2-5 golden paths. Common secondary paths:

- Returning user (resume where they left off)
- Free tier user (complete core value without paying)
- Error recovery (something fails, user gets back on track)
- Power user (skips optional steps, generates maximum output)
-->

---

## Golden Path 3: [Returning User]

<!-- GUIDANCE: The "come back later" path. User left mid-flow and returns.

### Flow
```
Open app → Detect saved state → Resume at last step → Continue to completion
```

### Critical Requirements
- Session data persists across browser close/refresh
- User sees exactly where they left off
- No data loss between sessions
- Stale data (if too old) is handled gracefully
-->

---

## Path Priority

When resources are limited, fix golden path issues in this order:

1. **Path 1** — Primary journey must always work
2. **Path 3** — Returning users must not lose data
3. **Path 2** — Secondary journeys

If a bug affects a golden path, it's a P0 regardless of how many users are affected.

---

## Anti-Patterns

These are NOT golden paths and should NOT receive golden-path-level protection:

<!-- GUIDANCE: List edge cases, power user tricks, or unusual flows that are acceptable to degrade:
- Using the product on an unsupported browser
- Uploading adversarial/malformed input
- Skipping steps by manipulating URLs
- Using the product in ways it wasn't designed for
-->
