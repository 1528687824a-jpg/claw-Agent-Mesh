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
$providerId = "secret-status-smoke-$suffix"
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
    displayName = "Secret Status Smoke"
    baseUrl = "https://api.example.invalid/v1"
    defaultModel = "secret-status-model"
    apiKey = "sk-secret-status-smoke-$suffix"
  } | ConvertTo-Json -Depth 6) | Out-Null

Assert-Equal -Actual (Test-Path -LiteralPath $keyPath) -Expected $true -Message "provider secret file should exist"
Remove-Item -LiteralPath $keyPath -Force

npm run dev:stop | Out-Host
npm run dev:start | Out-Host

$providersResponse = Invoke-RestMethod -Uri "$apiBaseUrl/providers" -Headers $apiHeaders
$provider = @($providersResponse.providers | Where-Object { $_.id -eq $providerId })[0]
if ($null -eq $provider) {
  throw "provider missing from /providers response"
}

Assert-Equal -Actual $provider.apiKeyConfigured -Expected $false -Message "stale provider key status"
Assert-Equal -Actual $provider.apiKeyFingerprint -Expected $null -Message "stale provider fingerprint"
Assert-Equal -Actual $provider.verificationStatus -Expected "unknown" -Message "stale provider verification status"
Assert-Equal -Actual $provider.lastError -Expected "provider_api_key_missing_in_secret_storage" -Message "stale provider lastError"

[pscustomobject]@{
  ok = $true
  providerId = $providerId
  checks = @(
    "provider_secret_saved",
    "provider_secret_removed",
    "providers_endpoint_reconciles_secret_status"
  )
} | ConvertTo-Json -Depth 4
