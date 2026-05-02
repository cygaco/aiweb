#!/usr/bin/env node
// One-off: add `backend` entry to .claude/agents/02-oneshot/.system/store.json
// derived from backend PRD §13 Implementation Map. New files only — files
// modified in OTHER features (api.ts, extension/*, etc.) stay owned by them.
const fs = require("fs");
const { PATHS } = require("./hooks/lib/paths");

const storePath = PATHS.oneshotStore;
const store = JSON.parse(fs.readFileSync(storePath, "utf8"));

// Derived from requirements/05-features/backend/PRD.md §13 Implementation Map.
// Filter rule: include files backend CREATES NEW. Exclude files marked as
// "edit existing" if those files are owned by other features per their
// store entries (e.g., src/lib/api.ts already touched by frontend features).
const backendFiles = [
  // Shared package — migrated/new
  "packages/shared/db/schema.ts",
  "packages/shared/db/migrations/init.sql",
  "packages/shared/rockets.ts",
  "packages/shared/prompts.ts",
  "packages/shared/errors.ts",
  "packages/shared/redaction.ts",
  "packages/shared/types.ts",
  // Hono service — routes
  "services/backend/src/api.ts",
  "services/backend/src/routes/auth.ts",
  "services/backend/src/routes/rockets.ts",
  "services/backend/src/routes/stripe.ts",
  "services/backend/src/routes/session.ts",
  "services/backend/src/routes/claude.ts",
  "services/backend/src/routes/jobs.ts",
  "services/backend/src/routes/tickets.ts",
  "services/backend/src/routes/extension.ts",
  "services/backend/src/routes/apply.ts",
  "services/backend/src/routes/health.ts",
  "services/backend/src/routes/admin.ts",
  // Middleware
  "services/backend/src/middleware/origin-pin.ts",
  "services/backend/src/middleware/qstash-verify.ts",
  "services/backend/src/middleware/scope.ts",
  "services/backend/src/middleware/idempotency.ts",
  // Core services
  "services/backend/src/worker.ts",
  "services/backend/src/ledger.ts",
  "services/backend/src/drain.ts",
  "services/backend/src/prompt-caching.ts",
  "services/backend/src/tickets.ts",
  "services/backend/src/r2.ts",
  // Admin panel
  "services/backend/src/admin/index.html",
  "services/backend/src/admin/admin.js",
  // WebAuthn
  "services/backend/src/webauthn/server.ts",
  "services/backend/src/webauthn/recovery-codes.ts",
  // Bootstrap + config
  "services/backend/scripts/seed-admin.js",
  "services/backend/fly.toml",
  "services/backend/Dockerfile",
  "services/backend/docker/Dockerfile.nginx",
  "services/backend/nginx.conf",
  // CI + ops
  ".github/workflows/backend.yml",
  "ops/runbooks/rotate-slug.md",
  "ops/runbooks/rotate-aop-cert.md",
  // Frontend bridge — well-known endpoint served by Vercel app
  "src/app/.well-known/api-config/route.ts",
];

if (store.features.backend) {
  console.log("backend entry already exists — updating files[] in place");
  store.features.backend.files = backendFiles;
  store.features.backend.status =
    store.features.backend.status || "not_started";
  store.features.backend.phase = 1.5;
} else {
  console.log("creating new backend entry");
  store.features.backend = {
    status: "not_started",
    owner: null,
    files: backendFiles,
    lockedInterfaces: [],
    fixAttempts: 0,
    note: "Phase 1.5 — backend service split. Spec authored 2026-04-24; code to be built in run-10. PRD: requirements/05-features/backend/PRD.md (v3, 895 lines, 73 acceptance tests).",
    finalScore: null,
    completedAt: null,
    phase: 1.5,
  };
}

fs.writeFileSync(storePath, JSON.stringify(store, null, 2) + "\n");
console.log(`Wrote backend entry with ${backendFiles.length} files.`);
console.log(`Verify: node scripts/one-off-stub-coverage-check.js`);
