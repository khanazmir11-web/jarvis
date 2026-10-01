@echo off
rem Start JARVIS on Windows. Double-click this file, then open http://127.0.0.1:8720
cd /d "%~dp0"
set ANTHROPIC_API_KEY=
set PYTHONUTF8=1
if "%JARVIS_CLAUDE_BIN%"=="" (
  where claude >nul 2>nul && set JARVIS_CLAUDE_BIN=claude
)
rem Claude Code installed on its own
if "%JARVIS_CLAUDE_BIN%"=="" if exist "%USERPROFILE%\.local\bin\claude.exe" set "JARVIS_CLAUDE_BIN=%USERPROFILE%\.local\bin\claude.exe"
rem Claude Code that came with the Claude desktop app
if "%JARVIS_CLAUDE_BIN%"=="" (
  for /d %%D in ("%APPDATA%\Claude\claude-code\*") do if exist "%%D\claude.exe" set "JARVIS_CLAUDE_BIN=%%D\claude.exe"
)
rem ...and the Microsoft Store version of the desktop app, which keeps it somewhere under Packages (newest copy wins)
if "%JARVIS_CLAUDE_BIN%"=="" (
  for /f "usebackq delims=" %%F in (`powershell -NoProfile -Command "Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Packages') -Directory -Filter 'Claude*' | ForEach-Object { Get-ChildItem -Path $_.FullName -Recurse -Filter 'claude.exe' -ErrorAction SilentlyContinue } | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName"`) do set "JARVIS_CLAUDE_BIN=%%F"
)
if "%JARVIS_CLAUDE_BIN%"=="" (
  echo Claude Code not found. Open the Claude desktop app once, or set JARVIS_CLAUDE_BIN to the full path of claude.exe
  pause
  exit /b 1
)
echo Using Claude Code at %JARVIS_CLAUDE_BIN%
rem open JARVIS in its own app window (no address bar) if Chrome or Edge is installed
set "URL=http://127.0.0.1:8720"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" --app=%URL% --start-maximized
) else if exist "%EDGE%" (
  start "" "%EDGE%" --app=%URL% --start-maximized
) else (
  start "" %URL%
)
python server.py
pause
