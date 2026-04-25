@echo off
setlocal
cd /d "%~dp0"
title Fix Your Track

if not exist "dist\index.html" (
  echo Portable files are incomplete. dist\index.html not found.
  pause
  exit /b 1
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4173" ^| findstr "LISTENING"') do (
  start "" "http://127.0.0.1:4173"
  exit /b 0
)

echo Starting local server...
start "" powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0portable-server.ps1"

timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:4173"

echo Browser opened. If the page did not load, wait a couple of seconds and refresh.
exit /b 0
