# Project Glossary

> **Purpose:** Single source of truth for naming. Every component, feature, step, and concept has exactly one canonical name. When names change, update this file FIRST — it cascades to specs, code, and agent prompts.

---

## Product Identity

<!-- What is the product called? What are the key branded terms? -->

| Term | Definition | Notes |
|------|-----------|-------|
| <!-- Product Name --> | <!-- One-line description --> | <!-- Any naming constraints --> |

---

## Features

<!-- List every feature with its canonical name, ID, and phase/location -->

| Feature ID | Display Name | Phase/Screen | Component File | Notes |
|-----------|-------------|-------------|---------------|-------|
| <!-- e.g., auth --> | <!-- e.g., Authentication --> | <!-- e.g., Global --> | <!-- e.g., AuthModal.tsx --> | <!-- MVP/Post-MVP --> |

---

## UI Components

<!-- Map component filenames to their display names and purpose -->

| Component | File | Purpose | Feature |
|-----------|------|---------|---------|
| <!-- e.g., Login Form --> | <!-- e.g., AuthModal.tsx --> | <!-- What it does --> | <!-- Which feature owns it --> |

---

## Steps / Screens / Phases

<!-- If your product has a wizard, pipeline, or multi-step flow, document the step-to-component mapping -->

| Step | Display Name | Component | Prerequisites |
|------|-------------|-----------|--------------|
| <!-- e.g., 1 --> | <!-- e.g., Upload Resume --> | <!-- e.g., Step1Resume.tsx --> | <!-- None --> |

---

## Naming Debt

<!-- Document any known naming inconsistencies. These are tech debt — the code says one thing, the UI says another. Track them here so specs stay consistent until the rename happens. -->

| Current Name (code) | Should Be | Reason | Blocked By |
|---------------------|----------|--------|-----------|
| <!-- e.g., Step2Preferences --> | <!-- e.g., Step3Preferences --> | <!-- Legacy numbering --> | <!-- Requires renumbering --> |

---

## Agent-Relevant Terms

<!-- Terms that agent prompts and specs reference. Agents should use these exact terms. -->

| Term | Meaning in This Project |
|------|------------------------|
| <!-- e.g., "foundation files" --> | <!-- Files in manifest.fileOwnership.foundation — shared infrastructure, read-only for feature agents --> |
| <!-- e.g., "gauntlet" --> | <!-- The 4-reviewer parallel check after every build: evaluator + compliance + security + QA --> |

---

## Rules

1. When renaming a concept, update this glossary FIRST
2. All PRDs, stories, and specs MUST use glossary terms (not synonyms)
3. Agent prompts reference this file for component-to-feature mapping
4. If a name appears in code differently than here, add it to Naming Debt
