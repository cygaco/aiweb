# WarpOS — flagged updates

Items flagged from this product repo for upstream WarpOS propagation. Drained on `/warp:promote` or `/warp:release`.

| Date | Category | Title | Source |
|---|---|---|---|
| 2026-05-07 | provider | gemini-cli stale model registry — providers.js error message + ISS-003 | `scripts/hooks/lib/providers.js`, `issues.md` |
| 2026-05-07 | agent | agent-dispatch-guide.md auto-load — gamma.md + delta.md + SessionStart inject | `.claude/agents/00-alex/gamma.md`, `.claude/agents/00-alex/delta.md`, `scripts/hooks/session-start.js` |
| 2026-05-07 | skill | new /warp:flag skill | `.claude/commands/warp/flag.md` |
| 2026-05-07 | hook | merge-guard requires REQ-* IDs + GS-XX-NN heading format — should be write-time linter not merge-time gate (ISS-004) | `scripts/hooks/merge-guard.js`, `scripts/requirements/graph-build.js`, `scripts/requirements/config.js` |

---

### 2026-05-07 — gemini-cli stale model registry — providers.js error message + ISS-003

- **Category:** provider
- **Source:** `scripts/hooks/lib/providers.js` line 391-403, `issues.md` ISS-003
- **Description:** gemini-cli ships its model registry baked into the binary. CLI v0.35.3 doesn't know about `gemini-3.1-pro` even though the model is documented at ai.google.dev/gemini-api/docs/models. All four name variants (`gemini-3.1-pro`, `gemini-3-pro`, `models/gemini-3.1-pro`, `gemini-3-1-pro`) return ModelNotFoundError; default model resolves. Fix path: `npm i -g @google/gemini-cli@latest` then re-probe. After upgrade, if still 404 it's account entitlement. The strict-failure error in `runProvider` was sharpened to point at this path explicitly. Upstream WarpOS may want a cli-version probe in `cliAvailable()` that warns on stale gemini-cli at session start.
- **Status:** open

---

### 2026-05-07 — agent-dispatch-guide.md auto-load — gamma.md + delta.md + SessionStart inject

- **Category:** agent
- **Source:** `.claude/agents/00-alex/gamma.md`, `.claude/agents/00-alex/delta.md`, `scripts/hooks/session-start.js`
- **Description:** Recurring failure: orchestrators (Gamma 2026-05-06, others before) bypass `agent-dispatch-guide.md` and re-hit known dispatch failure modes — `claude -p` Windows-stdin bug (LRN-2026-04-17-n), wrong output-dir convention, missed `delta-aggregate-reviews.js`. Fixes applied locally: (1) added MANDATORY READ for the guide to gamma.md + delta.md startup-read sequences; (2) extended SessionStart hook to always emit a "MANDATORY REFERENCE — agent-dispatch-guide.md" block in additionalContext so every session sees the guide path even before handoff/sleep/nudge content. Propagate all three changes to canonical WarpOS so future installs inherit the auto-load.
- **Status:** open

---

### 2026-05-07 — new /warp:flag skill

- **Category:** skill
- **Source:** `.claude/commands/warp/flag.md`
- **Description:** Lightweight tracker that appends framework-change flags to `warpos-to-update.md` at project root. Drains on `/warp:promote` or `/warp:release`. Created during YC sprint when user noted there was no clean way to flag mid-sprint framework changes for upstream propagation. Should ship in canonical WarpOS so all installs have the workflow.
- **Status:** open

---

### 2026-05-07 — merge-guard requires REQ-* IDs + GS-XX-NN heading format — should be write-time linter not merge-time gate (ISS-004)

- **Category:** hook
- **Source:** `scripts/hooks/merge-guard.js`, `scripts/requirements/graph-build.js`, `scripts/requirements/config.js`
- **Description:** During the compatibility-layer merge, the freshness gate fired at merge time requiring `REQ-<feature>-<topic>-<NNN>` IDs in PRD.md and `### GS-XX-NN:` headings in STORIES.md. The PRD/STORIES authored by Alpha during the YC sprint used `## S-1` format inherited from the special-instructions PRD precedent — so the gate caught a real mismatch but at the wrong moment (post-build, blocking merge). Recommendation: add a write-time linter on `_requirements/04-features/*/STORIES.md` that flags non-conforming heading format the moment it's saved, so the issue surfaces during requirements authoring not during merge. Also: the four pre-existing features (special-instructions etc.) all use the same wrong format and would also fail merge. They should be retroactively fixed or grandfathered.
- **Status:** open
