# WarpOS 0.4.3 — 2026-05-11

Manifest-regen fix. 0.4.2's install.ps1 copied the canonical's
`framework-manifest.json` into product repos, but `/warp:doctor`'s
`manifest_stale` check compares the local file to what
`generate-framework-manifest.js` produces locally — and that includes
product-specific commands/agents that aren't in canonical. So 0.4.2
installs always reported yellow on the manifest check, forever.

## The fix

`install.ps1` Stage 2 now runs
`node scripts/generate-framework-manifest.js` against the target's
own scripts (which were copied in Stage 1), producing a manifest
that reflects the product's actual file tree. The doctor's check
compares the same file to the same generator → green.

Fallback: if the target doesn't have `scripts/generate-framework-manifest.js`
yet (very first install before any assets are copied), install.ps1
copies the canonical's manifest as a starter. The next install run
regenerates locally.

## Smoke verified

```
Stage 2/3 - framework-manifest.json regenerated against <target> (0.4.3)
manifest: version=0.4.3 total=478
```

Internally consistent — install copied 478 assets, manifest reports
478 assets, doctor's local-regen check matches.

## Migration

`0.4.2 → 0.4.3` (or any earlier → 0.4.3):

```bash
powershell.exe -ExecutionPolicy Bypass \
  -File "<canonical-path>\install.ps1" \
  -Target "$(cygpath -w "$PWD")" \
  -SkipPrompt
```

Then `/warp:doctor` — `manifest_stale` should clear.

The product's `.claude/framework-manifest.json` will now be the
local-regen view (with product-specific counts). Commit it. Future
installs will regenerate to the same content (no diff churn) as long
as the product's file tree doesn't change.

## See also

- `framework/releases/0.4.2/changelog.md` — what 0.4.2 fixed.
- `framework/releases/0.4.0/changelog.md` — Sprint Workflow v0.1.
