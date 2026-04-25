@echo off
setlocal
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4173" ^| findstr "LISTENING"') do (
  taskkill /PID %%a /T /F >nul 2>nul
  echo Fix Your Track server stopped.
  exit /b 0
)
echo Server on port 4173 not found.
