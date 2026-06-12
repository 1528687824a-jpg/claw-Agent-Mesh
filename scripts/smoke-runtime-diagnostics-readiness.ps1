$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "honeycomb-api-token.ps1")
$apiHeaders = Get-HoneycombApiHeaders
$apiBaseUrl = "http://127.0.0.1:3000"

function Assert-Equal {
  param(
    [object]$Actual,
    [object]$Expected,
    [string]$Message
  )

  if ($Actual -ne $Expected) {
    throw "$Message. Expected '$Expected', got '$Actual'"
  }
}

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )

  if (-not $Condition) {
    throw $Message
  }
}

function Safe-SecretName {
  param([string]$Value)
  return ($Value -replace '[^A-Za-z0-9_.-]', '_')
}

Set-Location $root
$env:FEISHU_ADAPTER_ENABLED = "false"
$env:FEISHU_DRY_RUN = "true"
$env:OPENCLAW_AGENT_MODE = "mock"
Remove-Item Env:\DBOS_TEST_CRASH_ONCE_AFTER -ErrorAction SilentlyContinue

npm run dev:start | Out-Host

$suffix = [guid]::NewGuid().ToString("N").Substring(0, 8)
$providerId = "diag-secret-missing-$suffix"
$secretRoot = if ($env:HONEYCOMB_SECRET_DIR) {
  $env:HONEYCOMB_SECRET_DIR
} else {
  Join-Path $env:APPDATA "io.agentopenclaw.desktop\honeycomb-secrets"
}
$keyPath = Join-Path (Join-Path $secretRoot "providers") "$(Safe-SecretName $providerId).key"

Invoke-RestMethod `
  -Uri "$apiBaseUrl/providers" `
  -Method Post `
  -Headers $apiHeaders `
  -ContentType "application/json" `
  -Body (@{
    id = $providerId
    displayName = "Diagnostics Missing Secret"
    baseUrl = "https://api.example.invalid/v1"
    defaultModel = "diag-secret-model"
    apiKey = "sk-diag-secret-$suffix"
  } | ConvertTo-Json -Depth 6) | Out-Null

Assert-Equal -Actual (Test-Path -LiteralPath $keyPath) -Expected $true -Message "provider secret file should exist"
Remove-Item -LiteralPath $keyPath -Force

npm run dev:stop | Out-Host
Start-Sleep -Seconds 2
npm run dev:start | Out-Host

$diagnostics = Invoke-RestMethod -Uri "$apiBaseUrl/runtime/diagnostics" -Headers $apiHeaders
$providerCheck = @($diagnostics.checks | Where-Object { $_.id -eq "providers" })[0]
$e2eCheck = @($diagnostics.checks | Where-Object { $_.id -eq "real_provider_e2e" })[0]

if ($null -eq $providerCheck) {
  throw "providers diagnostic check missing"
}
if ($null -eq $e2eCheck) {
  throw "real_provider_e2e diagnostic check missing"
}

$missing = @($providerCheck.details.missingSecrets | Where-Object { $_.id -eq $providerId })
Assert-Equal -Actual $missing.Count -Expected 1 -Message "missing secret provider should be reported"
Assert-Equal -Actual $e2eCheck.status -Expected "warning" -Message "real provider readiness should warn without verified live provider"
Assert-True -Condition ($diagnostics.recommendedActions -contains "Verify a live external provider with a local API key before running real OpenClaw E2E.") -Message "real provider readiness action missing"

[pscustomobject]@{
  ok = $true
  providerId = $providerId
  diagnosticsStatus = $diagnostics.status
  providerCheckStatus = $providerCheck.status
  e2eCheckStatus = $e2eCheck.status
  checks = @(
    "runtime_diagnostics_reconciles_provider_secret_status",
    "real_provider_e2e_readiness_check_present",
    "real_provider_e2e_recommends_live_verified_provider"
  )
} | ConvertTo-Json -Depth 5
