@echo off
setlocal
cd /d "%~dp0"
title Fix Your Track

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found in PATH. Please install Node.js 20+ and try again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Building Fix Your Track...
call npm run build
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)

call "%~dp0start-fixyourtrack.bat"
exit /b %errorlevel%
