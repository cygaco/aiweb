# PRD Template

## Purpose

This template defines the mandatory structure for every Product Requirements Document. PRDs define **what a feature is, what it does, and how to build it**. They do not contain user stories — those live in separate files written in subsequent passes.

## Resolution Cascade

PRDs are written top-down across all features before drilling into stories:

1. **PRDs** (all features) — full feature spec, context, implementation map
2. **High-Level Stories** (all features) — intent and outcomes
3. **Granular Stories** (all features) — atomic behaviors and acceptance criteria

## File Structure

```
requirements/05-features/{feature-slug}/
  PRD.md          # Full feature spec
  COPY.md         # Microcopy companion (button labels, toasts, empty states, errors)
  HL-STORIES.md   # High-level stories (written in second pass)
  STORIES.md      # Granular stories (written in third pass)
  INPUTS.md       # Data inputs and validation rules
```

## One-Shot Generation

PRDs serve dual purpose: planning context for humans, and spec input for one-shot code generation.

Feature Description (Section 8) is written to stand entirely on its own — it describes the feature as if building from scratch, no references to "before" or "after."

### One-shot payload assembly

```
PRD.md + HL-STORIES.md + STORIES.md + COPY.md
```

## Required Sections

Every PRD must include all of the following sections. Use `n/a` when a section does not apply.

### 1. Title + Classification

Feature name. MVP or Post-MVP.

### 2. Screen

Which step, screen, or phase this feature lives on. Include component names matching the project GLOSSARY.

### 3. Context

Why this feature exists. The problem or gap it addresses. What prompted it. Who benefits and why it matters.

### 4. JTBD (Jobs To Be Done)

The core job(s) the user is hiring this feature to do. Use the JTBD format:

> When [situation], I want to [motivation], so I can [expected outcome].

Multiple jobs are fine. Each job should capture a distinct motivation.

JTBDs must be **platform-neutral** — describe the outcome the user is hiring the feature for, not the delivery mechanism. Platform specifics belong in Feature Description.

### 5. Emotional Framing

How the user should **feel** at each stage of this feature. Design decisions, copy, animations, and pacing should all serve this emotional arc.

Describe:

- **Entry**: How the user feels arriving at this feature (anxious? eager? overwhelmed?)
- **During**: How the feature sustains engagement (progress? discovery? control?)
- **Exit**: How the user feels leaving this feature (confident? empowered? relieved?)

This section guides UX decisions — loading states should reduce anxiety, celebrations should amplify achievement, errors should preserve trust.

### 6. Goals

What success looks like for this feature. Concrete, measurable outcomes. Each goal should be verifiable — you can look at the shipped feature and say "yes, this goal was met" or "no, it wasn't."

Examples:

- "User completes this step in under 3 minutes"
- "Zero errors on the golden path"
- "Data persists correctly across browser refresh"

### 7. Assumptions

What we are taking as given without explicit validation. Includes:

- User behavior assumptions (e.g., "users have data in a common format")
- Technical assumptions (e.g., "library X handles all edge cases")
- Business assumptions (e.g., "two output formats are sufficient")
- Data assumptions (e.g., "input always includes at least a name field")

Assumptions that later prove false become bugs or scope changes. Documenting them now creates a traceable decision trail.

`n/a` if no assumptions are made (rare).

### 8. Feature Description

The complete target state of the feature. This is the meat of the PRD.

Write this as if building from scratch — no references to "current state," "before," or "what changed." A reader (or a generation model) should understand the entire feature from this section alone.

**This is where platform specifics live.** JTBD, Emotional Framing, Goals, and HL Stories describe intent platform-neutrally. Feature Description names concrete technologies, platforms, and delivery mechanisms. During one-shot code generation, the model gets intent from stories and implementation specifics from this section.

Describe:

- What the feature does from the user's perspective
- The complete behavior — inputs, processing, outputs
- How it fits into the overall product flow
- Key interactions and state changes
- Edge cases and boundary conditions

### 9. Dependencies / Blockers

What must exist before this feature can be built. Other features, API integrations, data prerequisites, third-party services. `n/a` if none.

### 10. Feature Cost

What resources this feature consumes per use (API calls, credits, compute time). Include cost breakdown if multiple operations are involved. `n/a` if the feature is free.

### 11. Impact Metrics

Whether this feature affects key product metrics, and how. Describe which scoring factors, conversion rates, or engagement metrics change and in what direction. `n/a` if no measurable impact.

### 12. UI Reference

ASCII wireframe, screenshot link, or mockup reference showing the intended layout. For complex features, include multiple views (default state, loading state, error state, empty state).

### 13. Implementation Map

Table of files that change, what changes in each, and what existing code is reused. Call out new files only if truly needed.

### 14. Test Plan

Numbered steps to verify the feature end-to-end. Cover:

- Happy path (primary use case)
- Edge cases (empty states, boundary values)
- Error recovery (failures, retries)
- Integration points (data flow between components)

### 15. Out of Scope

What this PRD explicitly does NOT cover. Prevents scope creep. Names specific features, behaviors, or enhancements that are intentionally excluded. `n/a` if boundaries are obvious.

### 16. Open Questions

Unresolved decisions that need input before or during implementation. Each question should include the options being considered and a recommended default if no answer comes. `n/a` if all decisions are made.

## Rules

- Every section must be present. No section may be omitted.
- Use `n/a` rather than removing a section.
- PRDs do not contain user stories. Stories are written in separate passes.
- Copy/microcopy lives in the companion `COPY.md`, not in the PRD.
- File paths in Implementation Map must be relative to project root.
- PRDs reference existing code — they do not propose architecture.
- Feature Description must be self-contained — the complete target state, no "before/after" language.
- Assumptions must be documented even if they seem obvious.
- JTBD must use the standard "When/I want to/So I can" format.
- Emotional Framing must cover Entry, During, and Exit states.
- Goals must be concrete and verifiable.
- JTBD, Emotional Framing, and Goals must be platform-neutral.
- Feature Description is the single home for platform and technology specifics.

## Review Checklist

A PRD is acceptable only if:

1. All 16 sections are present
2. Classification (MVP / Post-MVP) is explicit
3. Goals are concrete and measurable
4. JTBD uses the standard format with situation, motivation, outcome
5. Feature Description is self-contained and describes the complete target state
6. Feature Description does not reference "current state" or use before/after language
7. Emotional Framing covers entry, during, and exit states
8. Assumptions are documented
9. Implementation Map identifies files to change and code to reuse
10. Test Plan covers happy path + at least one error case
11. No user stories are embedded in the PRD
12. JTBD, Emotional Framing, and Goals are platform-neutral
13. Platform specifics appear only in Feature Description, Implementation Map, and Test Plan
