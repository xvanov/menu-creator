@echo off
rem Windows: double-click to install or update (safe to run again).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Dir "%~dp0." %*
pause
