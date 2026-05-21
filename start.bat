@echo off
setlocal EnableDelayedExpansion

echo ==========================================
echo   LzrCnc Smart Start (Windows)
echo ==========================================

:: Function to kill process on port
call :KillPort 3000
call :KillPort 3001

echo.
echo Starting LzrCnc...
echo   - Client: http://localhost:3000
echo   - Server: http://localhost:3001
echo.

cd soft
call npm run dev
cd ..
pause
exit /b

:KillPort
set "port=%~1"
for /f "tokens=5" %%a in ('netstat -aon ^| find ":%port%" ^| find "LISTENING"') do (
    echo [AUTO-KILL] Port %port% is in use by PID %%a. Killing...
    taskkill /F /PID %%a >nul 2>&1
)
exit /b 0
