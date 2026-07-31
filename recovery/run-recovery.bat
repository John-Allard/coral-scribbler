@echo off
title Coral Scribbler session recovery
echo Keep Google Chrome and the Coral Scribbler tab OPEN.
echo The recovery results will be placed in a new folder on your Desktop.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0recover-coral-scribbler.ps1"
if errorlevel 1 (
  echo.
  echo RECOVERY SCRIPT ERROR
  echo Please take a screenshot of everything in this window and send it to John.
)
echo.
pause
