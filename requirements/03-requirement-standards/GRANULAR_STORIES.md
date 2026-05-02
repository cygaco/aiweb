# Granular Story Standards

## Purpose

This document defines the mandatory rules for writing and reviewing **Granular User Stories**.

Granular Stories translate approved High-Level intent into **explicit, testable system behavior**. They are written so that design, engineering, and QA teams can implement and validate functionality **without inference, interpretation, or follow-up questions**.

Granular Stories are the **source of truth for implementation and QA**.

---

## Definition: Granular Story

A Granular Story describes **one atomic user decision or one atomic system behavior** under defined conditions.

A Granular Story answers:

- Under what condition does something happen?
- What does the system guarantee?
- What observable state results?
- What is explicitly prevented or disallowed?

Granular Stories define **behavioral guarantees**, not intent, flow, or UI choreography.

---

## Atomicity Rule (Non-Negotiable)

A Granular Story **must be atomic**.

A story must be split if it includes:

- Multiple user choices (e.g., "Retry / Edit / Cancel")
- Multiple state mutations
- Both success and recovery behavior
- Conditional branching that leads to different outcomes

**If QA must reason about "which path," the story is not atomic.**

One story = one decision or one behavior.

---

## Agent Instructions Header

Every STORIES.md file should begin with an Agent Instructions block. This tells builder agents how to interpret and implement the stories:

```markdown
> **Agent Instructions**
>
> 1. Each story = one code path you implement as a unit — do not combine stories
> 2. Check `Depends on:` before starting — if a dependency story isn't built, stop and report
> 3. The `Data:` field tells you exactly which TypeScript interfaces and fields to read/write
> 4. Your output will be evaluated against criteria you cannot see — build to the spec, not to assumed tests
> 5. If a story's acceptance criteria conflict with another story, escalate — do not guess
```

This block is read by builder agents before they start implementing. It prevents common agent mistakes (combining stories, skipping dependencies, guessing at test criteria).

---

## Required Story Format

Every Granular Story **must** follow this format:

> **As a [role], I want [one concrete action or behavior], so that [immediate benefit].**

### Agentic Metadata (Required)

Each story includes structured metadata lines after the blockquote, before Acceptance Criteria:

- **`Depends on:`** — List of GS IDs that must be implemented first. `none` if the story is self-contained. Enables agents to resolve implementation order and identifies which stories can be built in parallel.
- **`Data:`** — TypeScript interface(s) and field(s) this story reads or writes, with file path. e.g., `SessionData.profile → src/lib/types.ts`. Tells the agent exactly what data shapes to work with.
- **`Entry state:`** — **Required for stories that implement step/screen components.** Optional for validation-only or utility stories. Describes the session/UI condition under which this behavior applies. Valid values: `Fresh`, `Returning`, `Async-complete`, `Error-recovery`, `Any`.
- **`Verifiable by:`** — How to programmatically confirm the behavior works. e.g., "session storage contains `user.name`", "error element is visible", "API was called with expected payload". Gives agents enough to write their own tests.

### Parallel Clusters

Stories within a feature that share no dependencies can be implemented simultaneously by separate agents. Mark these clusters with a `<!-- parallel-safe -->` comment above the group header. An orchestrator can spawn one agent per story in a parallel cluster.

### Shared Behaviors

Cross-cutting behaviors (session persistence, loading states, validation patterns) are defined once in a `STORIES-COMMON.md` file. Feature stories reference shared stories by ID rather than re-specifying the behavior. Format: `Inherits: CS-XXX`.

### Rules

- Exactly one action or behavior per story
- Outcome must be behavioral and observable
- If more than one behavior is implied, the story must be split
- Parameterized enumerations (e.g., list of accepted file formats) within a single validation rule are one story, not N stories

---

## Role Usage

Granular Stories must inherit their role from the parent High-Level Story.

Rules:

- Roles must be generic and normalized
- No new or more specific roles may be introduced
- Default to **User** unless the behavior is system-owned

---

## Relationship to High-Level Stories

Every Granular Story must:

- Map to **exactly one** High-Level Story
- Support the parent intent without expanding scope
- Never introduce new outcomes or guarantees

Granular Stories **cannot exist independently**.

---

## Acceptance Criteria (Granular)

### Core Principle

Acceptance Criteria define **what the system guarantees and what it prevents**.

They do **not** describe flows, UI steps, or screen transitions.

