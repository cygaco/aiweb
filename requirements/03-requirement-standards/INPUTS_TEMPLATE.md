# INPUTS.md — Template & Writing Guide

Every feature folder in `requirements/05-features/{feature}/` should have an `INPUTS.md` that documents all user-facing input fields. This is the spec agents use to build UI and wire data.

## When to write one

- If the feature has any user-editable fields, selection controls, toggles, text inputs, or interactive elements — it needs an INPUTS.md.
- If the feature is purely display, system-level, or has no user interaction — it does NOT need one. Note this in the feature's PRD instead.

## File structure

```markdown
# {Feature Name} — Inputs

One-line description of what this feature collects from the user.

**Global notes:**
- Any notes that apply to all screens in this feature (auto-save behavior, navigation, etc.)

---

## {Screen Name}

> **Depends on:** What must be true before this screen is reachable

### {Control or Section Name}

Description of the control.

| Option/Field | {Relevant columns} |
|---|---|
| ... | ... |

**Default:** What is pre-selected or pre-filled

### Conditional field (if any)

- **Trigger:** What causes it to appear
- **Control:** What type of input
- ...

### Downstream data contracts

| Field(s) | Consumed by |
|---|---|
| ... | ... |

### Exit gate

What must be true before the user can advance.
```

## Control types

Use these consistently across all INPUTS files:

| Control | When to use | Signal to user |
|---|---|---|
| **Cards** | Choices that deserve attention (full phrases, consequential) | "Stop and think" |
| **Pills** | Simple attributes/tags, quick toggles | "Tag and go" |
| **Dropdown** | Long option lists (6+) that don't need to be visible at once | "Pick one" |
| **Text input** | Short free-text (names, URLs, numbers) | "Type a value" |
| **Textarea** | Longer free-text (descriptions, directions) | "Explain something" |
| **Combobox** | Type-to-filter from a large list, with optional free-text fallback | "Search or type" |
| **Toggle/checkbox** | Binary on/off | "Yes or no" |
| **De-selectable chips** | AI-generated lists the user curates by removing items | "Remove what doesn't fit" |

### How to choose a control type

When the INPUTS file doesn't specify a control type explicitly, use this decision framework:

**Step 1: How many options?**
- 2–3 options → pills or cards (go to step 2)
- 4–6 options → cards, pills, or dropdown (go to step 2)
- 7+ options → dropdown or combobox
- Unlimited/dynamic list → de-selectable chips (if AI-generated) or combobox (if user-searched)

**Step 2: How much cognitive weight?**
- Options are full sentences or need reading → **cards** (slows the user down intentionally)
- Options are single words or short labels → **pills** (keeps the user moving)
- Options are consequential (exclusions, identity-level choices) → **cards**
- Options are simple attributes (filters, tags, parameters) → **pills**

**Step 3: Selection model?**
- Pick exactly one → single-select (cards, pills, or dropdown)
- Pick one or more → multiselect (cards or pills — never multiselect dropdown)
- Toggle on/off independently → cards (if phrases) or pills (if short)
- AI-generated, user curates by removing → de-selectable chips

**Step 4: Special cases**
- Options have a warning/exclusion meaning → use a distinct visual treatment
- Options come from a large known dataset → combobox with type-to-filter
- Options are AI-assessed and user corrects → dropdown with pre-selected AI value

**When the INPUTS file specifies a control type, that overrides this framework.**

## Required columns by context

**For selection controls (cards, pills, dropdowns):**

| Column | Required | Notes |
|---|---|---|
| Option | Yes | The label the user sees |
| Mutually exclusive with | Yes | N/A if none |
| Default | Yes | What is pre-selected. "None" if nothing |

**For form fields (text inputs, textareas):**

| Column | Required | Notes |
|---|---|---|
| Field | Yes | The label |
| Control | Yes | Input type |
| Required | Yes | Yes/No, or "Required if {condition}" |

**For de-selectable chips:**

| Column | Required | Notes |
|---|---|---|
| Field | Yes | What the chip group represents |
| Chip style | Yes | Primary or secondary/muted |
| Notes | Yes | Source of the data, de-select behavior |

## Downstream data contracts

Every screen with editable fields must have a "Downstream data contracts" table:

| Field(s) | Consumed by |
|---|---|
| The session field name | Feature + specific usage |

## Exit gates

Every screen must document its exit gate — what conditions must be met before the user can advance. Format as a sentence:

- "At least one option selected."
- "All required fields filled. Validates URL format if provided."
- "None — user can proceed with all defaults."

## Conditional fields

When a user's selection triggers additional inputs:

- **Trigger:** Which option(s) cause the field to appear
- **Deselect behavior:** What happens when the trigger is deselected (usually: hide but retain value)
- **Required:** Whether the conditional field blocks advancement while visible

## Hierarchical requirements

When a section is optional but its children have requirements:

> "The {section} itself is optional — zero entries is valid. But if an entry exists, fields marked 'Required if entry exists' must be filled before saving."

## Loading states

If a screen has async dependencies, document:

- **What the user sees** while waiting
- **Error states** and available actions (retry, go back)
- **Success transition** — how the screen changes when data arrives

## Features with no user inputs

If a feature is purely computational or display-only, it does not need an INPUTS.md. Note this in the PRD.

## Platform language

INPUTS files describe **what** the user does, not **how** they do it on a specific platform:

- Say "select" not "click" or "tap"
- Say "enter" not "type"
- Say "advance" not "click Next"
- Say "dismiss" not "swipe away"

**When to be platform-specific:** Only when behavior genuinely differs by platform.

## Naming conventions

- File: always `INPUTS.md` in the feature folder
- Screen names: use descriptive names, not step numbers
- Field names: match the user-facing label, not the code variable name
