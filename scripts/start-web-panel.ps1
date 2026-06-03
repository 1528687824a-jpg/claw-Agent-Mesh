param(
  [int]$WebPort = 5173,
  [string]$ApiUrl = "http://localhost:3000",
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

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

Set-Location $root
New-Item -ItemType Directory -Force -Path ".runtime", "logs" | Out-Null

$statePath = Join-Path $root ".runtime\owner-tryout.json"
if (Test-Path -LiteralPath $statePath) {
  $previous = Get-Content -LiteralPath $statePath | ConvertFrom-Json
  foreach ($pidValue in @($previous.webPid, $previous.desktopPid)) {
    if ($pidValue) {
      Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
    }
  }
  Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
}

$webProcesses = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -match "apps[/\\]desktop-app" -and
  ($_.CommandLine -match "vite" -or $_.CommandLine -match "npm") -and
  $_.ProcessId -ne $PID
}
foreach ($process in $webProcesses) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

$webNodeModules = Join-Path $root "apps\desktop-app\node_modules"
if (-not (Test-Path -LiteralPath $webNodeModules)) {
  Write-Output "Installing web panel dependencies..."
  npm ci --prefix apps/desktop-app
  if ($LASTEXITCODE -ne 0) {
    throw "Web panel dependency install failed"
  }
}

$selectedPort = $WebPort
while (-not (Test-PortAvailable $selectedPort)) {
  $selectedPort += 1
  if ($selectedPort -gt ($WebPort + 20)) {
    throw "No free web panel port found from $WebPort to $($WebPort + 20)"
  }
}

$webUrl = "http://127.0.0.1:$selectedPort"
$webLog = Join-Path $root "logs\web-panel.log"
$webCmd = "cd '$root'; `$env:VITE_ORCHESTRATOR_URL='$ApiUrl'; npm --prefix apps/desktop-app run dev -- --host 127.0.0.1 --port $selectedPort --strictPort *> '$webLog'"

Write-Output "Starting Agent OpenClaw web panel on $webUrl..."
Write-Output "This command does not start Docker Desktop or Docker Compose."

$web = Start-Process -FilePath powershell -WindowStyle Hidden -PassThru -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  $webCmd
)

$webReady = $false
for ($i = 1; $i -le 60; $i++) {
  if (Test-HttpReady $webUrl) {
    $webReady = $true
    break
  }
  Start-Sleep -Seconds 1
}

if (-not $webReady) {
  Stop-Process -Id $web.Id -Force -ErrorAction SilentlyContinue
  throw "Web panel did not become ready. See $webLog"
}

$apiHealthUrl = "$($ApiUrl.TrimEnd('/'))/health"
$apiOnline = Test-HttpReady $apiHealthUrl

@{
  runtimeMode = "web-panel-only"
  backendAutoStarted = $false
  apiUrl = $ApiUrl
  apiOnline = $apiOnline
  webUrl = $webUrl
  webPid = $web.Id
  webLog = $webLog
  startedAt = (Get-Date).ToString("o")
} | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8

if (-not $NoOpen) {
  Start-Process $webUrl
}

Write-Output ""
Write-Output "Agent OpenClaw web panel is ready."
Write-Output "Web panel: $webUrl"
Write-Output "API:       $ApiUrl"
Write-Output "API state: $(if ($apiOnline) { 'online' } else { 'offline' })"
Write-Output "State:     $statePath"
Write-Output "Log:       $webLog"
Write-Output ""
Write-Output "The panel opens even when the API is offline. Start a backend separately when you want live jobs."
Write-Output "Stop the web panel with: npm run tryout:stop"
