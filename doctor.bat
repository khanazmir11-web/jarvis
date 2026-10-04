@echo off
rem JARVIS doctor: shows which Claude Code JARVIS uses and whether it is signed in. Prints no secrets.
cd /d "%~dp0"
set ANTHROPIC_API_KEY=
echo === Claude Code copies on PATH ===
where claude 2>nul || echo (none on PATH)
call "%~dp0find-claude.bat" || (pause & exit /b 1)
echo.
echo === JARVIS uses ===
echo %JARVIS_CLAUDE_BIN%
echo.
echo === Sign-in overrides (should all say no) ===
if defined CLAUDE_CODE_OAUTH_TOKEN (echo CLAUDE_CODE_OAUTH_TOKEN: YES - this overrides /login) else (echo CLAUDE_CODE_OAUTH_TOKEN: no)
if defined ANTHROPIC_AUTH_TOKEN (echo ANTHROPIC_AUTH_TOKEN: YES - this overrides /login) else (echo ANTHROPIC_AUTH_TOKEN: no)
if exist "%USERPROFILE%\.claude\.credentials.json" (echo saved sign-in file: found) else (echo saved sign-in file: not found)
echo.
echo === Version ===
"%JARVIS_CLAUDE_BIN%" --version
echo.
echo === Test question (takes a few seconds) ===
"%JARVIS_CLAUDE_BIN%" -p "Reply with exactly: JARVIS link OK"
echo.
echo === Connectors ===
"%JARVIS_CLAUDE_BIN%" mcp list
pause
