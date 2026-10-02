@echo off
rem Start JARVIS on Windows. Double-click this file, then open http://127.0.0.1:8720
cd /d "%~dp0"
set ANTHROPIC_API_KEY=
set PYTHONUTF8=1
call "%~dp0find-claude.bat" || (pause & exit /b 1)
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
