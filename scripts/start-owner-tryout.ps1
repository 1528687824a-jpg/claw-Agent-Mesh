param(
  [int]$DesktopPort = 5173,
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dockerCli = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
$dockerDesktop = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
$env:Path = "C:\Program Files\Docker\Docker\resources\bin;$env:Path"

if (-not (Test-Path -LiteralPath $dockerCli)) {
  $dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $dockerCommand) {
    throw "Docker CLI not found. Install Docker Desktop or make docker available on PATH."
  }
  $dockerCli = $dockerCommand.Source
}

function Test-DockerReady {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & $dockerCli info *> $null
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference
  return $exitCode -eq 0
}

function Test-HttpReady($Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Test-PortAvailable($Port) {
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  return $null -eq $listener
}

if (-not (Test-DockerReady)) {
  if (-not (Test-Path -LiteralPath $dockerDesktop)) {
    throw "Docker daemon is not ready and Docker Desktop was not found at $dockerDesktop"
  }

  Start-Process -FilePath $dockerDesktop -WindowStyle Hidden

  $ready = $false
  for ($i = 1; $i -le 100; $i++) {
    Start-Sleep -Seconds 3
    if (Test-DockerReady) {
      $ready = $true
      break
    }
  }

  if (-not $ready) {
    throw "Docker daemon did not become ready"
  }
}

Set-Location $root
New-Item -ItemType Directory -Force -Path ".runtime", "logs" | Out-Null

$statePath = Join-Path $root ".runtime\owner-tryout.json"
if (Test-Path -LiteralPath $statePath) {
  $previous = Get-Content -LiteralPath $statePath | ConvertFrom-Json
  if ($previous.desktopPid) {
    Stop-Process -Id $previous.desktopPid -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
}

Write-Output "Starting HTTP-only Docker stack..."
& $dockerCli compose up -d --build
if ($LASTEXITCODE -ne 0) {
  throw "docker compose up failed"
}

$apiUrl = "http://localhost:3000"
$apiReady = $false
for ($i = 1; $i -le 90; $i++) {
  if (Test-HttpReady "$apiUrl/health") {
    $apiReady = $true
    break
  }
  Start-Sleep -Seconds 2
}

if (-not $apiReady) {
  throw "API did not become ready at $apiUrl"
}

$desktopNodeModules = Join-Path $root "apps\desktop-app\node_modules"
if (-not (Test-Path -LiteralPath $desktopNodeModules)) {
  Write-Output "Installing desktop dependencies..."
  npm ci --prefix apps/desktop-app
  if ($LASTEXITCODE -ne 0) {
    throw "Desktop dependency install failed"
  }
}

$selectedPort = $DesktopPort
while (-not (Test-PortAvailable $selectedPort)) {
  $selectedPort += 1
  if ($selectedPort -gt ($DesktopPort + 20)) {
    throw "No free desktop port found from $DesktopPort to $($DesktopPort + 20)"
  }
}

$desktopUrl = "http://127.0.0.1:$selectedPort"
$desktopLog = Join-Path $root "logs\owner-tryout-desktop.log"
$desktopCmd = "cd '$root'; `$env:VITE_ORCHESTRATOR_URL='http://localhost:3000'; npm --prefix apps/desktop-app run dev -- --host 127.0.0.1 --port $selectedPort --strictPort *> '$desktopLog'"

Write-Output "Starting desktop UI on $desktopUrl..."
$desktop = Start-Process -FilePath powershell -WindowStyle Hidden -PassThru -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  $desktopCmd
)

$desktopReady = $false
for ($i = 1; $i -le 60; $i++) {
  if (Test-HttpReady $desktopUrl) {
    $desktopReady = $true
    break
  }
  Start-Sleep -Seconds 1
}

if (-not $desktopReady) {
  Stop-Process -Id $desktop.Id -Force -ErrorAction SilentlyContinue
  throw "Desktop UI did not become ready. See $desktopLog"
}

@{
  apiUrl = $apiUrl
  desktopUrl = $desktopUrl
  desktopPid = $desktop.Id
  desktopLog = $desktopLog
  startedAt = (Get-Date).ToString("o")
} | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8

if (-not $NoOpen) {
  Start-Process $desktopUrl
}

Write-Output ""
Write-Output "Owner tryout is ready."
Write-Output "Desktop UI: $desktopUrl"
Write-Output "API:        $apiUrl"
Write-Output "State:      $statePath"
Write-Output "Log:        $desktopLog"
Write-Output ""
Write-Output "Try creating a job in the desktop UI, then inspect messages and timeline."
Write-Output "Stop everything with: npm run tryout:stop"
