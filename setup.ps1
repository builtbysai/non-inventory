$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Write-Host "`nNON INVENTORY  /  SPA1 installer" -ForegroundColor Cyan
Write-Host '----------------------------------------'
if (-not (Test-Path (Join-Path $root 'extension\manifest.json'))) { throw 'Project was not fully extracted. Unzip ALL files, then try again.' }
if (-not (Test-Path (Join-Path $root 'app\native_host.py'))) { throw 'Missing application files.' }

function Find-Python {
  foreach ($candidate in @(@('py','-3'), @('python',''))) {
    try {
      $command = Get-Command $candidate[0] -ErrorAction Stop
      $args = if ($candidate[1]) { @($candidate[1], '-c', 'import sys; print(sys.executable if sys.version_info.major == 3 else "")') }
              else { @('-c','import sys; print(sys.executable if sys.version_info.major == 3 else "")') }
      $exe = (& $command.Source @args 2>$null | Select-Object -First 1)
      if ($exe -and (Test-Path $exe)) { return $exe.Trim() }
    } catch { }
  }
  return $null
}
$python = Find-Python
if (-not $python) {
  Write-Host 'Python 3 was not found.' -ForegroundColor Yellow
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    $answer = Read-Host 'Install Python 3 using Windows Package Manager (winget)? Y/N'
    if ($answer -match '^y') {
      & winget install -e --id Python.Python.3.13 --source winget --accept-source-agreements --accept-package-agreements
      $python = Find-Python
    }
  }
  if (-not $python) { throw 'Install Python 3 from python.org, close and reopen the terminal, then run SETUP.cmd again.' }
}
Write-Host "Python: $python" -ForegroundColor Green
$ws = Join-Path $root 'workspace'
New-Item -ItemType Directory -Force -Path $ws | Out-Null
$files = @(Get-ChildItem -Path $ws -Filter 'investigation-items *.csv' -File)
Write-Host "Investigation CSV files: $($files.Count)"
if ($files.Count -eq 0) {
  Write-Warning 'No investigation CSV files in workspace. Copy your July/August/September source files here before scanning.'
}
$launcher = Join-Path $root 'app\native_launcher.bat'
$script = Join-Path $root 'app\native_host.py'
$launcherText = "@echo off`r`n`"$python`" -u `"$script`"`r`n"
[IO.File]::WriteAllText($launcher, $launcherText, [Text.Encoding]::ASCII)
$nativeManifest = Join-Path $root 'app\non_inventory_host.json'
$json = @{name='non_inventory_host';description='Local field IT audit and CSV companion';path=$launcher;type='stdio';allowed_extensions=@('non-inventory@builtbysai.com')} | ConvertTo-Json -Depth 3
[IO.File]::WriteAllText($nativeManifest,$json,(New-Object Text.UTF8Encoding($false)))
$registry = 'HKCU:\Software\Mozilla\NativeMessagingHosts\non_inventory_host'
New-Item -Path $registry -Force | Out-Null
Set-Item -Path $registry -Value $nativeManifest
Write-Host 'Native messaging connected for this Windows account.' -ForegroundColor Green
& $python (Join-Path $root 'tests\preflight.py')
if ($LASTEXITCODE -ne 0) { throw 'Self-check failed; review reported errors before scanning.' }
Write-Host "`nLAST STEP: Firefox temporary extension" -ForegroundColor Cyan
Write-Host '1. Firefox: about:debugging > This Firefox > Load Temporary Add-on'
Write-Host "2. Select: $(Join-Path $root 'extension\manifest.json')"
Write-Host '3. Click the extension icon > Open station. Open your APEX inventory audit in another tab.'
Write-Host 'Temporary add-ons require reloading after restarting Firefox. This cannot be bypassed by this installer.'
try {
  $firefox = Get-Command firefox -ErrorAction SilentlyContinue
  if ($firefox) { Start-Process $firefox.Source 'about:debugging#/runtime/this-firefox' }
  else { Start-Process 'about:debugging#/runtime/this-firefox' -ErrorAction SilentlyContinue }
} catch { }
Start-Process explorer.exe -ArgumentList (Join-Path $root 'extension')
Write-Host "`nSetup complete. Keep this folder in place." -ForegroundColor Green
