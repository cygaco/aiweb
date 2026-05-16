# WarpOS 0.4.2 — 2026-05-11

Critical install-bug fix release. THREE bugs in 0.4.0/0.4.1 that
silently broke product installs. All product repos that installed
0.4.0 or 0.4.1 must re-bootstrap via `install.ps1` once.

## Bugs fixed

### 1. `scripts/sprint/` + `scripts/dispatch/` missing from manifest

`scripts/generate-framework-manifest.js` had an explicit allowlist of
script subdirectories to catalogue (`scripts/hooks`, `scripts/warpos`,
`scripts/paths`, etc.). Both `scripts/sprint/` (Sprint Workflow v0.1
engine — 14 files) and `scripts/dispatch/` (dispatch infrastructure —
13 files) were never added. Result: `install.ps1` and `/warp:update`
both iterated `Manifest.assets.<kind>` and never copied these files.

**Impact:** any product repo on 0.4.0/0.4.1 has `/sprint:plan`,
`/sprint:design`, `/sprint:execute`, `/sprint:release` slash commands
but no `scripts/sprint/plan.js`, `validate.js`, `init.js`, etc.
Calling the slash commands errors with file-not-found.

**Fix:** added `{ src: "scripts/sprint", kind: "sprint_engine" }` and
`{ src: "scripts/dispatch", kind: "dispatch_engine" }` to the scan
list. Manifest now ships 27 additional files (14 sprint + 13
dispatch).

### 2. `install.ps1` wrote `framework-installed.json` with UTF-8 BOM

PowerShell 5.1's `Out-File -Encoding utf8` emits UTF-8 with a leading
BOM (`EF BB BF`). `JSON.parse` rejects BOM. `/warp:update` reads
`.claude/framework-installed.json` on every run to classify
local-vs-installed drift; a BOM-prefixed snapshot raised a parse
error and the engine fell back to "no installed state", classifying
every file as `ADD_SAFE` (which usually just no-ops because the file
exists).

**Impact:** `/warp:doctor` flagged the BOM; `/warp:update`
silently misbehaved on every subsequent run.

**Fix:** replaced `Out-File -Encoding utf8` with
`[System.IO.File]::WriteAllText($path, $json, [System.Text.UTF8Encoding]::new($false))`
— `.NET`'s explicit no-BOM UTF-8 encoding.

### 3. `install.ps1` never copied `.claude/framework-manifest.json`

The installer iterated `Manifest.assets.<kind>` and copied each
asset, but the manifest file itself was not in `Manifest.assets`
(can't list itself). Result: the product's
`.claude/framework-manifest.json` stayed at the version present when
the product was last installed, even when newer assets were copied.

**Impact:** `/warp:doctor` always reported `manifest_stale` after an
install, because the product's manifest reported the OLD version
while `framework-installed.json` reported the new version.

**Fix:** added a Stage 2 step that explicitly copies
`<source>/.claude/framework-manifest.json` to
`<target>/.claude/framework-manifest.json`.

## Bundled

0.4.2 ships everything in 0.4.0 (Sprint Workflow v0.1 + Phase 0
follow-ons) + 0.4.1 (update.js auto-discovery) + the three fixes
above. Consumers on 0.2.2 jump straight to 0.4.2.

## Migration

`0.2.2 → 0.4.2`. No migrations required (additive).

**Re-bootstrap procedure (required for every product repo):**

```powershell
& "<path-to-canonical-WarpOS>\install.ps1" -Target (Get-Location).Path -SkipPrompt
```

Or from Bash:

```bash
powershell.exe -ExecutionPolicy Bypass \
  -File "<path-to-canonical-WarpOS>\install.ps1" \
  -Target "$(cygpath -w "$PWD")" \
  -SkipPrompt
```

After re-bootstrap, run `/warp:doctor` to confirm:
- `[GRN] framework_installed_bom` — no BOM
- `[GRN] framework_manifest_stale` — manifest at 0.4.2
- `[GRN] scripts_sprint` — engine scripts present
- `[GRN] scripts_dispatch` — engine scripts present

## See also

- `_docs/sprint/CHANGELOG_0.4.0.md` — Sprint Workflow v0.1.
- `framework/releases/0.4.0/changelog.md` — 0.4.0 release notes.
- `framework/releases/0.4.1/changelog.md` — 0.4.1 release notes.
