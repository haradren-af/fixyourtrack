@echo off
setlocal
cd /d "%~dp0"
title Stop FixYourTrack

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "runtime\FixYourTrack.Stop.ps1"
if errorlevel 1 pause
