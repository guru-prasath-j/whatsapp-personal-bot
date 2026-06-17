# WhatsApp AI Dashboard — One-click setup
# Run: powershell -ExecutionPolicy Bypass -File .\setup.ps1

# Always work from the folder this script lives in
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host ""
Write-Host "=== WhatsApp AI Dashboard Setup ===" -ForegroundColor Cyan
Write-Host ""

# ── 1. Root .env ──────────────────────────────────────────────────────────────
if (Test-Path ".env") {
    Write-Host "[.env]        already exists — skipping" -ForegroundColor Yellow
} else {
    Copy-Item ".env.example" ".env"
    Write-Host "[.env]        created from .env.example" -ForegroundColor Green
}

# ── 2. whatsapp-brain .env ────────────────────────────────────────────────────
if (Test-Path "whatsapp-brain\.env") {
    Write-Host "[brain/.env]  already exists — skipping" -ForegroundColor Yellow
} else {
    Copy-Item "whatsapp-brain\.env.example" "whatsapp-brain\.env"
    Write-Host "[brain/.env]  created from whatsapp-brain/.env.example" -ForegroundColor Green
}

Write-Host ""

# ── 3. Node dependencies (root / bot) ────────────────────────────────────────
Write-Host "Installing bot Node dependencies..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { Write-Host "npm install failed" -ForegroundColor Red; exit 1 }

# ── 4. Frontend install + build ───────────────────────────────────────────────
Write-Host ""
Write-Host "Installing frontend dependencies and building..." -ForegroundColor Cyan
Set-Location "frontend"
npm install
if ($LASTEXITCODE -ne 0) { Write-Host "frontend npm install failed" -ForegroundColor Red; exit 1 }
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "frontend build failed" -ForegroundColor Red; exit 1 }
Set-Location ".."

# ── 5. Python dependencies (brain) ───────────────────────────────────────────
Write-Host ""
Write-Host "Installing brain Python dependencies..." -ForegroundColor Cyan
pip install -r "whatsapp-brain\requirements.txt"
if ($LASTEXITCODE -ne 0) { Write-Host "pip install failed" -ForegroundColor Red; exit 1 }

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== Setup complete! ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next step: open .env and whatsapp-brain/.env and set OPENAI_API_KEY" -ForegroundColor Yellow
Write-Host "  (leave empty to use Ollama instead)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Then run the project:" -ForegroundColor Cyan
Write-Host "  .\start-all.bat" -ForegroundColor White
Write-Host ""
