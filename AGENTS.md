# Alex Agent System

> Router and table of contents for the multi-agent build system.
> For the full operational specification, see [agent-system.md](.claude/agents/.system/agent-system.md).

---

## Agent Team

| Agent | Symbol | Role | Spec |
|-------|--------|------|------|
| **Alpha** | α | Architect, orchestrator | [alpha.md](.claude/agents/00-alex/alpha.md) |
| **Beta** | β | Judgment model | [beta.md](.claude/agents/00-alex/beta.md) |
| **Gamma** | γ | Adhoc build orchestrator | [gamma.md](.claude/agents/00-alex/gamma.md) |
| **Delta** | δ | Standalone oneshot orchestrator | [delta.md](.claude/agents/00-alex/delta.md) |

## Build Agents

| Agent | Role | Spec |
|-------|------|------|
| **Builder** | Code writer (scoped) | [adhoc](01-adhoc/builder/) / [oneshot](02-oneshot/builder/) |
| **Evaluator** | Code reviewer (pass/fail) | [adhoc](01-adhoc/evaluator/) / [oneshot](02-oneshot/evaluator/) |
| **Security** | Vulnerability scanner | [adhoc](01-adhoc/redteam/) / [oneshot](02-oneshot/redteam/) |
| **Compliance** | Process auditor (cross-provider) | [adhoc](01-adhoc/compliance/) / [oneshot](02-oneshot/compliance/) |
| **Auditor** | Pattern analyst, environment evolver | [oneshot](02-oneshot/auditor/) |
| **QA** | Failure scanner (self-orchestrating) | [adhoc](01-adhoc/qa/) / [oneshot](02-oneshot/qa/) |
| **Fix Agent** | Bug fixer (scoped) | [adhoc](01-adhoc/fixer/) / [oneshot](02-oneshot/fixer/) |

## Build Modes

| Mode | Purpose | Protocol |
|------|---------|----------|
| **Oneshot** | Full skeleton builds | [protocol.md](.claude/agents/.system/oneshot/protocol.md) |
| **Adhoc** | Single feature builds | [protocol.md](.claude/agents/.system/adhoc/protocol.md) |

**Adhoc team** (α + β + γ) is the default for development. **Oneshot** is a standalone Delta session (no team — Delta IS the session). **Solo** (Alpha alone) is rare.

## Key Documents

| Document | Purpose |
|----------|---------|
| [CLAUDE.md](CLAUDE.md) | Framework config, identity pointer, memory system |
| [PROJECT.md](PROJECT.md) | Project-specific context (product, architecture, env) |
| [agent-system.md](.claude/agents/.system/agent-system.md) | Full operational specification |
| [project-config.json](.claude/agents/.system/project-config.json) | Project-specific feature/phase/ownership config |

## Persona Templates

| File | Purpose |
|------|---------|
| [base-personas.md](.claude/agents/.system/base-personas.md) | Shared agent prompt templates (generic) |
| [oneshot/personas.md](.claude/agents/.system/oneshot/personas.md) | Oneshot mode overlay |
| [adhoc/personas.md](.claude/agents/.system/adhoc/personas.md) | Adhoc mode overlay |

## Hard Rules (all agents)

1. **Stay in your lane.** Do not exceed your role's authority.
2. **Do not modify files outside your scope.** Your task defines which files you may touch.
3. **Do not communicate with the user.** Report to your orchestrator (Gamma or Alpha) only.
4. **Do not fix forward.** If your change breaks the build and you cannot fix it within scope, revert and report.
5. **Three attempts maximum.** If you fail 3 times on the same issue, stop and report.
6. **Cross-provider diversity required.** At least one gauntlet agent must run on a different provider.

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
5. **agent-system.md** — detailed operational spec
6. **{mode}/protocol.md** — mode-specific orchestration
7. **project-config.json** — project-specific data
