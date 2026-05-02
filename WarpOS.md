# WARP — The Machine That Builds Products

> The internal operating system of the studio. This is the core asset.
> Every product builds on it. Every product contributes back to it.

## What Warp Is

Warp is not a product. It is the machine that builds products.

Six layers:

1. **Shared infrastructure** — auth, database, billing, APIs shared across all products
2. **Automation layer** — workflow automations that eliminate repetitive human effort
3. **AI orchestration** — prompt systems, agent pipelines, Claude integrations
4. **Data warehouse** — single source of truth, every product feeds it
5. **Playbook library** — validated patterns and decisions, reusable across products
6. **Studio OS** — how we hire, decide, experiment, and operate

## Current Stack

| Layer      | Tool                                | Notes                                         |
| ---------- | ----------------------------------- | --------------------------------------------- |
| Frontend   | Next.js 16 + React 19               | TypeScript, Turbopack                         |
| Backend    | Next.js API routes                  | Serverless, Vercel                            |
| Database   | Supabase (Postgres)                 | Per-product schemas in shared instance        |
| AI         | Claude API (Anthropic)              | Primary model layer, server-side only         |
| Hosting    | Vercel                              | Hobby plan (60s timeout), upgrade path to Pro |
| Payments   | Stripe                              | Not yet wired                                 |
| Auth       | Supabase Auth                       | Not yet wired to products                     |
| Automation | n8n (planned)                       | Self-hosted or cloud                          |
| Data       | Supabase + localStorage (encrypted) | Products use encrypted client storage for now |

## Shared Patterns (Validated in Production)

### Deus Mechanicus — Dev Tools Hub

Product-agnostic dev tools framework. Any product exports a `ProductManifest` and gets:

- Fast-forward bar (jump to any step with test data)
- QA test runner (server + client suites)
- Data inspector (live session state)
- Pipeline tracer (data flow debugging)
- Warp Profiles (cross-product test identities)

First implementation: a real consumer product (private), see `src/lib/deus-mechanicus.ts` + `src/components/DeusMechanicus.tsx` in that project.

### Warp Profiles — Cross-Product Test Data

Product-agnostic identity + product-specific extensions. A profile created in one product can be loaded in any future WarpOS-based product.

Format: `{ meta, warp (shared identity), <product-slug>? (product extension), ... }`

### Encrypted Client Storage

AES-GCM via Web Crypto API. Key derived per-session. Products store session data in encrypted localStorage — no server-side persistence needed for MVP.

### Two-Phase AI Pipeline

Pattern: raw data → Phase 1 (structured intelligence report) → Phase 2 (final analysis). Decouples data preparation from decision-making. Enables fallback (skip Phase 1 if it fails).

First implementation: a market-analysis feature in the source consumer product (MARKET_PREP → MARKET).

### Pipeline Tracing

Structured logging at each pipeline stage. Format: `[PIPELINE] STAGE_NAME { data }`. Stages are product-specific but the tracer is generic.

## Products

The first WarpOS-based product is private — the framework was extracted from it. Future WarpOS-based products can contribute back shared patterns, agents, hooks, or skills via pull request.

## AI Orchestration Patterns

Each pattern below was discovered and battle-tested in a real consumer product before being generalized into WarpOS.

| Pattern                  | Description                                       | Example domain     |
| ------------------------ | ------------------------------------------------- | ------------------ |
| Structured extraction    | Parse unstructured input → typed JSON             | Resume parsing     |
| Two-phase analysis       | Raw data → intelligence report → decision output  | Market analysis    |
| Targeted generation      | Profile + context → personalized output           | Document generation |
| Prompt injection defense | External data wrapped in `<untrusted_*>` tags     | User-supplied text  |
| Progressive disclosure   | Show N items initially, expand on demand          | Q&A flows           |
| Streaming generation     | Show partial results immediately, load rest async | Long-form output    |
| Smart conditional gen    | Skip generation when output would be identical    | Caching layer       |

## Operating Principles

- The backbone is the product. Everything else is output.
- Automate on second repetition.
- AI-native by default — Claude is the first tool considered, not the last.
- Human judgment for what matters. Systems for everything else.
- Every product feeds the data layer. No silos.
- Experiment fast, kill fast, compound learnings.
- Backbone-first: if useful for one product, build into Warp for all.

## Decisions Log

| Date       | Decision                 | Chosen                                                       | Why                                                                                       |
| ---------- | ------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 2026-03-18 | Market analysis pipeline | Two-phase (MARKET_PREP → MARKET)                             | Single-pass produced wrong categories for non-FT roles; decoupling lets each phase focus  |
| 2026-03-19 | Dev tools framework      | Product manifest pattern (Deus Mechanicus)                   | Lets any product get dev tools by exporting a manifest — no per-product UI work           |
| 2026-03-19 | Test data system         | Warp Profiles (product-agnostic + extensions)                | Test identities should be shared across products, not siloed                              |
| 2026-03-19 | Client storage           | Encrypted localStorage (AES-GCM)                             | No server persistence needed for MVP; encryption protects PII at rest                     |
| 2026-03-19 | Claude Code hooks        | 8 lifecycle hooks across 5 events                            | Catch errors at edit time; guard secrets; auto-handoff between sessions                   |
| 2026-03-19 | Skills system            | 12 slash commands as markdown protocol files                 | Zero tokens when inactive; encode expertise the agent can invoke on demand                |
| 2026-03-19 | Auto-handoff             | Stop→SessionStart hook chain + prompt logger + compact saver | Sessions chain automatically — no manual context transfer needed                          |
| 2026-03-24 | Docs knowledge base      | 30 canonical docs across 6 categories                        | Gives Claude full product context without prompting — design, copy, architecture, stories |

---

_Last updated: 2026-03-24 (sync)_
