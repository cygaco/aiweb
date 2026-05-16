# WarpOS 0.4.1 — Upgrade Notes

Target: `0.4.0 → 0.4.1` (or `0.2.2 → 0.4.1` skipping the 0.3.0/0.4.0
gap).

## TL;DR

Update-path UX fix. `/warp:update --to <v>` now auto-discovers a
sibling canonical clone instead of bailing on a stale local
`framework/releases/`. No other changes from 0.4.0.

## Steps

```text
/warp:update --to 0.4.1                # dry-run plan
/warp:update --to 0.4.1 --apply        # apply
```

After apply:

```bash
node scripts/paths/build.js --check
node scripts/paths/gate.js
node scripts/hooks/build.js --check
node scripts/hooks/test.js
node scripts/sprint/validate.js
node scripts/sprint/routing.js validate
```

## Bootstrap (one-time only)

If your product repo's update.js is older than 0.4.1, it doesn't have
auto-discovery yet. Bootstrap once from the canonical:

```powershell
cd "<path-to-canonical-WarpOS>"
.\install.ps1 -Target "<product-path>" -SkipPrompt
```

This refreshes the product's framework files (including update.js +
the 0.4.0 + 0.4.1 capsules). Runtime state
(`.claude/runtime/`, `.claude/project/events/`, `.claude/project/memory/`,
`.claude/project/sprint/`) is preserved — install.ps1 only writes
framework-owned files per the manifest.

After bootstrap, every future `/warp:update --to <v>` works without
flags as long as the canonical clone lives at a discoverable path
(sibling, recorded in `.claude/manifest.json#warpos.source`, or
recorded in `.claude/framework-installed.json#source`).

## What changed in update.js

```diff
- const sourceRoot = opts.source ? path.resolve(opts.source) : REPO_ROOT;
+ let sourceRoot = opts.source ? path.resolve(opts.source) : REPO_ROOT;
+
+ if (!opts.source && target && !opts.noDiscover) {
+   const haveLocal = fs.existsSync(
+     path.join(sourceRoot, "framework", "releases", target, "release.json"),
+   );
+   if (!haveLocal) {
+     const discovered = discoverCanonical(targetRoot, target);
+     if (discovered) {
+       process.stderr.write(
+         `[update] capsule ${target} not in local framework/releases/ — using canonical at ${discovered}\n`,
+       );
+       sourceRoot = discovered;
+     }
+   }
+ }
```

Plus a new `discoverCanonical(targetRoot, version)` function that walks
sibling clones + manifest hints.

## What changed in /warp:update

The skill's Step 1 used to list local capsules if the target wasn't in
`framework/releases/<v>/`. It now delegates that check to the engine.
The engine prints the discovered canonical path verbatim when it falls
back.

## Rollback

```text
/warp:update --to 0.4.0 --apply
```

(Or any earlier version.) Rolling back doesn't touch
`.claude/project/sprint/` — sprint state persists across version
changes.

## See also

- `framework/releases/0.4.0/upgrade-notes.md` — Sprint Workflow v0.1
  + Phase 0 upgrade notes (still apply on the `0.2.2 → 0.4.1` path).
- `_docs/sprint/DOWNSTREAM_ADOPTION.md` — sprint adoption guide.
