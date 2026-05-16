# WarpOS 0.4.3 — Upgrade Notes

Single-fix release: `/warp:doctor`'s `manifest_stale` yellow is now
clearable in product repos.

## Re-bootstrap

```bash
powershell.exe -ExecutionPolicy Bypass \
  -File "C:\Users\Vladislav Zhirnov\Desktop\Claude\Projects\WarpOS\install.ps1" \
  -Target "$(cygpath -w "$PWD")" \
  -SkipPrompt
```

(PowerShell: `& "<canonical-path>\install.ps1" -Target (Get-Location).Path -SkipPrompt`.)

After re-bootstrap:

```
/warp:doctor
```

The `framework_manifest_stale` yellow should be gone. The remaining
yellow (~30 path-lint warnings in framework scripts) is a known
cosmetic issue, not blocking.

## What's in the product's framework-manifest.json now

It's a local-regen reflecting the product's file tree — typically
~488 assets for a product with project-specific commands/agents, vs
~478 in the canonical. Commit it. Future installs regen to the same
content as long as your file tree doesn't change.

## Rollback

```
/warp:update --to 0.4.2 --apply
```

Note: rolling back leaves the doctor yellow in place. Stay on 0.4.3.
