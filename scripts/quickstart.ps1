param(
  [switch]$Help,
  [switch]$DryRun,
  [switch]$Status,
  [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $PSScriptRoot
$ComposeFile = Join-Path $RootDir 'docker-compose.quickstart.yml'
$StateDir = Join-Path $RootDir '.positron\quickstart'
$EnvFile = Join-Path $StateDir 'demo.env'
$ProjectName = 'positron-quickstart'

function Show-Help {
  @'
Positron safe demo quickstart

Usage: powershell -ExecutionPolicy Bypass -File .\scripts\quickstart.ps1 [OPTION]

Parameters:
  -Help       Show this help.
  -DryRun     Check prerequisites and Compose syntax without starting services.
  -Status     Show service status and health without changing services.
  -Stop       Stop the demo services; keep local volumes and credentials.
'@
}

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw "required command not found: $Name" }
}

function Invoke-Compose([string[]]$Arguments) {
  & docker compose --project-name $ProjectName --env-file $EnvFile --file $ComposeFile @Arguments
}

function New-Secret {
  $bytes = New-Object byte[] 32
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return ([Convert]::ToHexString($bytes)).ToLowerInvariant()
}

function Ensure-Env {
  if (Test-Path $EnvFile) { return }
  New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
  @("REDIS_PASSWORD=$(New-Secret)", "POSITRON_ADMIN_TOKEN=$(New-Secret)") | Set-Content -Path $EnvFile -Encoding ascii
}

if ($Help) { Show-Help; exit 0 }
Require-Command 'docker'
docker compose version | Out-Null
if (-not (Test-Path $ComposeFile)) { throw "missing Compose file: $ComposeFile" }

if ($DryRun) {
  $env:REDIS_PASSWORD = 'dry-run-only'
  $env:POSITRON_ADMIN_TOKEN = 'dry-run-only'
  docker compose --project-name $ProjectName --file $ComposeFile config --quiet
  Remove-Item Env:REDIS_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:POSITRON_ADMIN_TOKEN -ErrorAction SilentlyContinue
  Write-Output 'quickstart dry-run: prerequisites and Compose syntax passed; no services started.'
  exit 0
}

Ensure-Env
if ($Status) {
  Invoke-Compose @('ps')
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://localhost:5173/api/health' | Out-Null; Write-Output 'Positron demo health: PASS' } catch { Write-Output 'Positron demo health: not ready'; exit 1 }
  exit 0
}
if ($Stop) {
  Invoke-Compose @('down')
  Write-Output 'Positron demo stopped. Local volumes and ignored credentials were kept.'
  exit 0
}

Invoke-Compose @('up', '--build', '--detach', '--remove-orphans')
for ($attempt = 1; $attempt -le 90; $attempt++) {
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://localhost:5173/api/health' | Out-Null; Write-Output 'Positron demo is ready: http://localhost:5173'; Write-Output 'Health endpoint: http://localhost:5173/api/health'; exit 0 } catch { Start-Sleep -Seconds 2 }
}
Invoke-Compose @('ps')
throw 'services did not become healthy in 180 seconds'
