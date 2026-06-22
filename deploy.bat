@echo off
title DnDCast Deploy
cd /d "%~dp0"

echo.
echo === DnDCast Deploy ===
echo.

echo [1/3] Pulling latest changes from main...
git pull origin main
if %ERRORLEVEL% neq 0 (
    echo ERROR: git pull failed. Check for local conflicts.
    pause
    exit /b 1
)

echo.
echo [2/3] Installing dependencies...
npm install --omit=dev
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
)

echo.
echo [3/3] Restarting server...
pm2.cmd restart dndcast
if %ERRORLEVEL% neq 0 (
    echo ERROR: PM2 restart failed. Is PM2 running?
    echo Try: pm2.cmd start server.js --name dndcast
    pause
    exit /b 1
)

echo.
echo === Deploy complete ===
echo.
pm2.cmd status
echo.
pause
