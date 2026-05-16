# WarpOS 0.4.2 — Upgrade Notes

CRITICAL fix release for 0.4.0/0.4.1. If you installed 0.4.0 or
0.4.1, you MUST re-bootstrap via `install.ps1` to receive missing
engine scripts and a corrected snapshot.

## TL;DR

Run this once in EACH product repo:

```bash
powershell.exe -ExecutionPolicy Bypass \
  -File "C:\Users\Vladislav Zhirnov\Desktop\Claude\Projects\WarpOS\install.ps1" \
  -Target "$(cygpath -w "$PWD")" \
  -SkipPrompt
```

(PowerShell native equivalent: `& "<canonical-path>\install.ps1" -Target (Get-Location).Path -SkipPrompt`.)

That's it. The new install:

- Ships `scripts/sprint/*` (14 files) and `scripts/dispatch/*` (13 files)
  that 0.4.0/0.4.1 silently omitted.
- Writes `framework-installed.json` without a UTF-8 BOM
  (PowerShell 5.1's `Out-File -Encoding utf8` was emitting BOM).
- Copies `.claude/framework-manifest.json` so the snapshot reflects
  the installed version.

## What was broken

| Symptom | Root cause | 0.4.2 fix |
|---|---|---|
| `/sprint:plan` errors "scripts/sprint/plan.js not found" | `scripts/sprint/` missing from manifest scan | Added as `kind: sprint_engine` |
| Dispatch errors referencing missing helpers | `scripts/dispatch/` missing from manifest scan (only `dispatch-agent.js` shipped) | Added as `kind: dispatch_engine` |
| `/warp:doctor` reports `framework_installed_bom RED` | `Out-File -Encoding utf8` writes UTF-8 with BOM in PS 5.1 | `.NET WriteAllText` + explicit no-BOM encoding |
| `/warp:doctor` reports `framework_manifest_stale` after every install | `install.ps1` never copied the manifest itself | Stage 2 now copies it explicitly |

## After re-bootstrap

```
/warp:doctor
```

Should report:

- `[GRN] capsule_integrity_0.4.2`
- `[GRN] framework_installed_bom` (no BOM)
- `[GRN] framework_manifest_stale` (manifest = 0.4.2)
- `[GRN]` sprint and dispatch scripts present

If you previously ran `/sprint:plan` against 0.4.0/0.4.1 and got
errors, those errors disappear after re-bootstrap because the
missing scripts are now present.

## Why didn't `/warp:update --to 0.4.2 --apply` just work

Because the OLD `update.js` in your product repo (from 0.4.0/0.4.1)
WAS shipped (the install.ps1 bug only missed `scripts/sprint/` and
`scripts/dispatch/`, not the warpos scripts). However, even if
update.js could fetch the new capsule, applying it correctly
requires reading `framework-installed.json` — which has the BOM bug.
So the safe path is `install.ps1` for this one-time fix-up, which
explicitly rewrites the snapshot without a BOM.

After the re-bootstrap, every subsequent update works via plain
`/warp:update --to <version> --apply`.

## Rollback

```
/warp:update --to 0.4.1 --apply
```

Note: rolling back to 0.4.1 leaves the install bugs in place. Stay
on 0.4.2+.

## See also

- `framework/releases/0.4.0/upgrade-notes.md`
- `framework/releases/0.4.1/upgrade-notes.md`
