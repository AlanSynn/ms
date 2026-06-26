@echo off
echo ============================================
echo   MotionSmith - Character Motion Designer
echo   Manual Tracking Mode Only
echo ============================================
echo.
cd /d "%~dp0"

echo Checking for existing frontend on port 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
    echo Killing existing process %%a
    taskkill /F /PID %%a 2>nul
)

echo Starting Frontend Dev Server...
echo.
echo ============================================
echo   Opening http://localhost:3000
echo ============================================
echo.
start http://localhost:3000
call npm run dev
