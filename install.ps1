# install.ps1 - WarpOS installer (PowerShell, Windows-first)
#
# Phase 4 prereq (2026-04-30). Designed from scratch - no prior install.ps1
# was preserved. Mirrors the contract documented in:
#   - paths.json $schema "warpos/paths/v4"
#   - framework-manifest.json $schema "warpos/framework-manifest/v2"
#   - version.json $schema "warpos/version/v1"
#   - sprint workflow $schema "warpos/sprint/*/v1"  (Sprint v0.1, 0.4.0)
#
# Usage:
#   .\install.ps1                    # install into current directory
#   .\install.ps1 -Target C:\path     # install into <Target>
#   .\install.ps1 -DryRun             # show plan only, no writes
#   .\install.ps1 -SkipPrompt          # accept defaults; non-interactive
#   .\install.ps1 -Update              # call /warp:update path instead
#
# What's installed:
#   - Framework assets enumerated in .claude\framework-manifest.json
#     (agents, hooks, commands, schemas, templates, reference docs,
#     scripts/warpos, scripts/sprint, scripts/paths, scripts/hooks, etc.)
#   - .claude\framework-installed.json snapshot for /warp:update
#
# What is NOT installed:
#   - Live runtime state (.claude\runtime\, .claude\project\events\,
#     .claude\project\memory\, .claude\project\sprint\, etc.) - these are
#     written by the agent / sprint commands at runtime.
#   - issues.md (repo root) - created on first /sprint:plan or by
#     `node scripts\sprint\init.js`.

param(
    [string]$Target = (Get-Location).Path,
    [switch]$DryRun,
    [switch]$SkipPrompt,
    [switch]$Update
)

$ErrorActionPreference = "Stop"
# Fallback only - version.json is the source of truth, read below.
$Script:WARPOS_VERSION = "0.4.3"

function Write-Step($msg) { Write-Host "[install] $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "[install] WARN: $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "[install] ERR: $msg" -ForegroundColor Red }

# Pre-flight: source repo (where this script lives) must contain the artifacts
$Source = Split-Path -Parent $MyInvocation.MyCommand.Path
foreach ($req in @(".claude\framework-manifest.json", ".claude\paths.json", "version.json")) {
    if (-not (Test-Path (Join-Path $Source $req))) {
        Write-Err "Source repo missing required file: $req"
        Write-Err "Run install.ps1 from the WarpOS repo root, not a copy."
        exit 1
    }
}

$VersionFile = Get-Content (Join-Path $Source "version.json") -Raw | ConvertFrom-Json
if ($VersionFile.version -ne $Script:WARPOS_VERSION) {
    Write-Warn "version.json reports $($VersionFile.version), script expects $Script:WARPOS_VERSION - proceeding with $($VersionFile.version)"
    $Script:WARPOS_VERSION = $VersionFile.version
}

Write-Step "WarpOS $Script:WARPOS_VERSION installer"
Write-Step "Source: $Source"
Write-Step "Target: $Target"
if ($DryRun)      { Write-Step "Mode:   DRY-RUN (no files written)" }
elseif ($Update)  { Write-Step "Mode:   UPDATE (delegate to /warp:update - fresh-copy path skipped)" }
else              { Write-Step "Mode:   FRESH-INSTALL" }

# Pre-existing install detection. Keep this before the -Update branch so
# update mode can test the path without referencing an undefined variable.
$ExistingInstall = Join-Path $Target ".claude\framework-installed.json"

# Fix-forward (codex Phase 4 review 2026-04-30): -Update advertised
# delegation but then fell through to Copy-Item -Force, overwriting the
# existing install. The delegation was cosmetic. Now: -Update bails out
# before Stage 1, telling the operator to use the slash command instead.
if ($Update) {
    if (-not (Test-Path $ExistingInstall)) {
        Write-Err "-Update requires an existing WarpOS install at $Target. Run install.ps1 without -Update for a fresh install first."
        exit 1
    }
    Write-Step ""
    Write-Step "/warp:update is the canonical update path - install.ps1 -Update no longer copies files."
    Write-Step "Open the project in Claude Code and run:"
    Write-Step "    /warp:update                     # dry-run"
    Write-Step "    /warp:update --apply             # apply (when 0.1.x lands)"
    Write-Step ""
    Write-Step "Why: a fresh-copy under -Update silently overwrote local customizations."
    Write-Step "     /warp:update uses the 12-category classifier and respects mergeStrategy."
    exit 0
}

