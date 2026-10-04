@echo off
rem Finds Claude Code (claude.exe) and puts its path in JARVIS_CLAUDE_BIN. Used by start.bat, connect-youtube.bat, doctor.bat.
rem A PC can have several copies (its own install, the Claude desktop app, the Microsoft Store app). An old copy can
rem lose its sign-in, so the most recently updated copy wins. Set JARVIS_CLAUDE_BIN yourself to force one.
if not "%JARVIS_CLAUDE_BIN%"=="" exit /b 0
for /f "usebackq delims=" %%F in (`powershell -NoProfile -Command "$c = @(); $c += Get-Command claude -All -ErrorAction SilentlyContinue | Where-Object { $_.Source -like '*.exe' } | ForEach-Object { Get-Item $_.Source }; $c += Get-Item (Join-Path $env:USERPROFILE '.local\bin\claude.exe') -ErrorAction SilentlyContinue; $c += Get-ChildItem (Join-Path $env:APPDATA 'Claude\claude-code') -Recurse -Filter claude.exe -ErrorAction SilentlyContinue; $c += Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Packages') -Directory -Filter 'Claude*' -ErrorAction SilentlyContinue | ForEach-Object { Get-ChildItem -Path $_.FullName -Recurse -Filter claude.exe -ErrorAction SilentlyContinue }; $c | Where-Object { $_ } | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName"`) do set "JARVIS_CLAUDE_BIN=%%F"
if "%JARVIS_CLAUDE_BIN%"=="" (
  where claude >nul 2>nul && set JARVIS_CLAUDE_BIN=claude
)
if "%JARVIS_CLAUDE_BIN%"=="" (
  echo Claude Code not found. Open the Claude desktop app once, or set JARVIS_CLAUDE_BIN to the full path of claude.exe
  exit /b 1
)
exit /b 0
