param([switch]$NoLaunch, [switch]$NoShortcut)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Write-Host 'Non-Inventory / Windows setup' -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $root 'app\native_host.py'))) { throw 'Extract the entire release ZIP first.' }
function Find-Python {
  foreach ($name in @('py','python')) {
    try {
      $command = Get-Command $name -ErrorAction Stop
      $arguments = @('-c','import sys; sys.exit(1) if sys.version_info < (3,10) else print(sys.executable)')
      if ($name -eq 'py') { $arguments = @('-3') + $arguments }
      $exe = (& $command.Source @arguments 2>$null | Select-Object -First 1)
      if ($exe -and (Test-Path $exe.Trim())) { return $exe.Trim() }
    } catch { }
  }
  $candidate = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313\python.exe'
  if (Test-Path $candidate) { return $candidate }
  return $null
}
# During an upgrade, stop only a companion belonging to this exact installation.
$existingCompanion = Join-Path $root 'app\companion.py'
$venvScripts = Join-Path $root '.venv\Scripts'
Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.ExecutablePath -and (Split-Path $_.ExecutablePath) -eq $venvScripts -and $_.CommandLine -match ('(?:^|\s)"?' + [regex]::Escape($existingCompanion) + '"?(?:\s|$)')) {
    Stop-Process -Id $_.ProcessId -ErrorAction Stop
  }
}
$python = Find-Python
if (-not $python) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'Install Python 3.10+ from python.org, then rerun SETUP.cmd.' }
  & winget install -e --id Python.Python.3.13 --source winget --scope user --accept-source-agreements --accept-package-agreements
  if ($LASTEXITCODE -ne 0) { throw 'Python installation failed.' }
  $python = Find-Python
  if (-not $python) { throw 'Open a new terminal and run SETUP.cmd again so Windows can find Python.' }
}
& $python -m venv (Join-Path $root '.venv')
if ($LASTEXITCODE -ne 0) { throw 'Could not create local Python environment.' }
$python = Join-Path $root '.venv\Scripts\python.exe'
$pythonw = Join-Path $root '.venv\Scripts\pythonw.exe'
& $python -m pip install --disable-pip-version-check -r (Join-Path $root 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check network/proxy, then rerun.' }
New-Item -ItemType Directory -Force -Path (Join-Path $root 'workspace') | Out-Null
& $python (Join-Path $root 'tests\preflight.py')
if ($LASTEXITCODE -ne 0) { throw 'CSV preflight failed. Fix headers before enabling capture.' }
$utf8 = New-Object Text.UTF8Encoding($false)
$launcher = Join-Path $root 'app\native_launcher.bat'
$nativeScript = Join-Path $root 'app\native_host.py'
[IO.File]::WriteAllText($launcher,"@echo off`r`nchcp 65001 >nul`r`n`"$python`" -u `"$nativeScript`" %*`r`n",$utf8)
$manifestPath = Join-Path $root 'app\non_inventory_host.json'
$manifest = @{name='non_inventory_host';description='Non-Inventory local companion';path=$launcher;type='stdio';allowed_extensions=@('non-inventory@builtbysai.com')} | ConvertTo-Json
[IO.File]::WriteAllText($manifestPath,$manifest,$utf8)
$key = 'HKCU:\Software\Mozilla\NativeMessagingHosts\non_inventory_host'
New-Item -Path $key -Force | Out-Null
Set-Item -Path $key -Value $manifestPath
$companion = Join-Path $root 'app\companion.py'
$startLauncher = Join-Path $root 'app\start_companion.cmd'
[IO.File]::WriteAllText($startLauncher,"@echo off`r`nchcp 65001 >nul`r`nstart `"`" `"$pythonw`" `"$companion`" --start`r`n",$utf8)
if (-not $NoShortcut) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Non-Inventory.lnk'))
  $shortcut.TargetPath = Join-Path $root 'START.cmd'
  $shortcut.WorkingDirectory = $root
  $shortcut.Save()
}
if (-not $NoLaunch) { Start-Process -FilePath $pythonw -ArgumentList ('"' + $companion + '" --start') }
Write-Host 'Setup complete. No administrator rights required.' -ForegroundColor Green
Write-Host 'Firefox: about:debugging > This Firefox > Load Temporary Add-on > extension\manifest.json'
Write-Host 'Open station from extension icon. Save login and scanner settings before scanning.'
Write-Host 'Temporary extensions must be reloaded after Firefox restarts. Permanent installation requires Mozilla signing.'
if (-not $NoLaunch) { Start-Process explorer.exe -ArgumentList ('"' + (Join-Path $root 'extension') + '"') }
