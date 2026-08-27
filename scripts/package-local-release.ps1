<#
.SYNOPSIS
  Positron local release packager — creates a distributable local release folder.

.DESCRIPTION
  Creates a .local-release/positron/ folder containing a README_START_HERE.md
  with version info, commit SHA, and start instructions. Copies the start scripts
  and essential config files. Does NOT commit build artifacts or node_modules.

  Usage:  .\scripts\package-local-release.ps1
          .\scripts\package-local-release.ps1 -WhatIf   (dry-run)
          .\scripts\package-local-release.ps1 -Help     (show this help)

.OUTPUTS
  Creates .local-release/positron/ with start instructions and scripts.
  This folder is gitignored — it is not committed.
#>
param(
    [switch]$Help,
    [switch]$WhatIf
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($Help) {
    Get-Help $PSCommandPath -Detailed
    exit 0
}

# ------------------------------------------------------------------
# Detect repo root
# ------------------------------------------------------------------
$ScriptDir = Split-Path -Parent $PSCommandPath
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
Set-Location $RepoRoot

Write-Host "=== Positron Local Release Packager ===" -ForegroundColor Green
Write-Host "Repo root: $RepoRoot"

if (-not (Test-Path "package.json")) {
    Write-Error "ERROR: package.json not found at $RepoRoot - not a valid Positron repo."
    exit 1
}

# ------------------------------------------------------------------
# Gather metadata
# ------------------------------------------------------------------
$version = "0.1.0"
try {
    $pkg = Get-Content "package.json" -Raw | ConvertFrom-Json
    $version = $pkg.version
} catch { }

$commit = ""
try {
    $commit = (git rev-parse --short HEAD 2>&1).ToString().Trim()
} catch {
    $commit = "unknown"
}

$date = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
$branch = ""
try {
    $branch = (git branch --show-current 2>&1).ToString().Trim()
} catch {
    $branch = "unknown"
}

Write-Host "  Version : $version"
Write-Host "  Commit  : $commit"
Write-Host "  Branch  : $branch"
Write-Host "  Date    : $date"

# ------------------------------------------------------------------
# Release folder
# ------------------------------------------------------------------
$ReleaseDir = Join-Path $RepoRoot ".local-release\positron"
Write-Host ""
Write-Host "Release folder: $ReleaseDir"

if (-not $WhatIf) {
    if (Test-Path $ReleaseDir) {
        Write-Host "  Cleaning existing release folder ..."
        Remove-Item -Recurse -Force $ReleaseDir
    }
    New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null
} else {
    Write-Host "[DRY-RUN] Would create: $ReleaseDir"
    Write-Host "[DRY-RUN] Would generate: README_START_HERE.md"
    Write-Host "[DRY-RUN] Would copy start scripts and config references."
    Write-Host "[DRY-RUN] Release folder would NOT be committed (gitignored)."
    exit 0
}

# ------------------------------------------------------------------
# Generate README_START_HERE.md
# ------------------------------------------------------------------
$readmeContent = @"
# Positron Local Release — Start Here

## Package Info

| Field | Value |
|-------|-------|
| **Version** | $version |
| **Commit** | `$commit` |
| **Branch** | `$branch` |
| **Packaged** | $date |
| **Repo** | https://github.com/Mueller-Systems-Lab/Positron (private) |

## Prerequisites

- **Node.js** >= 22 (https://nodejs.org/)
- **npm** >= 10 (comes with Node.js)
- **Git** (for cloning, optional for installed packages)

## Quick Start

### 1. Install

```powershell
.\scripts\install-local.ps1
```

This checks Node.js/npm, installs dependencies, and builds the project.

### 2. Start

```powershell
.\scripts\start-local.ps1
```

Starts the Express server (http://localhost:3000) and Vite web UI (http://localhost:5173).

### 3. Package

```powershell
.\scripts\package-local-release.ps1
```

Creates this release folder with documentation and start scripts.

## Alternative: Docker (Full Stack)

```bash
docker compose up --build
# -> http://localhost:5173 (nginx reverse proxy)
# Includes: server, worker, Redis, nginx
```

## Directory Structure

```
Positron/
├── apps/
│   ├── server/     # Express/TypeScript Backend (Port 3000)
│   ├── web/        # React/Vite/Tailwind Frontend (Port 5173)
│   └── worker/     # BullMQ Worker (needs Redis)
├── packages/       # Shared libraries + adapters
├── scripts/        # install, start, package scripts
└── docs/           # Documentation, evidence, ADRs
```

## Tests

```bash
npm test                    # current root + Web suite; see current status docs
npm test --workspace apps/web  # current frontend suite
```

## Known Limitations

- **GitHub Actions**: check current workflow status before relying on CI
- **GitHub-CI**: required contexts are documented in the current status page
- **Repo**: public source repository; no production distribution claim
- **Docker**: requires Redis for full production stack
- **Worker**: needs Redis (via Docker or local Redis install)

## Configuration

Copy `.env.example` to `apps/server/.env` and configure:
- `GITHUB_MODE`: `fake` (default, no GitHub access needed)
- `POSITRON_SPECKIT_MODE`: `fake` (default)
- `POSITRON_OPENCODE_MODE`: `fake` (default)

No secrets are needed for local development with `fake` mode.

## Support

- Issue tracker: https://github.com/Mueller-Systems-Lab/Positron/issues
- Docs: `docs/install/windows-local-installer.md`

---

*Generated by Positron Local Release Packager — $date*
"@

$readmePath = Join-Path $ReleaseDir "README_START_HERE.md"
Set-Content -Path $readmePath -Value $readmeContent -Encoding UTF8
Write-Host "  Created: README_START_HERE.md"

# ------------------------------------------------------------------
# Copy start scripts
# ------------------------------------------------------------------
$scriptsSource = Join-Path $RepoRoot "scripts"
$scriptsDest = Join-Path $ReleaseDir "scripts"
if (-not (Test-Path $scriptsDest)) {
    New-Item -ItemType Directory -Path $scriptsDest -Force | Out-Null
}

@("install-local.ps1", "start-local.ps1", "package-local-release.ps1") | ForEach-Object {
    $src = Join-Path $scriptsSource $_
    $dst = Join-Path $scriptsDest $_
    if (Test-Path $src) {
        Copy-Item $src $dst -Force
        Write-Host "  Copied: scripts\$_"
    }
}

# ------------------------------------------------------------------
# Copy install docs reference
# ------------------------------------------------------------------
$docsInstallSource = Join-Path $RepoRoot "docs\install\windows-local-installer.md"
$docsDest = Join-Path $ReleaseDir "docs"
if (Test-Path $docsInstallSource) {
    if (-not (Test-Path $docsDest)) {
        New-Item -ItemType Directory -Path $docsDest -Force | Out-Null
    }
    Copy-Item $docsInstallSource $docsDest -Force
    Write-Host "  Copied: docs\install\windows-local-installer.md"
}

# ------------------------------------------------------------------
# Generate manifest
# ------------------------------------------------------------------
$manifestContent = @"
# Positron Local Release Manifest
version: $version
commit: $commit
branch: $branch
date: $date
repo: https://github.com/Mueller-Systems-Lab/Positron (private)
node_min: 22
node_current: $((node --version 2>&1).ToString().Trim())
npm: $((npm --version 2>&1).ToString().Trim())
"@

$manifestPath = Join-Path $ReleaseDir "MANIFEST.txt"
Set-Content -Path $manifestPath -Value $manifestContent -Encoding UTF8
Write-Host "  Created: MANIFEST.txt"

# ------------------------------------------------------------------
# Done
# ------------------------------------------------------------------
Write-Host ""
Write-Host "=== Release package created ===" -ForegroundColor Green
Write-Host ""
Write-Host "Location: $ReleaseDir"
Write-Host "Contents:"
Get-ChildItem $ReleaseDir -Recurse -File | ForEach-Object {
    $relPath = $_.FullName.Substring($ReleaseDir.Length + 1)
    Write-Host "  $relPath"
}
Write-Host ""
Write-Host "Note: This folder is gitignored (.local-release/) and not committed."
exit 0
