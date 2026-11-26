@echo off
rem asset-inventory (Windows) - online SQLite backup to backups\data-<timestamp>.db (safe while running).
"%~dp0node\node.exe" "%~dp0scripts\deploy\windows\start.mjs" backup
if errorlevel 1 pause
