@echo off
rem asset-inventory (Windows) - start the app. First run creates .env and data.db. Stop with Ctrl+C.
"%~dp0node\node.exe" "%~dp0scripts\deploy\windows\start.mjs" start
if errorlevel 1 pause
