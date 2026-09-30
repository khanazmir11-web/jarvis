@echo off
rem Start JARVIS on Windows. Double-click this file, then open http://127.0.0.1:8720
cd /d "%~dp0"
set ANTHROPIC_API_KEY=
set PYTHONUTF8=1
if "%JARVIS_CLAUDE_BIN%"=="" (
  where claude >nul 2>nul && set JARVIS_CLAUDE_BIN=claude
)
if "%JARVIS_CLAUDE_BIN%"=="" (
  for /d %%D in ("%APPDATA%\Claude\claude-code\*") do if exist "%%D\claude.exe" set "JARVIS_CLAUDE_BIN=%%D\claude.exe"
)
if "%JARVIS_CLAUDE_BIN%"=="" (
  echo Claude Code not found. Install it from https://claude.com/claude-code
  pause
  exit /b 1
)
echo Using Claude Code at %JARVIS_CLAUDE_BIN%
start "" http://127.0.0.1:8720
python server.py
pause
