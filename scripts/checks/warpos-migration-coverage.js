#!/usr/bin/env node
// check:warpos-migration-coverage — STUB.
// For every breaking change between adjacent canonical versions, is there a
// migration script? Walk framework/releases/X/changelog.md, extract breaking-change
// markers, verify a migration exists at migrations/{prev}-to-{X}/.
//
// Refine via /reasoning:run with this prompt:
// "Design a check that detects 'breaking change shipped without migration script.'
//  What constitutes 'breaking' in a paths registry, hooks registry, agent spec,
//  or skill? How do you machine-detect it from a changelog: keyword scan, schema-version
//  diff, or both? How do you handle additive changes that breaking-look in diff
//  (e.g. new required schema field)?"
const JSON_OUT = process.argv.includes("--json");
const out = {
  ok: true,
  status: "stub",
  todo: "design via /reasoning:run before promoting beyond stub",
};
if (JSON_OUT) console.log(JSON.stringify(out));
else
  console.log(
    "OK   [warpos-migration-coverage] STUB — design via /reasoning:run",
  );
process.exit(0);
