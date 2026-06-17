# WhatsApp AI Dashboard — One-click setup
# Run: .\setup.ps1

$Root = $PSScriptRoot

Write-Host ""
Write-Host "=== WhatsApp AI Dashboard Setup ===" -ForegroundColor Cyan
Write-Host ""

# ── 1. Root .env ──────────────────────────────────────────────────────────────
$rootEnv     = Join-Path $Root ".env"
$rootExample = Join-Path $Root ".env.example"

if (Test-Path $rootEnv) {
    Write-Host "[.env]        already exists — skipping" -ForegroundColor Yellow
} else {
    Copy-Item $rootExample $rootEnv
    Write-Host "[.env]        created from .env.example" -ForegroundColor Green
}

# ── 2. whatsapp-brain .env ────────────────────────────────────────────────────
$brainEnv     = Join-Path $Root "whatsapp-brain\.env"
$brainExample = Join-Path $Root "whatsapp-brain\.env.example"

if (Test-Path $brainEnv) {
    Write-Host "[brain/.env]  already exists — skipping" -ForegroundColor Yellow
} else {
    Copy-Item $brainExample $brainEnv
    Write-Host "[brain/.env]  created from whatsapp-brain/.env.example" -ForegroundColor Green
}

Write-Host ""

# ── 3. Node dependencies (root) ───────────────────────────────────────────────
Write-Host "Installing Node dependencies..." -ForegroundColor Cyan
Set-Location $Root
npm install
if ($LASTEXITCODE -ne 0) { Write-Host "npm install failed" -ForegroundColor Red; exit 1 }

# ── 4. Frontend build ─────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Building frontend..." -ForegroundColor Cyan
Set-Location (Join-Path $Root "frontend")
npm install
if ($LASTEXITCODE -ne 0) { Write-Host "frontend npm install failed" -ForegroundColor Red; exit 1 }
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "frontend build failed" -ForegroundColor Red; exit 1 }

# ── 5. Python dependencies ────────────────────────────────────────────────────
Write-Host ""
Write-Host "Installing Python dependencies..." -ForegroundColor Cyan
Set-Location $Root
pip install -r (Join-Path $Root "whatsapp-brain\requirements.txt")
if ($LASTEXITCODE -ne 0) { Write-Host "pip install failed" -ForegroundColor Red; exit 1 }

# ── Done ──────────────────────────────────────────────────────────────────────
Set-Location $Root
Write-Host ""
Write-Host "=== Setup complete! ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next step: open .env and whatsapp-brain/.env and set OPENAI_API_KEY" -ForegroundColor Yellow
Write-Host "  (leave empty to use Ollama instead)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Then run the project:" -ForegroundColor Cyan
Write-Host "  .\start-all.bat" -ForegroundColor White
Write-Host ""
