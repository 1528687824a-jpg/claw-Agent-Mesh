$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dockerCli = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
$env:Path = "C:\Program Files\Docker\Docker\resources\bin;$env:Path"

Set-Location $root

$statePath = Join-Path $root ".runtime\owner-tryout.json"
if (Test-Path -LiteralPath $statePath) {
  $state = Get-Content -LiteralPath $statePath | ConvertFrom-Json
  if ($state.desktopPid) {
    Stop-Process -Id $state.desktopPid -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
}

$desktopProcesses = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -match "apps[/\\]desktop-app" -and
  ($_.CommandLine -match "vite" -or $_.CommandLine -match "npm")
}
foreach ($process in $desktopProcesses) {
  if ($process.ProcessId -ne $PID) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

if (-not (Test-Path -LiteralPath $dockerCli)) {
  $dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
  if ($dockerCommand) {
    $dockerCli = $dockerCommand.Source
  }
}

if (Test-Path -LiteralPath $dockerCli) {
  & $dockerCli compose down --remove-orphans
}

Write-Output "Owner tryout stopped. Docker volumes were kept."
