@echo off
rem Connect Google Classroom to JARVIS, read-only. Run once, after saving your Google OAuth client file as
rem %USERPROFILE%\.jarvis\youtube_client.json  (the same file YouTube uses; see README: "Google Classroom").
cd /d "%~dp0"
set ANTHROPIC_API_KEY=
set PYTHONUTF8=1
call "%~dp0find-claude.bat" || (pause & exit /b 1)
if not exist "%USERPROFILE%\.jarvis\youtube_client.json" (
  echo Missing %USERPROFILE%\.jarvis\youtube_client.json
  echo Download the OAuth client JSON from Google Cloud ^(Credentials, Desktop app^) and save it there with that name.
  pause
  exit /b 1
)
echo Step 1 of 3: sign in to Google Classroom in your browser (read-only)...
python classroom_mcp.py login || (pause & exit /b 1)
echo Step 2 of 3: adding the Classroom connector to Claude Code...
"%JARVIS_CLAUDE_BIN%" mcp remove --scope user classroom >nul 2>nul
"%JARVIS_CLAUDE_BIN%" mcp add --scope user classroom -- python "%~dp0classroom_mcp.py"
echo Step 3 of 3: checking it works...
python classroom_mcp.py test || (pause & exit /b 1)
echo.
echo Google Classroom is connected. Open JARVIS and press the Accounts button.
pause
