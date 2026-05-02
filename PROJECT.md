# Jobzooka — Project Context

> Product-specific context for the Jobzooka project. For framework instructions, see [CLAUDE.md](CLAUDE.md).

## Product

**Jobzooka** — Job search assistant: resume to targeted resumes, LinkedIn content, form answers, auto-apply. Guided onboarding plus dashboard, Next.js 16 + React 19 + TypeScript, Chrome extension for LinkedIn Easy Apply.

### UX Flow (shipped router)

- **Step 0**: Intro or returning-user hub
- **Steps 1-3**: `OnboardingPage.tsx` — resume upload, preferences, profile verify
- **Steps 4-5**: `AimPage.tsx` — search queries, Bright Data scrape, two-phase market analysis, category lock
- **Step 6**: `ReadyPage.tsx` — current shipped Deep-Dive Q&A host; target state moves this to the dashboard
- **Step 7**: `Step8Skills.tsx` — skills curation
- **Step 8+**: `Dashboard.tsx` — Command Console, Resumes, LinkedIn, Auto-Apply

Target-state specs move Deep-Dive Q&A to the dashboard and shorten required onboarding. Until that skeleton rebuild lands, use `src/app/page.tsx` and `src/lib/constants.ts` as the shipped routing authority.

## Architecture & Key Files

### Architecture

- **Framework**: Next.js 16.2.3 (Turbopack), React 19, TypeScript
- **Hosting**: Vercel (Hobby plan — 60s function timeout)
- **AI**: Claude API via `/api/claude` route (server-side, key never exposed)
- **Job Data**: Bright Data LinkedIn Jobs Scraper API via `/api/jobs` route
- **Auth**: Canonical primitives in `packages/shared/auth.ts`; v3 specs move auth routes to the dedicated backend
- **Payments**: Stripe config/status route in this app; checkout/webhook move to backend per v3 specs
- **Rate Limiting**: Upstash Redis (`@upstash/ratelimit`)
- **Storage**: Encrypted localStorage (AES-GCM via Web Crypto API) + Redis server sessions
- **Styling**: CSS custom properties (dark corporate theme), Tailwind for base reset only

### Core Logic (`src/lib/`)

- `prompts.ts` — All Claude prompt templates (server-only)
- `api.ts` — Client-side API helpers (`callClaude`, `fetchJobs`)
- `types.ts` — All TypeScript interfaces
- `constants.ts` — Phase/step definitions, PHASE_DISPLAY, `getScreen()`
- `storage.ts` — Encrypted session persistence (AES-GCM)
- `utils.ts` — Data processing (`preprocessMarketData`, `buildMarketSummary`, `extractHourlyRates`, `buildMarketPrepPayload`)
- `pipeline.ts` — Pipeline tracer (`[PIPELINE]` log prefix)
- `validators.ts` — Input sanitization and validation
- `competitiveness.ts` — 0-100 competitiveness scoring algorithm
- `rockets.ts` — Rocket credit economy (costs, packs, atomic debit via Lua script)
- `api-rate-limit.ts` — Shared API route rate-limit helper
- `rate-limit-fallback.ts` — Dev-only in-memory rate-limit fallback
- `csrf.ts` — Legacy CSRF origin validation surface
- `download-helpers.ts` — File download utilities (blob triggers, ZIP bundling)
- `upload.ts` — Resume file upload handling
- `dummy-data.ts` — `buildDummySession(step)` for testing
- `test-harness.ts` — QA test suite runner
- `deus-mechanicus.ts` — Product-agnostic manifest interfaces
- `deus-mechanicus-jobzooka.ts` — Jobzooka manifest factory + test suites
- `warp-profiles.ts` — Cross-product profile schema, CRUD, converters

### Shared Packages (`packages/shared/`)

- `auth.ts` — JWT creation/verification, password hashing, session/user/OAuth-state helpers
- `apply-template.ts` — Chrome prompt builder (code-assembled)
- `docx-generator.ts` — Resume DOCX file generation
- `pdf-generator.ts` — Resume PDF file generation

### Components

