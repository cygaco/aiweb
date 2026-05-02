# High-Level Story Standards

## Purpose

This document defines the mandatory rules for writing and reviewing **High-Level User Stories**.

High-Level Stories establish **product intent, scope, and outcomes**. They describe _what success means_ without prescribing UI, interaction patterns, sequencing, or implementation details.

High-Level Stories are the **source of truth for product scope**. They must remain stable even as execution details evolve.

---

## Definition: High-Level Story

A High-Level Story describes **one clear user or system outcome**.

A High-Level Story answers:

- Who is this for?
- What outcome is achieved?
- Why does this outcome matter?

It does **not** describe:

- UI layouts or navigation
- User flows or step-by-step interactions
- Conditional logic or branching behavior
- Error handling or recovery logic
- Technical or data-level behavior
- Platform or delivery mechanism (browser, extension, mobile app)

Those belong in Granular Stories or in the PRD Feature Description.

---

## Platform & Implementation Neutrality

High-Level Stories must be **platform-agnostic**. They describe outcomes, not delivery mechanisms.

### Why

Stories feed into one-shot code generation alongside PRD Feature Descriptions. The Feature Description specifies platform details. If stories also name platforms, they couple intent to a specific implementation — breaking portability and making full-codebase regeneration brittle.

### Rules

- Name the **outcome**, not the **vehicle**
- If a story only makes sense on one platform, that's a sign it might be a Granular Story instead

### Disallowed Terms in HL Stories

| Instead of | Write |
|------------|-------|
| Chrome extension / mobile app | automation agent / the app |
| browser | app / page |
| click / tap | (omit — describe the outcome, not the gesture) |
| button / dropdown / modal / tab | (omit — UI elements belong in Granular Stories) |
| spinner / loading bar | (omit — describe perceived wait, not the widget) |
| API / endpoint / JSON / Redis | (omit — technical detail belongs in PRD or Granular Stories) |

### Exception

Feature PRDs whose entire scope IS a platform keep platform language in their **Feature Description** and **Granular Stories**. Their HL stories still describe the user outcome generically.

---

## Required Story Format

Every High-Level Story **must** follow this format:

> **As a [role], I want [one clear outcome], so that [user or business benefit].**

### Rules

- Exactly **one outcome** per story
- No compound goals ("and", "or", "as well as")
- Outcome must be conceptual, not behavioral
- If multiple outcomes are present, the story must be split

High-Level Stories define **intent**, not execution.

---

## Role Normalization

High-Level Stories must use **normalized, generic roles** only.

### Allowed Roles

- User
- System
- Product Manager
- Admin (if applicable)

### Disallowed

- UI- or surface-specific roles (e.g., "resume uploader", "dashboard viewer")
- Persona-style roles encoding context or motivation
- Roles that imply implementation detail

If a story applies broadly, **default to "User"**.

If a story defines policy, enforcement, or system guarantees, use **System** or **Product Manager** as appropriate.

---

## Outcome Discipline (Non-Negotiable)

A High-Level Story must describe **one outcome and only one outcome**.

A story must be split if it:

- Describes multiple user decisions
- Bundles optional or alternative results
- Mixes success and recovery outcomes
- Combines user intent with system enforcement

If the outcome can be decomposed meaningfully, it should be.

---

## Acceptance Criteria (High-Level)

### Purpose

High-Level Acceptance Criteria define **outcome guarantees and constraints**. They clarify what must be true if the story is considered successful.

They do **not** describe how the outcome is achieved.

### Guidelines

Acceptance Criteria should be:

- **Minimal**
- **Outcome-focused**
- **Unambiguous**

There is **no fixed required count**. Most stories will have **2–5 Acceptance Criteria**.

### Allowed

- "The user can achieve the outcome without dead ends"
- "The outcome does not require optional steps"
- "The system prevents the outcome under invalid conditions"
- "The outcome does not mutate unrelated user state"

### Not Allowed

- UI visibility or layout statements
- Button names, labels, or copy
- Screen-by-screen navigation
- Conditional or branching logic
- Technical, architectural, or data-layer detail
- Platform-specific terms
- Interaction verbs (click, tap, hover, drag)

If an Acceptance Criterion describes _how_ something happens, it belongs in Granular Stories.

---

## MVP vs Post-MVP Classification (Required)

Every High-Level Story **must** be explicitly classified as one of:

- **MVP** — Required for a usable first release. Enables a core user journey end-to-end.
- **Post-MVP** — Improves speed, scale, personalization, or insight. Must never be a prerequisite for MVP stories.

If classification is unclear, the story must be split or re-scoped.

---

## Scope Discipline Rules

High-Level Stories must:

- Avoid future-looking language ("eventually", "later")
- Avoid technical assumptions
- Avoid speculative growth or virality mechanics unless Post-MVP

If a story grows beyond a single outcome:

- Split it, or
- Move excess scope to Post-MVP

---

## Duplication & Overlap

Stories must be **merged** if they:

- Share the same role
- Describe the same outcome
- Differ only in wording or emphasis

Variations and edge cases belong in:

- Acceptance Criteria (if conceptual), or
- Granular Stories (if behavioral)

---

## Agent Instructions Header (Required)

Every `HL-STORIES.md` file MUST begin with an `<!-- Agent Instructions -->` HTML comment block before the first heading. This block tells builder agents what context to load before implementing.

**Template:**

```markdown
<!-- Agent Instructions
  Before building, read:
  - This file (HL-STORIES.md) for intent and outcomes
  - ../STORIES.md for granular acceptance criteria
  - ../PRD.md Section 8 (Feature Description) for implementation specifics
  - ../COPY.md for all microcopy
-->

# Feature Name — High-Level Stories
```

Omitting this header reduces builder context quality and increases the chance of misaligned implementations.

---

## Review Checklist (Mandatory)

A High-Level Story is acceptable only if:

1. Exactly one outcome is defined
2. Role is explicit and normalized
3. Acceptance Criteria clarify outcome guarantees
4. MVP or Post-MVP classification is explicit and justified
5. No duplication or overlap exists
6. Language is concise and globally understandable
7. No platform-specific or UI interaction language

Failure on any item requires revision.

---

## Authority & Precedence

In case of conflict:

- Canonical Product Model defines structure and truth
- High-Level Stories define intent and scope
- Granular Stories define behavior and guarantees

High-Level Stories are the authoritative source for **what the product must achieve**.
