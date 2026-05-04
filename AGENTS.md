# Alex Agent System

> Router and table of contents for the multi-agent build system.
> For the full operational specification, see [.system.md](.claude/agents/.system.md).

---

## Agent Team

| Agent | Symbol | Role | Spec |
|-------|--------|------|------|
| **Alpha** | α | Architect, orchestrator | [alpha.md](.claude/agents/00-alex/alpha.md) |
| **Beta** | β | Judgment model | [beta.md](.claude/agents/00-alex/beta.md) |
| **Gamma** | γ | Adhoc build orchestrator | [gamma.md](.claude/agents/00-alex/gamma.md) |
| **Delta** | δ | Standalone oneshot orchestrator | [delta.md](.claude/agents/00-alex/delta.md) |

## Build Agents

| Agent | Role | Adhoc | Oneshot |
|-------|------|-------|---------|
| **Builder** | Code writer (scoped) | [adhoc](.claude/agents/01-adhoc/builder/) | [oneshot](.claude/agents/02-oneshot/builder/) |
| **Evaluator** | Code reviewer (pass/fail) | [adhoc](.claude/agents/01-adhoc/evaluator/) | [oneshot](.claude/agents/02-oneshot/evaluator/) |
| **Compliance** | Process auditor (cross-provider) | [adhoc](.claude/agents/01-adhoc/compliance/) | [oneshot](.claude/agents/02-oneshot/compliance/) |
| **Auditor** | Pattern analyst, environment evolver | — | [oneshot](.claude/agents/02-oneshot/auditor/) |
| **QA** | Failure scanner (self-orchestrating) | [adhoc](.claude/agents/01-adhoc/qa/) | [oneshot](.claude/agents/02-oneshot/qa/) |
| **Red Team** | Security + vuln scanner (self-orchestrating) | [adhoc](.claude/agents/01-adhoc/redteam/) | [oneshot](.claude/agents/02-oneshot/redteam/) |
| **Fixer** | Bug fixer (scoped) | [adhoc](.claude/agents/01-adhoc/fixer/) | [oneshot](.claude/agents/02-oneshot/fixer/) |

## Build Modes

| Mode | Purpose | Protocol |
|------|---------|----------|
| **Oneshot** | Full skeleton builds | [protocol.md](.claude/agents/02-oneshot/.system/protocol.md) |
| **Adhoc** | Single feature builds | [protocol.md](.claude/agents/01-adhoc/.system/protocol.md) |

**Adhoc team** (α + β + γ) is the default for development. **Oneshot** is a standalone Delta session (no team — Delta IS the session). **Solo** (Alpha alone) is rare.

## Key Documents

| Document | Purpose |
|----------|---------|
| [CLAUDE.md](CLAUDE.md) | Framework config, identity pointer, memory system |
| [PROJECT.md](PROJECT.md) | Project-specific context (product, architecture, env) |
| [.system.md](.claude/agents/.system.md) | Full operational specification |
| [manifest.json](.claude/manifest.json) | WarpOS identity card — project metadata, features, phases, providers |
| [paths.json](.claude/paths.json) | Centralized path registry — all hooks/scripts read paths from here |

## Dispatch Templates (per mode)

| Directory | Purpose |
|-----------|---------|
| [01-adhoc/](.claude/agents/01-adhoc/) | Adhoc mode agents (builder, evaluator, fixer, compliance, qa/, redteam/) |
| [02-oneshot/](.claude/agents/02-oneshot/) | Oneshot mode agents (builder, evaluator, fixer, compliance, auditor, qa/, redteam/) |

## Hard Rules (all agents)

1. **Stay in your lane.** Do not exceed your role's authority.
2. **Do not modify files outside your scope.** Your task defines which files you may touch.
3. **Do not communicate with the user.** Report to your orchestrator (Gamma or Alpha) only.
4. **Do not fix forward.** If your change breaks the build and you cannot fix it within scope, revert and report.
5. **Three attempts maximum.** If you fail 3 times on the same issue, stop and report.
6. **Cross-provider diversity required.** At least one gauntlet agent must run on a different provider.
7. **Decision authority.** Class A/B/C taxonomy, escalation red lines, and scoring rubric live at `paths.decisionPolicy`. Current product stage at `paths.currentStage`. Apply both before requesting a user decision.

## Review Protocol

Every builder output is reviewed by a 4-agent parallel gauntlet:
1. **Evaluator** — 5-check protocol (structural, grounding, coverage, negative, open-loop). Score 0-100.
2. **Compliance** — Process integrity (branch theft, phantom completion, spec adherence, hygiene, hallucinated deps).
3. **Security** — OWASP Top 10 + project-specific vulnerabilities.
4. **QA** — 13 failure-mode personas across scan + analyze modes.

## Reading Order

1. **CLAUDE.md** — framework config, identity pointer
2. **AGENTS.md** (this file) — router to all agent docs
3. **PROJECT.md** — project-specific context
4. **alpha.md / beta.md / gamma.md** — individual agent identities
5. **.system.md** — detailed operational spec
6. **{mode}/protocol.md** — mode-specific orchestration
7. **project-config.json** — project-specific data