- `src/components/DeusMechanicus.tsx` — Dev tools hub shell
- `src/components/pages/` — Composite pages (OnboardingPage, AimPage, ReadyPage)
- `src/components/steps/` — Step components (Step1Resume through Step13Apply)
- `src/components/ui/` — Atomic UI components (Btn, Card, Inp, Sel, etc.)
- `src/app/page.tsx` — Main wizard orchestrator

### API Routes (`src/app/api/`)

- `claude/` — Claude LLM endpoint (rate-limited, rocket billing)
- `jobs/` — Bright Data job scraper (trigger, poll, results)
- `rockets/grant/` — Legacy rocket grant endpoint during backend cutover work
- `stripe/config/` — Safe Stripe configuration status (`{configured}`)
- `test/` — Health & diagnostic checks (env-gated)

### Extension

Chrome extension in `extension/`. Manifest V3, LinkedIn Easy Apply automation. Files: `manifest.json`, `background.js`, `content.js`, `popup.html/css/js`.

### Deus Mechanicus (Dev Tools Hub)

Accessible via `/?dummyplug` or `/?deusmechanicus`. Protected by `NEXT_PUBLIC_DUMMY_PLUG_CODE` env var.

**CRITICAL**: `<DeusMechanicus>` wraps the entire app tree as a React context provider. Do NOT refactor it into a sibling — it must be the outermost wrapper so any child can call `useDM()`.

Modules: **DUMMY PLUG** (Warp Profiles), **QA SUITE** (test runner). Step definitions derived from `PHASE_DISPLAY` in `constants.ts` — single source of truth.

### Bright Data Integration

- **Dataset**: `gd_lpfll7v5hcqtkxl6l` (LinkedIn Jobs Scraper, discovery mode)
- **Flow**: POST trigger, poll progress, GET snapshot
- **Valid `job_type`**: `"Full-time"`, `"Part-time"`, `"Contract"`, `"Temporary"`, `"Internship"`, `"Volunteer"`, `"Other"` (case-sensitive)
- **Valid `remote`**: `"Remote"` (capital R)
- Full BD docs in `docs/brightdata/`

**Known Issues (2026-03-18):** BD returns annual salaries for contract roles, thin data yield for non-FT types, hourly rates extracted via regex (`extractHourlyRates()`).

**Two-Phase Market Pipeline:** MARKET_PREP (raw to intelligence report), MARKET (report to analysis). Fallback: skip MARKET_PREP if it fails.

### Pipeline Tracing

Stages: `USER_INPUT`, `QUERY_GEN`, `BD_TRIGGER`, `BD_POLL`, `BD_RESULTS`, `MARKET_PREP_INPUT`, `MARKET_PREP_OUTPUT`, `MARKET_INPUT`, `MARKET_OUTPUT`, `RESUME_INPUT`, `RESUME_OUTPUT`

## Specs, Agents, & Docs

### Product Spec Pipeline

Specs top-down: PRDs, HL Stories, Granular Stories, COPY. All 13 features at each layer.

```
requirements/05-features/{feature-slug}/
  PRD.md, HL-STORIES.md, STORIES.md, COPY.md  — all 13 features complete
```

**PRD Section Order:** 1-3: Title, Screen, Context. 4: JTBD. 5: Emotional Framing. 6: Goals. 7: Assumptions. 8: Feature Description. 9-16: Deps, Rockets, Comp, UI, Impl Map, Test, OOS, Decisions

**Platform Neutrality:** JTBD, Emotional Framing, Goals, and HL Stories are platform-neutral. Exception: features whose scope IS a platform (extension, auto-apply) may use platform language in JTBD/Goals.

**Agentic Story Metadata:** Every granular story has `Depends on:`, `Data:`, `Entry state:`, `Verifiable by:`, `Inherits:`, and optional `<!-- parallel-safe -->`.

**Regen Gap Docs** (`docs/04-architecture/`): PROMPT_TEMPLATES, DESIGN_TOKENS, VALIDATION_RULES, AUTH_SCHEMAS, EXTENSION_SPEC, ERROR_RECOVERY, FLOW_SPEC, AGENT_GUIDE.

### Agent System

