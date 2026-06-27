@echo off
setlocal enabledelayedexpansion
echo ============================================
echo   MotionSmith - Building Portable EXE
echo ============================================
echo.

cd /d "%~dp0"

REM Prompt for version
set /p VERSION="Enter version (e.g. 1.0.0): "

if "%VERSION%"=="" (
    echo ERROR: Version cannot be empty!
    pause
    exit /b 1
)

echo.
echo Updating version to %VERSION% in all config files...
powershell -ExecutionPolicy Bypass -File "update_version.ps1" -Version "%VERSION%"

echo.

REM Create output folder if it doesn't exist
if not exist "exe build" mkdir "exe build"

REM Set TAURI_PLATFORM so vite uses the relative base path
set TAURI_PLATFORM=windows

echo [1/3] Running TypeScript check and Vite build...
call bun run build
if errorlevel 1 (
    echo ERROR: Build failed!
    pause
    exit /b 1
)

echo.
echo [2/3] Building Tauri application (this may take a while)...
call bunx tauri build
if errorlevel 1 (
    echo ERROR: Tauri build failed!
    pause
    exit /b 1
)

echo.
echo [3/3] Copying executable to "exe build" folder...
copy /Y "src-tauri\target\release\motionsmith.exe" "exe build\MotionSmith.exe"
if errorlevel 1 (
    echo ERROR: Failed to copy executable!
    pause
    exit /b 1
)

echo.
echo ============================================
echo   BUILD COMPLETE! Version: %VERSION%
echo   Output: exe build\MotionSmith.exe
echo ============================================
echo.

REM Show file size
for %%A in ("exe build\MotionSmith.exe") do echo File size: %%~zA bytes

pause
endlocal
