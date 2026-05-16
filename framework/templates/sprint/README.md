# Sprint Workflow v0.1 — Templates

This directory ships the templates that `/sprint:plan`, `/sprint:design`,
`/sprint:execute`, and `/sprint:release` instantiate. None of these
templates is itself live tracker state. Live state lives in the
downstream product repo under `paths.sprintRoot`
(`.claude/project/sprint/`).

## Layout

```
framework/templates/sprint/
  README.md                          (this file)
  init/                              (downstream init payload)
    current-sprint.yaml.tmpl
    sprint-progress.yaml.tmpl
    README.md.tmpl                   (lives at .claude/project/sprint/README.md after init)
    issues.md.tmpl                   (lives at repo root after init; stub bug inbox)
  plan-contract/
    plan-contract.yaml.tmpl
    plan-report.md.tmpl
  requirements/
    prd.md.tmpl
    high-level-stories.md.tmpl
    granular-stories.md.tmpl
    copy.md.tmpl
    inputs.md.tmpl
    trace.md.tmpl
    acceptance-criteria.md.tmpl
    qa-plan.md.tmpl
    redteam-plan.md.tmpl
    release-plan.md.tmpl
  ticket/
    ticket.yaml.tmpl
  issue/
    issue.yaml.tmpl
    issues-md-block.md.tmpl
  external-service/
    external-service.yaml.tmpl
    setup-checklist.md.tmpl
  approval/
    approval.yaml.tmpl
  release/
    release.yaml.tmpl
    release-report.md.tmpl
  ralph/
    progress.yaml.tmpl
  checkpoint/
    checkpoint.yaml.tmpl
  history/
    sprint-history.yaml.tmpl
```

## Placeholder format

Templates use `{{key}}` placeholders. `scripts/sprint/fs.js#render` does
naive `{{key}}` → `value` substitution. Unfilled placeholders are
preserved as literal `{{key}}` so a partial fill is visible.

## Requirement IDs

Requirement templates that generate file content scanned by
`scripts/hooks/requirement-format-guard.js` carry the legacy marker
`<!-- requirement-format-legacy -->` so the guard does not block
placeholder IDs like `R-{{n}}` at write time. Downstream-generated real
files drop the marker when populated.

## Schemas

Every `.yaml.tmpl` here, when fully rendered, validates against the
corresponding `schemas/sprint/<name>.schema.json`. `scripts/sprint/validate.js`
runs the round-trip in CI.
