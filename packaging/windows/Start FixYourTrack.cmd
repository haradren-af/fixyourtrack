@echo off
setlocal
cd /d "%~dp0"
title FixYourTrack

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "runtime\FixYourTrack.Launch.ps1"
if errorlevel 1 (
  echo.
  echo FixYourTrack could not start.
  echo See runtime\server.log for details.
  pause
  exit /b 1
)
