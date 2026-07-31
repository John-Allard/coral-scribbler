@echo off
title Coral Scribbler session recovery
echo Keep Google Chrome and the Coral Scribbler tab OPEN.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0recover-coral-scribbler.ps1"
echo.
pause

