@echo off
setlocal
cd /d "%~dp0"
title Build FixYourTrack Windows Package

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js with npm is required only to build the tester package.
  echo Download Node.js LTS from https://nodejs.org/
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Build-Windows-Package.ps1"
if errorlevel 1 (
  echo.
  echo Package build failed.
  pause
  exit /b 1
)

echo.
echo Package is ready in the release folder.
pause
