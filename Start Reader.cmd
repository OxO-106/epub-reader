@echo off
rem Starts the Reader server and the translation model server, with a system-tray icon showing both.
rem Double-click this file. See the README ("One-click start") for what the icon colours mean.
rem Extra options go through, for example:  "Start Reader.cmd" -NoTranslation
cd /d "%~dp0"
start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File "scripts\reader-tray.ps1" %*