if (Test-Path $ExistingInstall) {
    $Existing = Get-Content $ExistingInstall -Raw | ConvertFrom-Json
    Write-Warn "Existing WarpOS install detected: version=$($Existing.installedVersion) commit=$($Existing.installedCommit.Substring(0, [Math]::Min(8, $Existing.installedCommit.Length)))"
    if (-not $Update -and -not $SkipPrompt) {
        $resp = Read-Host "Continue with FRESH install (overwrites)? [y/N]"
        if ($resp -ne "y") {
            Write-Step "Aborted - use -Update to upgrade in-place"
            exit 0
        }
    }
}

# Read framework-manifest to enumerate assets
$Manifest = Get-Content (Join-Path $Source ".claude\framework-manifest.json") -Raw | ConvertFrom-Json
$AssetCount = 0
foreach ($kind in $Manifest.assets.PSObject.Properties.Name) {
    $AssetCount += $Manifest.assets.$kind.Count
}
Write-Step "$AssetCount assets to install across $($Manifest.counts.PSObject.Properties.Count) kinds"

if ($DryRun) {
    Write-Step "DRY-RUN: would install $AssetCount assets to $Target"
    Write-Step "DRY-RUN: would write framework-installed.json at $Target\.claude\"
    Write-Step "DRY-RUN: complete. No files written."
    exit 0
}

# Stage 1 - copy framework-owned assets and record per-asset SHA256.
# Phase 4 fix-forward (codex review 2026-04-30 critical #2): the prior
# revision left assets[] and installedHash empty, which made every
# downstream /warp:update misclassify all files as MERGE_CONFLICT. Now we
# hash each copied byte and record it in $InstalledAssets for Stage 2.
Write-Step "Stage 1/3 - copying assets"
$Copied = 0
$Skipped = 0
$InstalledAssets = @()
foreach ($kind in $Manifest.assets.PSObject.Properties.Name) {
    foreach ($asset in $Manifest.assets.$kind) {
        $srcPath  = Join-Path $Source $asset.src
        $destPath = Join-Path $Target $asset.dest
        if (-not (Test-Path $srcPath)) {
            Write-Warn "Source missing: $($asset.src) - skipped"
            $Skipped += 1
            continue
        }
        $destDir = Split-Path -Parent $destPath
        if (-not (Test-Path $destDir)) {
            New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        }
        Copy-Item -Path $srcPath -Destination $destPath -Force
        $Copied += 1
        $hash = (Get-FileHash -Path $destPath -Algorithm SHA256).Hash.ToLower()
        $InstalledAssets += [ordered]@{
            id              = $asset.id
            kind            = $asset.kind
            dest            = $asset.dest
            owner           = $asset.owner
            mergeStrategy   = $asset.mergeStrategy
            installedHash   = $hash
            currentHashAtInstall = $hash
            introducedIn    = $asset.introducedIn
        }
    }
}
Write-Step "Stage 1/3 - copied $Copied, skipped $Skipped, hashed $($InstalledAssets.Count)"

