@echo off
setlocal EnableExtensions
rem ==========================================================
rem  LzrCnc launcher (Windows)
rem    start.bat          start LzrCnc (UI + API on one port, default 3001)
rem    start.bat sim      same, with the built-in GRBL simulator
rem    start.bat dev      developer mode: Vite :3000 (hot reload) + API :3001
rem    start.bat build    rebuild the web UI
rem    start.bat stop     stop LzrCnc
rem  Set LZRCNC_PORT to change the port, LZRCNC_NO_BROWSER=1 to not open a browser.
rem ==========================================================

set "ROOT=%~dp0"
set "SOFT=%ROOT%soft"
if "%LZRCNC_PORT%"=="" (set "PORT=3001") else (set "PORT=%LZRCNC_PORT%")
set "MODE=%~1"
if "%MODE%"=="" set "MODE=start"

if /I "%MODE%"=="stop" goto :stop
if /I "%MODE%"=="help" goto :help
if /I "%MODE%"=="-h" goto :help

call :checknode || goto :fail
call :deps || goto :fail

if /I "%MODE%"=="build" goto :build
if /I "%MODE%"=="dev" goto :dev
if /I "%MODE%"=="start" goto :run
if /I "%MODE%"=="sim" goto :run
echo [ERROR] Unknown command "%MODE%". Use: start ^| sim ^| dev ^| build ^| stop
goto :fail

:run
call :ensurebuild || goto :fail
call :freeport %PORT% || goto :fail
set "MOCK_HARDWARE="
if /I "%MODE%"=="sim" set "MOCK_HARDWARE=true"
echo ==========================================
if /I "%MODE%"=="sim" (echo   LzrCnc - simulator, no hardware) else (echo   LzrCnc)
echo   Open: http://127.0.0.1:%PORT%
echo   Stop: Ctrl+C or close this window
echo ==========================================
if not "%LZRCNC_NO_BROWSER%"=="1" start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 90;$i++){try{Invoke-WebRequest 'http://127.0.0.1:%PORT%/ping' -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process 'http://127.0.0.1:%PORT%'; break}catch{Start-Sleep 1}}"
cd /d "%SOFT%\server"
set "NODE_ENV=production"
node --disable-warning=DEP0205 --import tsx src/index.ts
goto :end

:dev
call :freeport 3000 || goto :fail
call :freeport 3001 || goto :fail
echo ==========================================
echo   LzrCnc developer mode
echo   Open: http://127.0.0.1:3000
echo ==========================================
cd /d "%SOFT%"
call npm run dev
goto :end

:build
call :ensurebuild force || goto :fail
echo [OK] Web UI built.
goto :end

:stop
call :freeport %PORT%
call :freeport 3000
echo [OK] LzrCnc stopped.
goto :end

:help
findstr /B /C:"rem  " "%~f0"
goto :end

rem ---------------------------------------------------------- helpers
:checknode
where node >nul 2>&1 || (echo [ERROR] Node.js is not installed. Run install\install.bat or get it from https://nodejs.org/ & exit /b 1)
set "NMAJ=" & set "NMIN="
for /f "tokens=1,2 delims=v." %%a in ('node -v') do (set "NMAJ=%%a" & set "NMIN=%%b")
set /a NVER=NMAJ*1000+NMIN
if %NVER% LSS 20019 goto :oldnode
if %NMAJ% EQU 21 goto :oldnode
if %NMAJ% EQU 22 if %NMIN% LSS 12 goto :oldnode
exit /b 0
:oldnode
echo [ERROR] Node.js v%NMAJ%.%NMIN% is too old. Install Node.js 22 LTS or newer from https://nodejs.org/
exit /b 1

:deps
if not exist "%SOFT%\node_modules\.package-lock.json" goto :dodeps
if not exist "%SOFT%\server\node_modules" goto :dodeps
powershell -NoProfile -Command "if((Get-Item (Join-Path $env:SOFT 'package-lock.json')).LastWriteTime -gt (Get-Item (Join-Path $env:SOFT 'node_modules\.package-lock.json')).LastWriteTime){exit 1}; exit 0"
if not errorlevel 1 exit /b 0
:dodeps
echo [SETUP] Installing dependencies (first start or package update)...
pushd "%SOFT%"
call npm install --no-audit --no-fund
set "ERR=%ERRORLEVEL%"
popd
if not "%ERR%"=="0" (echo [ERROR] npm install failed. & exit /b 1)
pushd "%SOFT%\node_modules" && (copy /b .package-lock.json +,, >nul 2>&1 & popd)
exit /b 0

:ensurebuild
if /I "%~1"=="force" goto :dobuild
powershell -NoProfile -Command "$i=Join-Path $env:SOFT 'client\dist\index.html'; if(!(Test-Path $i)){exit 1}; $t=(Get-Item $i).LastWriteTime; $c=Join-Path $env:SOFT 'client'; if(Get-ChildItem (Join-Path $c 'src'),(Join-Path $c 'public'),(Join-Path $c 'index.html'),(Join-Path $c 'package.json') -Recurse -File -ErrorAction SilentlyContinue | Where-Object LastWriteTime -gt $t | Select-Object -First 1){exit 1}; exit 0"
if not errorlevel 1 exit /b 0
:dobuild
echo [SETUP] Building the web UI...
pushd "%SOFT%"
call npm run build:fast --workspace=client
set "ERR=%ERRORLEVEL%"
popd
if not "%ERR%"=="0" (echo [ERROR] Web UI build failed. & exit /b 1)
exit /b 0

:freeport
rem Stop an old LzrCnc (node.exe) holding the port; never kill other programs.
set "FP_PORT=%~1"
for /f "tokens=5" %%p in ('netstat -aon -p TCP ^| findstr /R /C:":%FP_PORT% .*LISTENING"') do call :killnode %%p || exit /b 1
exit /b 0

:killnode
if "%~1"=="0" exit /b 0
tasklist /FI "PID eq %~1" /NH 2>nul | findstr /I "node.exe" >nul
if errorlevel 1 (
    echo [ERROR] Port %FP_PORT% is used by another program, PID %~1. Close it or set LZRCNC_PORT.
    exit /b 1
)
echo [INFO] Port %FP_PORT% is used by an old LzrCnc process, PID %~1 - stopping it.
taskkill /F /T /PID %~1 >nul 2>&1
ping -n 2 127.0.0.1 >nul
exit /b 0

:fail
echo.
echo LzrCnc could not start - see the messages above.
if "%LZRCNC_NO_PAUSE%"=="" pause
endlocal
exit /b 1

:end
endlocal
exit /b 0