See [AGENTS.md](AGENTS.md) for the full agent system router. Key references:
- `.claude/agents/alex/` (alpha.md, beta.md, gamma.md)
- `.claude/agents/.system/agent-system.md` (operational spec)
- `.claude/agents/general/` (builder, evaluator, fix-agent, auditor, qa, security, compliance)

**After every agent run:** Create `retro/{NN}/` with RETRO.md, BUGS.md, LEARNINGS.md, HYGIENE.md.

**Bug fix triage:** Typo = BUGS only. Pattern bug = BUGS + HYGIENE. Process bug = BUGS + HYGIENE + RETRO. Only log verified fixes.

### Decision Log

PostToolUse hook (`edit-watcher.js`) auto-logs spec edits to `paths.eventsFile` (category: `spec`). Run `node scripts/materialize-decisions.js` to generate a human-readable view.

## Environment & Dev

### Dev Commands

```bash
npm run dev          # Dev server (Turbopack, port 3000)
npm run build        # Production build
npm run test         # Playwright tests
npm run lint:docs    # All doc linters
```

### Environment Variables

**Required:** ANTHROPIC_API_KEY (Claude API, fallback: JOBZOOKA_CLAUDE_KEY), BRIGHTDATA_API_KEY (scraper), UPSTASH_REDIS_REST_URL + TOKEN (rate limiting, rockets, sessions), ALLOWED_ORIGINS (CSRF, comma-separated), JWT secret for auth signing.

**Auth (optional):** GOOGLE_CLIENT_ID/SECRET, LINKEDIN_CLIENT_ID/SECRET, NEXT_PUBLIC_OAUTH_GOOGLE/LINKEDIN (show OAuth buttons).

**Stripe (optional):** STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_SCOUT/STRIKE/ARSENAL (rocket pack price IDs).

**Optional with defaults:** BRIGHTDATA_DATASET_ID (default: gd_lpfll7v5hcqtkxl6l), CLAUDE_MODEL (default: claude-sonnet-4-20250514), DAILY_JOB_REQUEST_LIMIT (100), DAILY_REQUEST_LIMIT (500), DAILY_TOKEN_LIMIT (2M), NEXT_PUBLIC_DUMMY_PLUG_CODE, NEXT_PUBLIC_APP_URL, ENABLE_TEST_API, ADMIN_SECRET.

### Testing

- **Dummy Plug**: `/?dummyplug` or `/?dummyplug&step=10` — fast-forward with test data
- **Test API**: `/api/test?check=all` — health, build, env, API connectivity
- **After code changes**: `npm run build` must pass clean

## Cross-repo parity with WarpOS

This repo (`cygaco/jobhunter-app`, branch `skeleton-test7`) is the **dev repo** for the Alex / WarpOS framework. The sibling repo `cygaco/WarpOS` is the **shipped product** that end-users install.

**Rule:** every commit that touches framework-shared paths must sync to WarpOS in the same or adjacent commit. Framework-shared paths include:
- `scripts/hooks/**`, `scripts/*.js` (installer + libs)
- `.claude/agents/**`, `.claude/commands/**`, `.claude/paths.json`, `.claude/manifest.json`
- `CLAUDE.md` (WarpOS ships its own copy to every install)

Product-specific files (`src/**`, `PROJECT.md`, `docs/**`, `requirements/**`) stay jobhunter-only.

**Workflow:** before `git commit`, ask which category the change falls in. If framework: `cp` the file to the WarpOS checkout, commit + push both. Cross-repo drift compounds silently — catch it per-commit, not per-session.

## Git & Compliance

### Git Rules

- **Never kill or overwrite the backup branch** (`backup-2026-03-18`)
- Branch: `master`

### Compliance

- Extension auto-applies based on user-defined heuristics (apply-if/skip-if signals)
- Prompt injection defense — external data in `<untrusted_job_data>` tags with nonce
- Rate limiting — per-IP (20/min Claude, 10/min BD) + global (60/min) + daily budget
- API keys server-side only — never exposed to client bundle
- Auth: JWT cookie-based, OAuth optional (Google/LinkedIn)
