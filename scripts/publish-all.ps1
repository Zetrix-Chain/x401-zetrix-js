# publish-all.ps1 — Build and publish the x401 npm packages to registry.npmjs.org
#
# Packages: x401-zetrix-server, x401-zetrix-client (both public, independent — no
# workspace deps between them, so publish order does not matter).
#
# Usage:
#   $env:NPM_TOKEN = "npm_xxxxxxxx..."
#   .\scripts\publish-all.ps1
#
# Optional flags:
#   .\scripts\publish-all.ps1 -DryRun            # simulate without uploading
#   .\scripts\publish-all.ps1 -Package server    # publish one package only (server|client)

param(
  [switch]$DryRun,
  [ValidateSet('server', 'client', '')]
  [string]$Package = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
if (-not $env:NPM_TOKEN) {
  Write-Error @"
NPM_TOKEN is not set. Set it before running:

  `$env:NPM_TOKEN = "npm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

Get a token at: https://www.npmjs.com -> Account -> Access Tokens -> Generate New Token (Automation)
"@
  exit 1
}

$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot

# ---------------------------------------------------------------------------
# Build (each package's prepublishOnly also runs build + coverage on publish)
# ---------------------------------------------------------------------------
Write-Host "`n==> Building all packages..." -ForegroundColor Cyan
pnpm build
if ($LASTEXITCODE -ne 0) { Write-Error "Build failed"; exit 1 }

# ---------------------------------------------------------------------------
# Publish helper
# ---------------------------------------------------------------------------
function Publish-Package {
  param([string]$name, [string]$dir)

  Write-Host "`n==> Publishing $name from $dir..." -ForegroundColor Cyan
  Push-Location "$repoRoot/$dir"

  $pnpmArgs = @('publish', '--access', 'public', '--no-git-checks')
  if ($DryRun) { $pnpmArgs += '--dry-run' }

  pnpm @pnpmArgs

  if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Error "Publish failed for $name"
    exit 1
  }

  Pop-Location
  Write-Host "  => $name published OK" -ForegroundColor Green
}

$dryLabel = if ($DryRun) { ' (DRY RUN)' } else { '' }
Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host "  x401-zetrix-js publish$dryLabel" -ForegroundColor Yellow
Write-Host "========================================`n" -ForegroundColor Yellow

switch ($Package) {
  'server' { Publish-Package 'x401-zetrix-server' 'packages/server' }
  'client' { Publish-Package 'x401-zetrix-client' 'packages/client' }
  default  {
    Publish-Package 'x401-zetrix-client' 'packages/client'
    Publish-Package 'x401-zetrix-server' 'packages/server'
  }
}

Write-Host "`n==> Done$dryLabel" -ForegroundColor Green
