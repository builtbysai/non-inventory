@echo off
cd /d "%~dp0"
".venv\Scripts\python.exe" -c "import sys;sys.path.insert(0,'app');from engine import Ledger;Ledger('.').configure({'capture_enabled':False});print('Device capture disabled. Journal and queue retained.')"
pause
