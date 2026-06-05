$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

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

function Start-DevForExperienceMemorySmoke {
  Set-Location $root
  $env:FEISHU_ADAPTER_ENABLED = "false"
  $env:FEISHU_DRY_RUN = "true"
  $env:OPENCLAW_AGENT_MODE = "mock"
  Remove-Item Env:\DBOS_TEST_CRASH_ONCE_AFTER -ErrorAction SilentlyContinue

  npm run dev:start | Out-Host
}

function Create-SmokeJob {
  param([string]$Marker)

  $body = @{
    prompt = "Experience memory smoke $Marker"
    requesterId = "experience-memory-smoke"
    routingMode = "pipeline"
    maxModelCalls = 20
  } | ConvertTo-Json

  Invoke-RestMethod `
    -Uri "http://localhost:3000/jobs" `
    -Method Post `
    -ContentType "application/json; charset=utf-8" `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
}

function Wait-ForTerminalStatus {
  param([string]$JobId)

  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Seconds 1
    $job = Invoke-RestMethod -Uri "http://localhost:3000/jobs/$JobId"
    if (@("succeeded", "failed", "cancelled", "waiting_for_human") -contains $job.status) {
      return $job
    }
  }

  throw "Timed out waiting for $JobId to reach a terminal status"
}

function Find-ExperienceForJob {
  param(
    [string]$JobId,
    [string]$Status
  )

  $response = Invoke-RestMethod -Uri "http://localhost:3000/memory/experiences?status=$Status&limit=200"
  $matches = @($response.experiences | Where-Object { $_.sourceJobId -eq $JobId })
  Assert-Equal -Actual $matches.Count -Expected 1 -Message "experience count for $JobId in status $Status"
  return $matches[0]
}

Start-DevForExperienceMemorySmoke

$marker = "experience-" + ([guid]::NewGuid().ToString("N").Substring(0, 8))
$adoptJob = Create-SmokeJob -Marker "$marker-adopt"
$adoptJobResult = Wait-ForTerminalStatus -JobId $adoptJob.jobId
Assert-Equal -Actual $adoptJobResult.status -Expected "succeeded" -Message "adopt probe job status"

$candidate = Find-ExperienceForJob -JobId $adoptJob.jobId -Status "candidate"
Assert-Equal -Actual $candidate.kind -Expected "routing_outcome" -Message "candidate kind"
Assert-Equal -Actual $candidate.scope -Expected "routing_mode" -Message "candidate scope"
Assert-Equal -Actual $candidate.scopeKey -Expected "pipeline" -Message "candidate scope key"
Assert-True -Condition ($candidate.confidence -gt 0 -and $candidate.confidence -lt 1) -Message "candidate confidence must be conservative"
Assert-True -Condition (@($candidate.evidence).Count -gt 0) -Message "candidate evidence is required"

$adoptedResponse = Invoke-RestMethod `
  -Uri "http://localhost:3000/memory/experiences/$($candidate.id)/adopt" `
  -Method Post `
  -ContentType "application/json" `
  -Body "{}"
Assert-Equal -Actual $adoptedResponse.experience.status -Expected "adopted" -Message "adopt action status"
$adopted = Find-ExperienceForJob -JobId $adoptJob.jobId -Status "adopted"
Assert-True -Condition ([bool]$adopted.adoptedAt) -Message "adopted experience must record adoptedAt"
$adoptTimelineBeforeRepeat = Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($adoptJob.jobId)/timeline?limit=500"
$adoptEventsBeforeRepeat = @($adoptTimelineBeforeRepeat.timeline | Where-Object { $_.eventType -eq "experience.adopted" })
Assert-True -Condition ($adoptEventsBeforeRepeat.Count -gt 0) -Message "first adopt must write timeline evidence"

$adoptedAgain = Invoke-RestMethod `
  -Uri "http://localhost:3000/memory/experiences/$($candidate.id)/adopt" `
  -Method Post `
  -ContentType "application/json" `
  -Body "{}"
Assert-Equal -Actual $adoptedAgain.changed -Expected $false -Message "repeated adopt must be idempotent"
$adoptTimeline = Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($adoptJob.jobId)/timeline?limit=500"
$adoptEvents = @($adoptTimeline.timeline | Where-Object { $_.eventType -eq "experience.adopted" })
Assert-Equal -Actual $adoptEvents.Count -Expected $adoptEventsBeforeRepeat.Count -Message "repeated adopt must not duplicate timeline events"

$rejectJob = Create-SmokeJob -Marker "$marker-reject"
$rejectJobResult = Wait-ForTerminalStatus -JobId $rejectJob.jobId
Assert-Equal -Actual $rejectJobResult.status -Expected "succeeded" -Message "reject probe job status"

$rejectCandidate = Find-ExperienceForJob -JobId $rejectJob.jobId -Status "candidate"
$rejectedResponse = Invoke-RestMethod `
  -Uri "http://localhost:3000/memory/experiences/$($rejectCandidate.id)/reject" `
  -Method Post `
  -ContentType "application/json" `
  -Body "{}"
Assert-Equal -Actual $rejectedResponse.experience.status -Expected "rejected" -Message "reject action status"
$rejected = Find-ExperienceForJob -JobId $rejectJob.jobId -Status "rejected"
Assert-True -Condition ([bool]$rejected.rejectedAt) -Message "rejected experience must record rejectedAt"

$summary = Invoke-RestMethod -Uri "http://localhost:3000/memory/experiences?limit=20"
Assert-True -Condition ($summary.summary.adopted -ge 1) -Message "summary adopted count"
Assert-True -Condition ($summary.summary.rejected -ge 1) -Message "summary rejected count"

[pscustomobject]@{
  ok = $true
  marker = $marker
  adoptedExperienceId = $adopted.id
  rejectedExperienceId = $rejected.id
  confidence = $candidate.confidence
  summary = $summary.summary
  checked = @(
    "successful_job_creates_candidate",
    "candidate_has_source_evidence_confidence_scope",
    "explicit_adopt",
    "idempotent_repeated_adopt",
    "explicit_reject",
    "status_filtered_listing",
    "summary_counts"
  )
} | ConvertTo-Json -Depth 5
