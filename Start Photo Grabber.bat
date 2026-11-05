@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Opening the download page...
  echo Install the "LTS" version, then double-click this file again.
  start https://nodejs.org
  pause
  exit /b
)
if not exist node_modules (
  echo First run: installing, this takes about a minute...
  call npm install
)
call npm start
pause
