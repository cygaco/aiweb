# [Project Name] — Canonical Product Model

This document defines the structural primitives, Jobs to Be Done, and invariant truths of the product.

---

## Product Primitives

These are the fundamental building blocks of the product. Every feature is composed of these primitives.

<!-- GUIDANCE: List 3-7 core concepts. For each primitive, describe:
- What it is (one paragraph)
- How it works (the flow or mechanics)
- Structural truths (invariants that must never be violated)

Example primitives:
- The Wizard (multi-step linear flow)
- The Pipeline (data processing chain)
- The Credit Economy (resource gating system)
- The Scoring System (progress/quality tracking)
- The Output System (what the product generates)
-->

### 1. [Primitive Name]

<!-- Description of the primitive -->

**Structural truths:**

- <!-- Rules that must never be broken -->
- <!-- E.g., "Steps are strictly ordered. You cannot skip ahead." -->
- <!-- E.g., "Data is always real, never synthetic." -->
- <!-- E.g., "User reviews and approves everything before it ships." -->

### 2. [Primitive Name]

<!-- Repeat for each primitive -->

---

## Jobs to Be Done

### Primary JTBD

> **When** [situation], **I want to** [motivation], **so that** [outcome].

### Supporting JTBDs

<!-- GUIDANCE: List all supporting JTBDs. Each should map to specific steps/features. Use a table:

| JTBD | Steps/Features Involved |
|------|------------------------|
| "I want to [action]" | Step 1-2 (Feature Name) |
-->

---

## The Step/Screen Model

<!-- GUIDANCE: If your product has a multi-step flow, document every step:

| Step | Phase | Name | Input | Output | Cost |
|------|-------|------|-------|--------|------|
| 1 | Setup | [Name] | [What user provides] | [What system produces] | Free |
| 2 | Setup | [Name] | [Previous output + user input] | [Output] | Free |

If your product isn't step-based, replace this with a screen/page model or feature map.
-->

---

## Data Dependency Chain

<!-- GUIDANCE: Show how data flows through the product. Use an ASCII diagram:

```
Input (Step 1) → Processed Data (Step 2) → Analysis (Step 3)
                                                ↓
                                          Output A (Step 4)
                                                ↓
                                          Output B (Step 5)
```

This is the "if step 1 changes, what breaks?" map.
-->

---

## Invalidation Rules

<!-- GUIDANCE: When a user edits an earlier step, what downstream data becomes stale? Document the cascade:

| If You Edit... | First Thing Cleared | Through... |
|----------------|--------------------|----|
| Step 1 | Step 2 output | Everything |
| Step 3 | Step 4 output | Step 7 |

Include dirty tracking rules: if user re-completes a step with no actual changes, invalidation should be skipped.
-->

---

## Phase System (if applicable)

<!-- GUIDANCE: If your product has distinct phases or modes:

### Phase Transitions
- When does the user move from one phase to the next?
- Are transitions automatic or user-triggered?
- Are there gates (auth required, data required)?

### Phase UI Behavior
- How is the current phase displayed?
- What navigation is available in each phase?
- Responsive behavior (desktop vs mobile)?
-->

---

## Structural Invariants

These truths must hold in any implementation:

<!-- GUIDANCE: List 5-15 rules that can NEVER be violated. These are the non-negotiable constraints that define the product's integrity. Examples:

1. **The flow is strictly linear.** No step can be entered without completing all prior steps.
2. **Data is real.** No synthetic or placeholder data in production.
3. **User controls decisions.** Automation never removes the user from the loop.
4. **No fabrication.** AI-generated content never invents false information.
5. **Encryption at rest.** All user data encrypted in storage.
6. **API keys are server-side only.** Secrets never reach the client.
7. **External data is untrusted.** Third-party content is sanitized.
8. **Backward navigation triggers invalidation.** Changed inputs clear stale downstream outputs.
9. **Free tier delivers real value.** Users can accomplish the core job without paying.
-->
