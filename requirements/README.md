# WarpOS Requirements System

A structured documentation framework for building products. Each folder contains templates with inline guidance comments (`<!-- GUIDANCE: -->`).

## Structure

| Folder | Purpose | Key Files |
|--------|---------|-----------|
| `00-canonical/` | Product foundations | CORE_BRIEF, PRODUCT_MODEL, GLOSSARY, GOLDEN_PATHS, USER_COHORTS, FAILURE_STATES |
| `01-design-system/` | UI rules and components | UX_PRINCIPLES, COLOR_SEMANTICS, COMPONENT_LIBRARY |
| `02-copy-system/` | Voice, tone, and microcopy | COPY_STRATEGY |
| `03-requirement-standards/` | Feature spec templates | PRD_TEMPLATE, HIGH_LEVEL_STORIES, GRANULAR_STORIES, INPUTS_TEMPLATE, REVIEW_PROCESS |
| `04-architecture/` | Technical design | STACK, DATA_FLOW, SECURITY |
| `05-features/` | Feature specs (one folder per feature) | See `_example-onboarding/` |
| `06-operations/` | Deployment and monitoring | DEPLOYMENT |
| `07-security/` | Red team report template | REDTEAM_REPORT |
| `08-testing/` | Test strategy | TEST_STRATEGY |
| `09-automation/` | CI/CD and scheduled tasks | CI_CD |
| `99-audits/` | Systematic review template | AUDIT_TEMPLATE |

## How to Use

1. Copy the templates you need into your project's `requirements/` folder
2. Fill in the sections, following the `<!-- GUIDANCE: -->` comments
3. For features, create a folder per feature in `05-features/` with: PRD.md, STORIES.md, HL-STORIES.md, INPUTS.md, COPY.md
4. See `05-features/_example-onboarding/` for a complete example

## Resolution Cascade

Write specs top-down: PRDs first (all features), then HL-Stories (all features), then Granular Stories (all features). This prevents inconsistencies between features.
