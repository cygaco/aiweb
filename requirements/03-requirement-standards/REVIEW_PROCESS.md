# Review Process

## Purpose

Defines how PRDs, high-level stories, and granular stories are reviewed. The goal: minimize human review time by automating everything automatable, so human review focuses on product judgment, emotional resonance, and open decisions.

## Resolution Cascade

Requirements are written and reviewed top-down, one layer at a time across all features:

1. **PRDs** (all features) → review → approve
2. **High-Level Stories** (all features) → review → approve
3. **Granular Stories** (all features) → review → approve

Each layer must be approved before the next layer begins.

## Automated Validation

### PRD Linter

Run after every PRD edit. The linter checks:

**Structural (per PRD):**

- All required sections present and non-empty
- MVP/Post-MVP classification explicit
- JTBD uses "When / I want / so I can" format
- Emotional Framing covers Entry / During / Exit
- Feature Description scanned for before/after language leaks
- No embedded user stories ("As a user" pattern in Feature Description)
- Goals checked for vague language ("improve", "enhance", "better")

**Cross-PRD:**

- File ownership conflicts flagged (multiple PRDs claiming same file)
- Dependency DAG cycle detection

**Code Drift:**

- All file paths in Implementation Map verified on disk
- Key source files flagged if unclaimed by any PRD

**Exit criteria:** Linter returns PASS (0 errors, 0 warnings).

## Human Review

After the linter passes, human review focuses on what can't be automated:

### PRD Review Checklist (Human)

| # | Check | Question to answer |
|---|-------|-------------------|
| 1 | **Goals** | Are these the right goals? Would I bet money on these metrics? |
| 2 | **JTBD** | Does this feel authentic? Would a real user say this? |
| 3 | **Feature Description** | Is anything missing? Does this describe the complete feature? |
| 4 | **Emotional Framing** | Does this feel right? Would this feature actually make someone feel this way? |
| 5 | **Assumptions** | Am I comfortable with these assumptions? Any that feel risky? |
| 6 | **Open Questions** | Can I make these decisions now? Do the recommended defaults make sense? |
| 7 | **Out of Scope** | Is anything excluded that should be included, or vice versa? |

### What NOT to review (automated)

- Section presence and format → linter
- JTBD syntax → linter
- File path validity → linter
- Before/after language in Feature Description → linter
- Cross-PRD file conflicts → linter
- Dependency cycles → linter

## Review Workflow

```
1. Author writes/edits PRD
2. Run linter
3. If FAIL → fix errors → goto 2
4. If WARN → review warnings (may be false positives) → fix or suppress → goto 2
5. If PASS → human review (7-point checklist above)
6. If changes needed → goto 1
7. If approved → mark as approved, move to next feature or next layer
```

## One-Shot Assembly

After all three layers (PRD + HL + Granular) are approved:

1. Concatenate: `PRD.md + HL-STORIES.md + STORIES.md + COPY.md` per feature
2. Feed into one-shot generation prompt

See PRD_TEMPLATE.md § "One-Shot Generation" for section-level inclusion rules.

## Spec Drift Detection

After implementation, specs and code can diverge. Detection methods:

- **Automated:** Hook-based spec drift tracking marks files STALE when dependencies change
- **Manual:** Periodic `/check:requirements` audit compares spec claims to code reality
- **Prevention:** Implementation Map in PRD creates a traceable link between spec and code
