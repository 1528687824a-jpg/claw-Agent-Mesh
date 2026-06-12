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

function Start-DevForSecuritySmoke {
  Set-Location $root
  $env:FEISHU_ADAPTER_ENABLED = "false"
  $env:FEISHU_DRY_RUN = "true"
  $env:OPENCLAW_AGENT_MODE = "mock"
  Remove-Item Env:\DBOS_TEST_CRASH_ONCE_AFTER -ErrorAction SilentlyContinue

  npm run dev:start | Out-Host
}

Start-DevForSecuritySmoke

$created = Invoke-RestMethod `
  -Uri "$apiBaseUrl/jobs" `
  -Method Post `
  -Headers $apiHeaders `
  -ContentType "application/json" `
  -Body (@{
    prompt = "Security controls smoke"
    requesterId = "security-controls-smoke"
    startWorkflow = $false
  } | ConvertTo-Json)

$approval = Invoke-RestMethod `
  -Uri "$apiBaseUrl/approvals" `
  -Method Post `
  -Headers $apiHeaders `
  -ContentType "application/json" `
  -Body (@{
    jobId = $created.jobId
    agentId = "panel-agent"
    requesterActor = "security-controls-smoke"
    toolName = "web.fetch"
    actionType = "web_fetch"
    riskLevel = "medium"
    reason = "Check approval TTL"
    target = "https://example.com/"
    command = "GET https://example.com/"
  } | ConvertTo-Json -Depth 6)

Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($approval.expiresAt)) -Message "approval should get a default expiration"

$approved = Invoke-RestMethod `
  -Uri "$apiBaseUrl/approvals/$($approval.id)/approve" `
  -Method Post `
  -Headers $apiHeaders `
  -ContentType "application/json" `
  -Body (@{
    decidedBy = "spoofed-client"
    decisionReason = "S5 smoke"
  } | ConvertTo-Json)

Assert-Equal -Actual $approved.approval.decidedBy -Expected "desktop-app" -Message "approval decidedBy should be server controlled"

$consumed = Invoke-RestMethod `
  -Uri "$apiBaseUrl/approvals/$($approval.id)/consume" `
  -Method Post `
  -Headers $apiHeaders `
  -ContentType "application/json" `
  -Body (@{
    consumedBy = "security-controls-smoke"
  } | ConvertTo-Json)

Assert-Equal -Actual $consumed.approval.status -Expected "consumed" -Message "fresh approval should be consumable"

$expiredApproval = Invoke-RestMethod `
  -Uri "$apiBaseUrl/approvals" `
  -Method Post `
  -Headers $apiHeaders `
  -ContentType "application/json" `
  -Body (@{
    jobId = $created.jobId
    agentId = "panel-agent"
    requesterActor = "security-controls-smoke"
    toolName = "workspace.writeFile"
    actionType = "file_write"
    riskLevel = "high"
    reason = "Expired approval smoke"
    target = "smoke"
    expiresAt = (Get-Date).ToUniversalTime().AddMinutes(-1).ToString("o")
  } | ConvertTo-Json -Depth 6)

$expiredStatus = $null
$expiredError = ""
try {
  Invoke-RestMethod `
    -Uri "$apiBaseUrl/approvals/$($expiredApproval.id)/approve" `
    -Method Post `
    -Headers $apiHeaders `
    -ContentType "application/json" `
    -Body (@{
      decisionReason = "should fail"
    } | ConvertTo-Json) | Out-Null
} catch {
  $expiredStatus = [int]$_.Exception.Response.StatusCode
  $expiredError = (($_.ErrorDetails.Message | ConvertFrom-Json).error)
}

Assert-Equal -Actual $expiredStatus -Expected 409 -Message "expired approval should not be approvable"
Assert-Equal -Actual $expiredError -Expected "approval_expired" -Message "expired approval error"

$expiredAfter = Invoke-RestMethod `
  -Uri "$apiBaseUrl/approvals/$($expiredApproval.id)" `
  -Headers $apiHeaders
Assert-Equal -Actual $expiredAfter.status -Expected "expired" -Message "expired approval should be persisted"

$webFetchScript = @'
import { runWebFetch, WebFetchError } from "./apps/orchestrator-api/src/web-tools";

try {
  await runWebFetch({ url: "http://127.0.0.1:3000/health" });
  throw new Error("private network fetch unexpectedly succeeded");
} catch (error) {
  if (!(error instanceof WebFetchError) || error.code !== "private_network_blocked") {
    throw error;
  }
}
'@

$webFetchScript | npx tsx -

[pscustomobject]@{
  ok = $true
  jobId = $created.jobId
  approvalId = $approval.id
  expiredApprovalId = $expiredApproval.id
  checks = @(
    "approval_default_expiration",
    "approval_decider_server_controlled",
    "fresh_approval_consumable",
    "expired_approval_rejected",
    "private_network_fetch_blocked"
  )
} | ConvertTo-Json -Depth 4
