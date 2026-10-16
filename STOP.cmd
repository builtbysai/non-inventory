@echo off
cd /d "%~dp0"
".venv\Scripts\python.exe" "app\runtime.py" stop
if errorlevel 1 echo Unable to stop. Close Firefox and check the companion process before upgrading.
pause
