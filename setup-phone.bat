@echo off
rem Open JARVIS on your phone, privately through Tailscale, with a PIN. See README: "JARVIS on your phone".
rem To turn it off again: python phone_access.py off
cd /d "%~dp0"
set PYTHONUTF8=1
python phone_access.py setup || (pause & exit /b 1)
pause
