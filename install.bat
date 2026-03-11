@echo off
setlocal EnableDelayedExpansion

echo ==========================================
echo LzrCnc Windows Installer
echo ==========================================
echo.
echo NOTE: Ensure you are running this as Administrator if you encounter permission errors.
echo.

:: Check for Node.js
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js v20+ from https://nodejs.org/
    pause
    exit /b 1
) else (
    echo [CHECK] Node.js found.
)

:: Install Root Dependencies
echo.
echo [1/3] Installing Root Dependencies...
if exist package.json (
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install root dependencies.
        pause
        exit /b 1
    )
) else (
    echo [ERROR] package.json not found in root.
    pause
    exit /b 1
)

:: Install Server Dependencies
echo.
echo [2/3] Installing Server Dependencies...
if exist server (
    cd server
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install server dependencies.
        cd ..
        pause
        exit /b 1
    )
    echo Building Server...
    call npm run build
    if %errorlevel% neq 0 (
        echo [WARNING] Server build failed. Checking for Windows-specific dependencies...
        echo Attempting to install 'sharp' for Windows x64...
        call npm install --os=win32 --cpu=x64 sharp
        echo Re-attempting build...
        call npm run build
        if !errorlevel! neq 0 (
            echo [ERROR] Server build still failed. Please check logs.
            cd ..
            pause
            exit /b 1
        )
    )
    cd ..
) else (
    echo [ERROR] server directory not found.
    pause
    exit /b 1
)

:: Install Client Dependencies
echo.
echo [3/3] Installing Client Dependencies...
if exist client (
    cd client
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install client dependencies.
        cd ..
        pause
        exit /b 1
    )
    echo Building Client...
    call npm run build
    if %errorlevel% neq 0 (
        echo [WARNING] Client build failed. Continuing...
    )
    cd ..
) else (
    echo [ERROR] client directory not found.
    pause
    exit /b 1
)

echo.
echo ==========================================
echo Installation Complete!
echo You can now run 'start.bat' to launch LzrCnc.
echo ==========================================
pause
