@echo off
setlocal EnableExtensions
rem ==========================================================
rem  LzrCnc installer (Windows 10/11)
rem  Needs Node.js 22 LTS (or 20.19+) from https://nodejs.org/
rem  Installs the npm packages and builds the web UI.
rem  No administrator rights are needed.
rem ==========================================================

set "ROOT=%~dp0.."
set "SOFT=%ROOT%\soft"

echo ==========================================
echo   LzrCnc Windows installer
echo ==========================================

where node >nul 2>&1
if errorlevel 1 goto :nonode
for /f "tokens=1,2 delims=v." %%a in ('node -v') do (set "NMAJ=%%a" & set "NMIN=%%b")
set /a NVER=NMAJ*1000+NMIN
if %NVER% LSS 20019 goto :oldnode
if %NMAJ% EQU 21 goto :oldnode
if %NMAJ% EQU 22 if %NMIN% LSS 12 goto :oldnode
echo [CHECK] Node.js v%NMAJ%.%NMIN% found.

if not exist "%SOFT%\package.json" (
    echo [ERROR] soft\package.json not found - is the project folder complete?
    goto :fail
)

echo.
echo [1/2] Installing npm packages - this takes a few minutes...
pushd "%SOFT%"
call npm ci --no-audit --no-fund
if errorlevel 1 (
    echo [WARNING] npm ci failed, retrying with npm install...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        popd
        echo [ERROR] npm install failed.
        goto :fail
    )
)

echo.
echo [2/2] Building the web UI...
call npm run build:fast --workspace=client
if errorlevel 1 (
    popd
    echo [ERROR] Web UI build failed.
    goto :fail
)
popd

echo.
echo ==========================================
echo   Installation complete!
echo   Start LzrCnc:  start.bat        (real machine)
echo                  start.bat sim    (simulator)
echo   Then open http://localhost:3001
echo ==========================================
if "%LZRCNC_NO_PAUSE%"=="" pause
exit /b 0

:nonode
echo [ERROR] Node.js is not installed or not in PATH.
echo Install Node.js 22 LTS from https://nodejs.org/ then run this again.
goto :fail

:oldnode
echo [ERROR] Node.js v%NMAJ%.%NMIN% is too old. Install Node.js 22 LTS or newer from https://nodejs.org/
goto :fail

:fail
if "%LZRCNC_NO_PAUSE%"=="" pause
exit /b 1
