param(
  [string[]]$Modes = @(
    "supervisor_pipeline",
    "pipeline",
    "classic_master_slave",
    "master_slave_discussion"
  ),
  [int]$JobTimeoutSeconds = 300
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$openClawCli = "/home/administrator/.npm-global/bin/openclaw"
$wslDistro = "Ubuntu-24.04"

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
    [string]$JobId,
    [int]$TimeoutSeconds = 300
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 1
    $job = Invoke-RestMethod -Uri "http://localhost:3000/jobs/$JobId" -TimeoutSec 5
    if (@("succeeded", "failed", "waiting_for_human", "cancelled") -contains $job.status) {
      return $job
    }
  }

  throw "Timed out waiting for $JobId"
}

function Invoke-NpmScript {
  param(
    [string]$ScriptName
  )

  & npm run $ScriptName
  if ($LASTEXITCODE -ne 0) {
    throw "npm run $ScriptName failed with exit code $LASTEXITCODE"
  }
}

Set-Location $root

$version = wsl -d $wslDistro -- $openClawCli --version
Assert-True -Condition ($LASTEXITCODE -eq 0) -Message "OpenClaw CLI version check failed"

$env:OPENCLAW_AGENT_MODE = "real"
$env:OPENCLAW_WSL_DISTRO = $wslDistro
$env:OPENCLAW_CLI = $openClawCli
$env:OPENCLAW_AGENT_TIMEOUT_SECONDS = "180"
$env:FEISHU_ADAPTER_ENABLED = "false"
$env:FEISHU_DRY_RUN = "true"
Remove-Item Env:\AGENT_CLUSTER_CONFIG_PATH -ErrorAction SilentlyContinue
Remove-Item Env:\DBOS_TEST_CRASH_ONCE_AFTER -ErrorAction SilentlyContinue

Invoke-NpmScript "dev:stop"
Invoke-NpmScript "dev:start"

$results = @()

foreach ($mode in $Modes) {
  Write-Output "Starting real OpenClaw routing mode smoke: $mode"
  $body = @{
    prompt = "Write one short sentence confirming the real OpenClaw $mode path works."
    requesterId = "openclaw-real-smoke"
    routingMode = $mode
    maxModelCalls = 8
    classicFinalGateEnabled = $false
    discussionRounds = 2
  } | ConvertTo-Json

  $created = Invoke-RestMethod -Uri "http://localhost:3000/jobs" -Method Post -ContentType "application/json" -Body $body
  Write-Output "Created $mode job: $($created.jobId)"
  $job = Wait-ForTerminalStatus -JobId $created.jobId -TimeoutSeconds $JobTimeoutSeconds
  Assert-Equal -Actual $job.status -Expected "succeeded" -Message "$mode job terminal status"
  Assert-Equal -Actual $job.routingMode -Expected $mode -Message "$mode job routing mode"

  $details = Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($created.jobId)/details"
  $realCompletions = @(
    $details.events | Where-Object {
      $_.event_type -eq "tool.openclaw_agent_completed" -and $_.payload.mode -eq "real"
    }
  )
  Assert-True -Condition ($realCompletions.Count -gt 0) -Message "$mode real OpenClaw completion event missing"

  $stageOutputs = @(
    $details.artifacts | Where-Object { $_.type -eq "stage_output" }
  )
  Assert-True -Condition ($stageOutputs.Count -gt 0) -Message "$mode real mode stage output missing"

  $results += [pscustomobject]@{
    jobId = $created.jobId
    terminalStatus = $job.status
    routingMode = $job.routingMode
    realCompletionEvents = $realCompletions.Count
    stageOutputArtifacts = $stageOutputs.Count
  }
  Write-Output "Completed $mode job: $($created.jobId)"
}

[pscustomobject]@{
  ok = $true
  openClawVersion = $version
  results = $results
  checked = @(
    "openclaw_cli_available",
    "supervisor_pipeline_real_mode_job",
    "pipeline_real_mode_job",
    "classic_master_slave_real_mode_job",
    "master_slave_discussion_real_mode_job",
    "real_openclaw_completion_events",
    "stage_output_artifacts"
  )
} | ConvertTo-Json -Depth 4
