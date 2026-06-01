@echo off
REM Double-click to run Block Trainer locally.
cd /d "%~dp0"

if not exist node_modules (
  echo Installing dependencies ^(first run only^)...
  call npm install
)

echo.
echo Starting Block Trainer...
echo Opening http://localhost:5173/ in your browser.
echo Leave this window open while using the app. Close it ^(or press Ctrl+C^) to stop.
echo.

start "" http://localhost:5173/
call npm run dev
