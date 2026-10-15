@echo off
cd /d "%~dp0"
if not exist "app\start_companion.cmd" (
  call SETUP.cmd
  exit /b
)
call "app\start_companion.cmd"
