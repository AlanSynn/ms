@echo off
echo ============================================
echo   MotionSmith - Character Motion Designer
echo   Manual Tracking Mode Only
echo ============================================
echo.
cd /d "%~dp0"

echo Checking for existing frontend on port 1420...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :1420 ^| findstr LISTENING') do (
    echo Killing existing process %%a
    taskkill /F /PID %%a 2>nul
)

echo Starting Frontend Dev Server...
echo.
echo ============================================
echo   Opening http://localhost:1420
echo ============================================
echo.
start http://localhost:1420
call bun run dev
