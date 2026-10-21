@echo off
setlocal
set "SCRIPT=%~dp0export-wuwalab-rotation.mjs"
if not exist "%SCRIPT%" (
  echo Exporter files are missing. Extract the entire ZIP before running this launcher.
  pause
  exit /b 1
)
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install it from https://nodejs.org/en/download/ and try again.
  pause
  exit /b 1
)
echo Keep this window open while using the WuwaLab rotation exporter.
node "%SCRIPT%"
if errorlevel 1 pause
