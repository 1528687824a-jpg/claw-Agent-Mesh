$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

function Start-DevForHttpOnlySmoke {
  Set-Location $root
  $env:FEISHU_ADAPTER_ENABLED = "false"
  $env:FEISHU_DRY_RUN = "true"
  $env:OPENCLAW_AGENT_MODE = "mock"
  Remove-Item Env:\DBOS_TEST_CRASH_ONCE_AFTER -ErrorAction SilentlyContinue

  npm run dev:start | Out-Host
}

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

function Wait-ForTerminalStatus {
  param(
    [string]$JobId
  )

  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 1
    $job = Invoke-RestMethod -Uri "http://localhost:3000/jobs/$JobId"
    if (@("succeeded", "failed", "waiting_for_human", "cancelled") -contains $job.status) {
      return $job
    }
  }

  throw "Timed out waiting for $JobId"
}

Start-DevForHttpOnlySmoke

$createBody = @{
  prompt = "HTTP-only smoke: run the mock multi-agent pipeline and produce a short final note"
  requesterId = "http-only-smoke"
  routingMode = "supervisor_pipeline"
} | ConvertTo-Json

$created = Invoke-RestMethod `
  -Uri "http://localhost:3000/jobs" `
  -Method Post `
  -ContentType "application/json" `
  -Body $createBody

Assert-True -Condition ([bool]$created.jobId) -Message "jobId missing"
Assert-Equal -Actual $created.ingressOrigin -Expected "http" -Message "created ingress origin"
Assert-Equal -Actual $created.status -Expected "queued" -Message "created status"

$job = Wait-ForTerminalStatus -JobId $created.jobId
Assert-Equal -Actual $job.status -Expected "succeeded" -Message "job terminal status"
Assert-Equal -Actual $job.ingressOrigin -Expected "http" -Message "job ingress origin"
Assert-Equal -Actual $job.feishuMessageId -Expected $null -Message "HTTP job should not have a Feishu message id"

$messages = Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($created.jobId)/messages"
Assert-Equal -Actual $messages.ingressOrigin -Expected "http" -Message "messages ingress origin"
Assert-True -Condition (@($messages.messages).Count -gt 0) -Message "expected at least one group message"

$feishuDelivered = @(
  $messages.messages | Where-Object { $_.feishuMessageId }
)
Assert-Equal -Actual $feishuDelivered.Count -Expected 0 -Message "HTTP-only smoke should not deliver Feishu messages"

$finalMessages = @(
  $messages.messages | Where-Object { $_.messageType -eq "final_output" }
)
Assert-True -Condition ($finalMessages.Count -gt 0) -Message "expected final_output message"

[pscustomobject]@{
  ok = $true
  jobId = $created.jobId
  terminalStatus = $job.status
  ingressOrigin = $job.ingressOrigin
  messageCount = @($messages.messages).Count
  finalMessageCount = $finalMessages.Count
  checked = @(
    "http_create_job",
    "http_poll_terminal_status",
    "http_get_job_messages",
    "feishu_adapter_disabled"
  )
} | ConvertTo-Json -Depth 4
