@echo off
title DnDCast Deploy
cd /d "%~dp0"

REM NOTE: npm and pm2 are .cmd scripts on Windows. A .bat must invoke them with
REM `call`, otherwise control transfers and never returns — the rest of THIS
REM script (including the restart and the final pause) would be silently skipped.

echo.
echo === DnDCast Deploy ===
echo.

echo [1/3] Pulling latest changes from main...
git pull origin main
if %ERRORLEVEL% neq 0 (
    echo ERROR: git pull failed. Check for local conflicts.
    goto end
)

echo.
echo [2/3] Installing dependencies...
call npm install --omit=dev
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm install failed.
    goto end
)

echo.
echo [3/3] Restarting server...
call pm2.cmd restart dndcast
if %ERRORLEVEL% neq 0 (
    echo ERROR: PM2 restart failed. Is PM2 running?
    echo Try: pm2.cmd start server.js --name dndcast
    goto end
)

echo.
echo === Deploy complete ===
echo.
call pm2.cmd status

:end
echo.
echo --- Done. This window will stay open; press a key to close it. ---
pause >nul
