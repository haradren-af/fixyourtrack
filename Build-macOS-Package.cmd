@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\Build-macOS-Package.ps1"
if errorlevel 1 pause
