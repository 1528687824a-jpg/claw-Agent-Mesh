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

$desktopProcesses = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -match "apps[/\\]desktop-app" -and
  ($_.CommandLine -match "vite" -or $_.CommandLine -match "npm") -and
  $_.ProcessId -ne $PID
}
foreach ($process in $desktopProcesses) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

Write-Output "Starting HTTP-only backend stack..."
& $dockerCli compose up -d --build
if ($LASTEXITCODE -ne 0) {
  throw "docker compose up failed"
}

$apiReady = $false
for ($i = 1; $i -le 90; $i++) {
  if (Test-HttpReady "http://localhost:3000/health") {
    $apiReady = $true
    break
  }
  Start-Sleep -Seconds 2
}

if (-not $apiReady) {
  throw "API did not become ready at http://localhost:3000"
}

$desktopNodeModules = Join-Path $root "apps\desktop-app\node_modules"
if (-not (Test-Path -LiteralPath $desktopNodeModules)) {
  Write-Output "Installing desktop dependencies..."
  npm ci --prefix apps/desktop-app
  if ($LASTEXITCODE -ne 0) {
    throw "Desktop dependency install failed"
  }
}

Write-Output ""
Write-Output "Launching honeycomb desktop app..."
Write-Output "Backend API: http://localhost:3000"
Write-Output "Close the Tauri window or press Ctrl+C in this terminal when done."
Write-Output "Stop backend containers with: npm run tryout:stop"
Write-Output ""

$env:VITE_ORCHESTRATOR_URL = "http://localhost:3000"
npm --prefix apps/desktop-app run tauri:dev
