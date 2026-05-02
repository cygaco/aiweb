# Pattern Admission Policy

The `patterns/` library contains proven implementation patterns, not ideas, preferences, or one-off notes.

## Admission Criteria

A pattern may enter this directory only when all criteria are met:

1. Repeated use is proven by at least two independent occurrences or one accepted ADR.
2. Known failure modes are documented.
3. An example implementation is provided.
4. "When not to use" is documented.
5. A validating test, hook, or review check exists, or the absence is explicitly justified.
6. The owner and review cadence are named.

## File Shape

Each pattern file uses this structure:

- Purpose
- Use When
- Do Not Use When
- Example
- Failure Modes
- Validation
- Owner

## Removal

Patterns follow the deprecation policy. A pattern that no longer has evidence or validation is deprecated before removal.
