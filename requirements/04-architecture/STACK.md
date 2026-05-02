# [Project Name] — Stack & Deployment

> **Note:** Core stack and env vars may also be documented in `CLAUDE.md`. This file adds detail not covered there. If they conflict, CLAUDE.md wins.

---

## Core Stack

<!-- GUIDANCE: Document every technology choice. Include version and WHY it was chosen.

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Framework | [e.g., Next.js] | [version] | [App Router, key features used] |
| UI Library | [e.g., React] | [version] | [Server/client components] |
| Language | [e.g., TypeScript] | [Strict mode] | [All source files] |
| Hosting | [e.g., Vercel] | [Plan] | [Timeout limits, deployment model] |
| AI | [e.g., Claude API] | [Model] | [Via server-side route] |
| Data Source | [e.g., External API] | [Version] | [What data, dataset IDs] |
| Rate Limiting | [e.g., Upstash Redis] | [Library] | [Strategy: sliding window, per-IP] |
| Encryption | [e.g., Web Crypto API] | [Algorithm] | [What's encrypted, where] |
| Styling | [e.g., Tailwind / CSS vars] | — | [Approach: tokens, inline, utility classes] |
| Auth | [e.g., JWT + OAuth] | [Library] | [Providers, session strategy] |
| Payments | [e.g., Stripe] | [Library] | [What's paid, webhook handling] |
-->

---

## Build & Dev Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run test` | Run tests |
| `npm run lint` | Lint code |
<!-- GUIDANCE: Add all commands from package.json scripts that developers need -->

---

## Deployment

<!-- GUIDANCE: Document:
- **Platform**: Where it's hosted, deployment trigger
- **Function timeout**: Server-side limits
- **API routes**: List all server-side routes
- **Static assets**: How they're served (CDN, etc.)
- **Environment variables**: Where configured (dashboard, .env.local)
-->

---

## Key Constraints

<!-- GUIDANCE: Document technical limitations that affect feature design:

1. **Timeout limits** — Server-side function timeouts affect long operations
2. **API rate limits** — External API limits that affect feature design
3. **Bundle size** — Client-side size limits or lazy loading requirements
4. **Browser support** — Minimum browser versions, mobile support
5. **Concurrent connections** — Database connection limits, websocket limits

For each constraint: what it is, what it affects, and any workarounds.
-->

---

## File Structure

<!-- GUIDANCE: Document the project's directory structure:

```
project/
├── src/
│   ├── app/           # Routes and pages
│   │   ├── api/       # Server-side API routes
│   │   └── page.tsx   # Main page
│   ├── components/    # React components
│   ├── lib/           # Shared utilities
│   └── styles/        # Global styles
├── docs/              # Documentation
├── requirements/      # Product specs
├── scripts/           # Build and utility scripts
├── .claude/           # WarpOS configuration
└── extension/         # Browser extension (if applicable)
```
-->

---

## Third-Party Dependencies

<!-- GUIDANCE: List significant dependencies with their purpose. Not every npm package — just the ones that affect architecture or have licensing implications.

| Package | Purpose | License | Alternatives Considered |
|---------|---------|---------|------------------------|
| [name] | [what it does] | [MIT/Apache/etc] | [what else was considered and why this won] |
-->

---

## Performance Budget

<!-- GUIDANCE: Define performance targets:

| Metric | Target | Current |
|--------|--------|---------|
| First Contentful Paint | < 1.5s | |
| Time to Interactive | < 3s | |
| Largest Contentful Paint | < 2.5s | |
| Bundle size (gzipped) | < 200KB | |
| API response time (p95) | < 2s | |
-->

---

## Stack Decision Log

<!-- GUIDANCE: When you make a significant technology choice, log it here:

### [Date]: Chose [Technology] over [Alternative]
**Context:** What we needed
**Decision:** What we chose and why
**Consequences:** What this means for the project (good and bad)
-->