# Stage 2 - write framework-installed.json snapshot
Write-Step "Stage 2/3 - writing install snapshot"
$installRecord = [ordered]@{
    "`$schema"          = "warpos/framework-installed/v2"
    installedVersion    = $Script:WARPOS_VERSION
    installedCommit     = (git -C $Source rev-parse HEAD 2>$null)
    installedAt         = (Get-Date -Format "o")
    source              = $Source
    target              = $Target
    pathRegistryVersion = "v4"
    manifestSchema      = "warpos/framework-manifest/v2"
    assets              = $InstalledAssets
    generated           = @(
        ".claude/paths.json",
        ".claude/manifest.json",
        ".claude/settings.json",
        ".claude/agents/store.json",
        ".claude/framework-installed.json"
    )
}
# 0.4.2 fix-forward: PowerShell 5.1's `Out-File -Encoding utf8` writes
# UTF-8 WITH BOM. JSON.parse rejects BOM. Use .NET WriteAllText with an
# explicit no-BOM UTF-8 encoding so /warp:update can re-read the snapshot.
$installRecordJson = $installRecord | ConvertTo-Json -Depth 10
$installRecordPath = Join-Path $Target ".claude\framework-installed.json"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($installRecordPath, $installRecordJson, $utf8NoBom)
Write-Step "Stage 2/3 - snapshot at .claude\framework-installed.json (no BOM)"

# 0.4.3 fix-forward: regenerate framework-manifest.json against the
# target's actual file tree instead of copying the canonical's snapshot.
# 0.4.2 copied canonical's manifest (473 assets), but in product repos
# generate-framework-manifest.js scans the target and finds 488+ (extra
# project-specific commands/agents). The doctor's "manifest_stale"
# check compared local file to local regen, so the install copy was
# always wrong in product repos. Now: write the manifest by running the
# generator against the target's own scripts. The first install copies
# generate-framework-manifest.js as an asset; we invoke that copy.
$GeneratorPath = Join-Path $Target "scripts\generate-framework-manifest.js"
if (Test-Path $GeneratorPath) {
    Push-Location $Target
    try {
        & node $GeneratorPath 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Step "Stage 2/3 - framework-manifest.json regenerated against $Target ($Script:WARPOS_VERSION)"
        } else {
            Write-Warn "framework-manifest.json regenerator returned $LASTEXITCODE - falling back to canonical copy"
            Copy-Item -Path (Join-Path $Source ".claude\framework-manifest.json") -Destination (Join-Path $Target ".claude\framework-manifest.json") -Force
        }
    } finally {
        Pop-Location
    }
} else {
    # No generator on target (very fresh install). Fall back to copying the
    # canonical snapshot; the next install run will regenerate locally.
    $ManifestSrc = Join-Path $Source ".claude\framework-manifest.json"
    $ManifestDst = Join-Path $Target ".claude\framework-manifest.json"
    $ManifestDstDir = Split-Path -Parent $ManifestDst
    if (-not (Test-Path $ManifestDstDir)) {
        New-Item -ItemType Directory -Path $ManifestDstDir -Force | Out-Null
    }
    Copy-Item -Path $ManifestSrc -Destination $ManifestDst -Force
    Write-Step "Stage 2/3 - framework-manifest.json copied from canonical (no generator on target yet)"
}

# Stage 3 - post-install hint
Write-Step "Stage 3/3 - install complete"
Write-Step "Next step: open the project in Claude Code; run /warp:health or /warp:doctor to verify."
if ($Update) {
    Write-Step "UPDATE mode: now run /warp:update --dry-run from inside the project to plan deltas."
}

# Sprint Workflow v0.1 (0.4.0+) - opt-in adoption note.
$SprintSchemaDir = Join-Path $Target "schemas\sprint"
if (Test-Path $SprintSchemaDir) {
    Write-Step ""
    Write-Step "Sprint Workflow v0.1 is available in this install."
    Write-Step "To opt in: node scripts\sprint\init.js --project ""<your project>"""
    Write-Step "Then in Claude Code: /sprint:plan ""<brief plain-language request>"""
    Write-Step "Reference: paths.sprintReference (.claude\project\reference\sprint-workflow.md)"
    Write-Step "Docs:      _docs\sprint\ (OVERVIEW, DOWNSTREAM_ADOPTION, CRASH_RECOVERY, etc.)"
    Write-Step ""
    Write-Step "Existing /mode:solo, /mode:adhoc, /mode:oneshot keep working unchanged."
    Write-Step "Sprint is ADDITIVE - opt out by not running /sprint:* commands."
}

exit 0
