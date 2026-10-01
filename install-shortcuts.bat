@echo off
rem Puts a JARVIS icon on your desktop, and can start JARVIS automatically when you log in.
rem Run it once. To undo: delete JARVIS from your desktop and from shell:startup.
cd /d "%~dp0"
set "HERE=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$w=New-Object -ComObject WScript.Shell; $l=$w.CreateShortcut([Environment]::GetFolderPath('Desktop')+'\JARVIS.lnk'); $l.TargetPath=$env:HERE+'start.bat'; $l.WorkingDirectory=$env:HERE; $l.IconLocation=$env:HERE+'web\jarvis.ico'; $l.WindowStyle=7; $l.Description='Start JARVIS'; $l.Save()"
echo JARVIS icon added to your desktop.
choice /m "Also start JARVIS automatically every time you log in to Windows"
if errorlevel 2 goto done
powershell -NoProfile -ExecutionPolicy Bypass -Command "$w=New-Object -ComObject WScript.Shell; $l=$w.CreateShortcut([Environment]::GetFolderPath('Startup')+'\JARVIS.lnk'); $l.TargetPath=$env:HERE+'start.bat'; $l.WorkingDirectory=$env:HERE; $l.IconLocation=$env:HERE+'web\jarvis.ico'; $l.WindowStyle=7; $l.Save()"
echo JARVIS will start when you log in.
:done
pause
