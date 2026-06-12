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

function Invoke-Repair {
  param([hashtable]$Body)

  return Invoke-RestMethod `
    -Uri "$apiBaseUrl/runtime/repair" `
    -Method Post `
    -Headers $apiHeaders `
    -ContentType "application/json" `
    -Body ($Body | ConvertTo-Json -Depth 8)
}

Set-Location $root
$env:FEISHU_ADAPTER_ENABLED = "false"
$env:FEISHU_DRY_RUN = "true"
$env:OPENCLAW_AGENT_MODE = "mock"
Remove-Item Env:\DBOS_TEST_CRASH_ONCE_AFTER -ErrorAction SilentlyContinue

npm run dev:start | Out-Host

$actionsResponse = Invoke-RestMethod -Uri "$apiBaseUrl/runtime/repair/actions" -Headers $apiHeaders
$actionIds = @($actionsResponse.actions | ForEach-Object { $_.id })
foreach ($expected in @(
  "providers.reconcileSecrets",
  "openclaw.runtime.start",
  "openclaw.runtime.restart",
  "agents.seedDefaults",
  "openclaw.sync.apply"
)) {
  Assert-True -Condition ($actionIds -contains $expected) -Message "repair action missing: $expected"
}

$suffix = [guid]::NewGuid().ToString("N").Substring(0, 8)
$providerId = "repair-secret-stale-$suffix"
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
    displayName = "Repair Stale Secret"
    baseUrl = "https://api.example.invalid/v1"
    defaultModel = "repair-secret-model"
    apiKey = "sk-repair-secret-$suffix"
  } | ConvertTo-Json -Depth 6) | Out-Null

Assert-Equal -Actual (Test-Path -LiteralPath $keyPath) -Expected $true -Message "provider secret file should exist"
Remove-Item -LiteralPath $keyPath -Force

npm run dev:stop | Out-Host
Start-Sleep -Seconds 2
npm run dev:start | Out-Host

$reconcile = Invoke-Repair -Body @{
  action = "providers.reconcileSecrets"
}
Assert-Equal -Actual $reconcile.ok -Expected $true -Message "provider reconcile ok"
Assert-True -Condition (@($reconcile.details.changedProviders | Where-Object { $_.id -eq $providerId }).Count -eq 1) -Message "stale provider should be reconciled"

$runtimeRoot = Join-Path $root ".runtime\repair-actions-openclaw-$suffix"
$runtimeStart = Invoke-Repair -Body @{
  action = "openclaw.runtime.start"
  rootPath = $runtimeRoot
}
Assert-Equal -Actual $runtimeStart.ok -Expected $true -Message "runtime start repair ok"
Assert-True -Condition (Test-Path -LiteralPath (Join-Path $runtimeRoot "agents")) -Message "runtime agents dir missing"
Assert-True -Condition (Test-Path -LiteralPath (Join-Path $runtimeRoot "workspace")) -Message "runtime workspace dir missing"
Assert-True -Condition (Test-Path -LiteralPath (Join-Path $runtimeRoot "config")) -Message "runtime config dir missing"

$seed = Invoke-Repair -Body @{
  action = "agents.seedDefaults"
  panelAgentName = "Repair Smoke Supervisor"
}
Assert-Equal -Actual $seed.ok -Expected $true -Message "seed agents repair ok"
Assert-True -Condition (@($seed.details.agents).Count -ge 6) -Message "default agents should be seeded"

$sync = Invoke-Repair -Body @{
  action = "openclaw.sync.apply"
  rootPath = $runtimeRoot
}
Assert-Equal -Actual $sync.ok -Expected $true -Message "openclaw sync repair ok"
Assert-True -Condition ([int]$sync.details.writtenFileCount -gt 0) -Message "sync repair should write files"
Assert-True -Condition (Test-Path -LiteralPath (Join-Path $runtimeRoot "agents\main-agent\agent\AGENTS.md")) -Message "main-agent prompt missing"
Assert-True -Condition (Test-Path -LiteralPath (Join-Path $runtimeRoot "agent-model-configs.json")) -Message "agent model config missing"

[pscustomobject]@{
  ok = $true
  providerId = $providerId
  runtimeRoot = $runtimeRoot
  actionCount = @($actionsResponse.actions).Count
  writtenFileCount = $sync.details.writtenFileCount
  checks = @(
    "repair_actions_catalog",
    "repair_reconciles_provider_secret_status",
    "repair_prepares_openclaw_runtime",
    "repair_seeds_default_agents",
    "repair_applies_openclaw_sync"
  )
} | ConvertTo-Json -Depth 5
