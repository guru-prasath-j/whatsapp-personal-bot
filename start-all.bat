@echo off
title WhatsApp AI - Launcher

echo ============================================
echo  WhatsApp AI - Starting all services...
echo ============================================
echo.

:: Kill any stale processes on port 8000 (whatsapp-brain) before starting
echo [0/3] Clearing stale processes on port 8000...
for /f "tokens=5" %%a in ('netstat -ano -p TCP 2^>nul ^| findstr ":8000 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)

:: Start whatsapp-brain (Python RAG server) in its own window
echo [1/3] Starting whatsapp-brain on port 8000...
start "WhatsApp Brain (RAG Server - port 8000)" cmd /k "cd /d E:\Whatsapp-ai-dashboard\whatsapp-personal-bot && npm run brain"

:: Give the RAG server 8 seconds to boot and index docs before the bot connects
echo     Waiting 8 seconds for RAG server to boot and index docs...
timeout /t 8 /nobreak >nul

:: Start whatsapp-personal-bot (Node.js) in its own window
echo [2/3] Starting whatsapp-personal-bot on port 3001...
start "WhatsApp Bot (Dashboard - port 3001)" cmd /k "cd /d E:\Whatsapp-ai-dashboard\whatsapp-personal-bot && npm start"

:: Start frontend dev server in its own window
echo [3/3] Starting frontend dev server on port 5173...
start "Frontend Dev (port 5173)" cmd /k "cd /d E:\Whatsapp-ai-dashboard\whatsapp-personal-bot\frontend && npm run dev"

echo.
echo ============================================
echo  All three services are starting:
echo    Brain     -> http://localhost:8000
echo    Dashboard -> http://localhost:3001
echo    Frontend  -> http://localhost:5173
echo ============================================
echo.
echo  Close this window whenever you like.
echo  To stop: close the three service windows.
pause
