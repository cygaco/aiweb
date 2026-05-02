#!/usr/bin/env node
/**
 * preflight-restore-ambient-stubs.js
 *
 * Re-create as minimal stubs the files that were deleted by 7.8 reconcile but
 * are still imported by foundation files (e.g. src/app/page.tsx). These are
 * NOT added to any feature scope — they're ambient compatibility shims that
 * exist solely to satisfy foundation imports until foundation is updated to
 * the new architecture.
 *
 * Pass 7.6 will surface them as "stubs without feature ownership" — that's
 * the desired signal for triage.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STORE = path.join(ROOT, ".claude/agents/02-oneshot/.system/store.json");

const files = [
  "src/components/AuthModal.tsx",
  "src/components/ConfettiBurst.tsx",
  "src/components/HubScreen.tsx",
  "src/components/pages/AimPage.tsx",
  "src/components/pages/ReadyPage.tsx",
  "src/components/RocketBar.tsx",
  "src/components/RocketStore.tsx",
  "src/lib/csrf.ts",
];

function stubComponent(rel) {
  const base = path.basename(rel, ".tsx");
  return [
    '"use client";',
    `// SKELETON: ambient compatibility stub — ${base} (no feature owner; foundation still references)`,
    'import React from "react";',
    "",
    `export function ${base}(_props: any = {}) {`,
    `  return <div data-skeleton="${base}">SKELETON: ${base}</div>;`,
    "}",
    `export default ${base};`,
    "",
  ].join("\n");
}

function stubCsrf() {
  return [
    "// SKELETON: ambient compatibility stub — csrf (no feature owner; foundation still references)",
    "export function validateOrigin(_req: unknown): boolean {",
    "  return true;",
    "}",
    "export function getCsrfToken(): string {",
    '  return "SKELETON";',
    "}",
    "export function verifyCsrfToken(_token: string): boolean {",
    "  return true;",
    "}",
    "",
  ].join("\n");
}

const created = [];
for (const rel of files) {
  const abs = path.join(ROOT, rel);
  if (fs.existsSync(abs)) continue;
  let content;
  if (rel.endsWith(".tsx")) content = stubComponent(rel);
  else if (rel.endsWith("csrf.ts")) content = stubCsrf();
  else continue;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  created.push(rel);
}

// Add to knownStubs so Pass 7 sees them.
const store = JSON.parse(fs.readFileSync(STORE, "utf8"));
const set = new Set(store.knownStubs || []);
for (const f of created) set.add(f);
store.knownStubs = [...set].sort();
fs.writeFileSync(STORE, JSON.stringify(store, null, 2));

console.log(
  JSON.stringify(
    { created, knownStubsCount: store.knownStubs.length },
    null,
    2,
  ),
);