There is **no fixed target count** for Acceptance Criteria.

Use:

- As few as possible
- As many as necessary

Most Granular Stories will have **1–4 Acceptance Criteria**.

---

## Semantic Completeness Rule

Acceptance Criteria must **collectively make unambiguous**:

- When or under what condition the behavior occurs
- What the system guarantees
- The resulting observable state
- At least one explicit boundary or prevention rule

A single Acceptance Criterion may satisfy multiple elements if clarity and testability are preserved.

---

## Prevention & Boundary Rules (Required)

Every Granular Story must include **at least one explicit boundary** defining:

- What must not happen
- What cannot occur implicitly or automatically
- What conflicting actions are blocked

Examples:

- Preventing downstream processing without upstream data
- Blocking navigation to a step whose prerequisites are unmet
- Disallowing output generation while input is incomplete
- Preventing auto-submission without user review

If no prevention or boundary exists, the story is incomplete.

---

## Edge Cases & Recovery Logic

Edge cases should be included **only if they are intrinsic** to the behavior.

If handling an error, retry, or interruption introduces:

- An additional user decision, or
- A different state transition

It must be written as a **separate Granular Story**.

Do not bundle recovery logic into a happy-path story.

---

## UI & Interaction References

Granular Stories may reference UI **only at a behavioral level**.

### Allowed

- "The primary action is disabled"
- "An error message is presented"
- "The user remains in the current state"
- "A confirmation dialog is shown"

### Not Allowed

- Visual design or layout details
- Animation or styling instructions
- Exact copy strings (unless required for validation)
- Input-method-specific verbs or widget names when the behavior is platform-independent

### Substitution Guide

When the behavior works the same regardless of platform, use behavioral language:

| Avoid | Use instead |
|-------|-------------|
| click, tap | select, activate, trigger, invoke |
| button | action, control |
| dropdown | selector, selection list |
| modal | dialog |
| hover | inspect, request details for |
| tooltip | contextual detail, on-demand detail |
| checkbox | toggle |
| popup (generic) | overlay |
| "in one click" | "with a single action" (or omit) |

**Exception:** Named platform elements are allowed when the story defines platform-dependent behavior.

Granular Stories define **what happens**, not how it looks.

---

## Platform & Implementation References

Granular Stories **may** reference platform specifics when behavior is platform-dependent.

Unlike High-Level Stories (which must be platform-neutral), Granular Stories describe concrete system behavior — and some behaviors only exist on specific platforms.

### Rules

- Reference platforms only when the behavior differs by platform
- If the behavior is the same regardless of platform, keep it generic
- Platform details in Granular Stories must not contradict the parent HL story's platform-neutral framing — they refine it

---

## Validation & Persistence

Granular Stories must make clear:

- When validation occurs
- What happens on validation failure
- Whether state is persisted, discarded, or unchanged

QA must be able to validate persistence without assumptions.

---

## MVP vs Post-MVP

Granular Stories inherit MVP or Post-MVP classification from their parent High-Level Story.

They may **not**:

- Introduce Post-MVP behavior into MVP scope
- Expand guarantees beyond the parent story

If they do, the parent High-Level Story must be revised.

---

## Assumptions & Decision Context (Optional)

If behavior is inferred due to incomplete upstream requirements, a short contextual note may be included outside Acceptance Criteria:

- Assumptions made (non-blocking)
- Rationale for defaults
- Open questions
- Default behavior if unanswered

Rules:

- This section must not introduce new requirements
- Acceptance Criteria remain authoritative
- QA validates against Acceptance Criteria only

---

## Review Checklist (Mandatory)

A Granular Story is acceptable only if:

1. It maps to exactly one High-Level Story
2. It defines one atomic decision or behavior
3. System guarantees are explicit and testable
4. At least one prevention or boundary rule exists
5. No bundled choices or branching outcomes exist
6. Scope does not exceed the parent story
7. `Depends on`, `Data`, `Entry state` (for step/screen stories), and `Verifiable by` metadata are present
8. Shared behaviors use `Inherits: CS-XXX` rather than re-specifying

Failure on any item requires the story to be split or rewritten.

---

## Authority & Precedence

In case of conflict:

- Canonical Product Model defines structure and truth
- High-Level Stories define intent and scope
- Granular Stories define behavior and guarantees

Granular Stories are the **source of truth for implementation and QA**.
