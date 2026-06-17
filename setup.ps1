# WhatsApp AI Dashboard - One-click setup
# Run: powershell -ExecutionPolicy Bypass -File .\setup.ps1

$ErrorActionPreference = "Stop"

# Resolve the folder this script lives in (multiple fallbacks)
$Root = $null
if ($PSScriptRoot)                      { $Root = $PSScriptRoot }
elseif ($PSCommandPath)                 { $Root = Split-Path -Parent $PSCommandPath }
elseif ($MyInvocation.MyCommand.Path)   { $Root = Split-Path -Parent $MyInvocation.MyCommand.Path }
else                                    { $Root = (Get-Location).Path }

Set-Location $Root

Write-Host ""
Write-Host "=== WhatsApp AI Dashboard Setup ===" -ForegroundColor Cyan
Write-Host "Working in: $Root"
Write-Host ""

# -- 1. Root .env --------------------------------------------------------------
$rootEnv     = Join-Path $Root ".env"
$rootExample = Join-Path $Root ".env.example"
Write-Host "Checking $rootEnv ..." -ForegroundColor DarkGray
if (Test-Path $rootEnv) {
    Write-Host "[.env]        already exists - skipping" -ForegroundColor Yellow
} else {
    Copy-Item $rootExample $rootEnv -ErrorAction Stop
    Write-Host "[.env]        created from .env.example" -ForegroundColor Green
}

# -- 2. whatsapp-brain .env ----------------------------------------------------
$brainEnv     = Join-Path $Root "whatsapp-brain\.env"
$brainExample = Join-Path $Root "whatsapp-brain\.env.example"
Write-Host "Checking $brainEnv ..." -ForegroundColor DarkGray
if (Test-Path $brainEnv) {
    Write-Host "[brain/.env]  already exists - skipping" -ForegroundColor Yellow
} else {
    Copy-Item $brainExample $brainEnv -ErrorAction Stop
    Write-Host "[brain/.env]  created from whatsapp-brain/.env.example" -ForegroundColor Green
}

Write-Host ""

# -- 3. Node dependencies (bot) ------------------------------------------------
Write-Host "Installing bot Node dependencies..." -ForegroundColor Cyan
$ErrorActionPreference = "Continue"
npm install
if ($LASTEXITCODE -ne 0) { Write-Host "npm install failed" -ForegroundColor Red; exit 1 }

# -- 4. Frontend install + build -----------------------------------------------
Write-Host ""
Write-Host "Installing frontend dependencies and building..." -ForegroundColor Cyan
Set-Location (Join-Path $Root "frontend")
npm install
if ($LASTEXITCODE -ne 0) { Write-Host "frontend npm install failed" -ForegroundColor Red; exit 1 }
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "frontend build failed" -ForegroundColor Red; exit 1 }
Set-Location $Root

# -- 5. Python dependencies (brain) --------------------------------------------
Write-Host ""
Write-Host "Installing brain Python dependencies..." -ForegroundColor Cyan
pip install -r (Join-Path $Root "whatsapp-brain\requirements.txt")
if ($LASTEXITCODE -ne 0) { Write-Host "pip install failed" -ForegroundColor Red; exit 1 }

# -- Done ----------------------------------------------------------------------
Write-Host ""
Write-Host "=== Setup complete! ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next: open .env and whatsapp-brain/.env and add your OPENAI_API_KEY" -ForegroundColor Yellow
Write-Host "  (leave empty to use Ollama instead)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Then start the project:" -ForegroundColor Cyan
Write-Host "  .\start-all.bat" -ForegroundColor White
Write-Host ""
