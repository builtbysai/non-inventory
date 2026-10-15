@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item 'HKCU:\Software\Mozilla\NativeMessagingHosts\non_inventory_host' -Recurse -Force -ErrorAction SilentlyContinue; Write-Host 'Local host unregistered. Inventory CSVs and history were not removed.'"
pause
