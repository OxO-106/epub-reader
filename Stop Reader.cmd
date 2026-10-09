@echo off
rem Quits the Reader tray icon and stops the servers it started (the same as "Quit" in its menu).
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "scripts\reader-tray.ps1" -Stop
ping -n 3 127.0.0.1 >nul
