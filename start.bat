@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if not errorlevel 1 (
  node src\server.js
  goto :end
)

set "CODEX_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%CODEX_NODE%" (
  "%CODEX_NODE%" src\server.js
  goto :end
)

echo.
echo Node.js 24+ was not found.
echo Install Node.js 24 from https://nodejs.org/ and run this file again.
echo.
pause

:end
endlocal
