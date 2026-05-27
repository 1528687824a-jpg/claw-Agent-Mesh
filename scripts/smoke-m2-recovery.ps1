$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$crashHook = "after-runStageAgent-stage-002-attempt-01"

function Start-DevWithCrashHook {
  param(
    [string]$Hook
  )

  Set-Location $root
  $env:FEISHU_DRY_RUN = "true"
  $env:OPENCLAW_AGENT_MODE = "mock"

  if ($Hook) {
    $env:DBOS_TEST_CRASH_ONCE_AFTER = $Hook
  } else {
    Remove-Item Env:\DBOS_TEST_CRASH_ONCE_AFTER -ErrorAction SilentlyContinue
  }

  npm run dev:start | Out-Host
}

function Wait-ForTerminalStatus {
  param(
    [string]$JobId
  )

  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 1
    $job = Invoke-RestMethod -Uri "http://localhost:3000/jobs/$JobId"
    if (@("succeeded", "failed", "waiting_for_human", "cancelled") -contains $job.status) {
      return $job.status
    }
  }

  throw "Timed out waiting for $JobId"
}

function Test-ApiAlive {
  try {
    Invoke-RestMethod -Uri "http://localhost:3000/health" -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Invoke-RecoverySmoke {
  param(
    [string]$Mode,
    [string]$Prompt,
    [int]$ExpectedStages,
    [int]$ExpectedAttempts,
    [int]$ExpectedReviews,
    [int]$ExpectedDiscussionRounds,
    [int]$ExpectedDiscussionMessages,
    [int]$DiscussionRoundsConfig,
    [int]$ExpectedSynthesisArtifacts,
    [int]$ExpectedFinalTestEvents
  )

  Start-DevWithCrashHook -Hook $crashHook

  $body = @{
    rawPrompt = $Prompt
    requesterId = "m2-recovery-smoke"
    routingMode = $Mode
  }
  if ($DiscussionRoundsConfig -gt 0) {
    $body["discussionRounds"] = $DiscussionRoundsConfig
  }
  $body = $body | ConvertTo-Json

  $created = Invoke-RestMethod -Uri "http://localhost:3000/jobs" -Method Post -ContentType "application/json" -Body $body
  $jobId = $created.jobId
  Start-Sleep -Seconds 8
  $apiAliveAfterCrash = Test-ApiAlive

  Start-DevWithCrashHook -Hook ""
  $status = Wait-ForTerminalStatus -JobId $jobId
  $details = Invoke-RestMethod -Uri "http://localhost:3000/jobs/$jobId/details"

  $stageAgentRequested = @(
    $details.events | Where-Object {
      $_.event_type -eq "tool.openclaw_agent_requested" -and $_.payload.actionType -eq "stage-agent"
    }
  ).Count
  $stageAgentCompleted = @(
    $details.events | Where-Object {
      $_.event_type -eq "tool.openclaw_agent_completed" -and $_.payload.actionType -eq "stage-agent"
    }
  ).Count
  $stageAgentReused = @(
    $details.events | Where-Object {
      $_.event_type -eq "tool.openclaw_agent_reused" -and $_.payload.actionType -eq "stage-agent"
    }
  ).Count
  $discussionRounds = @(
    $details.events | Where-Object { $_.event_type -eq "discussion.round_completed" }
  ).Count
  $discussionMessages = @(
    $details.groupMessages | Where-Object { $_.message_type -eq "discussion_handoff" }
  ).Count
  $synthesisArtifacts = @(
    $details.artifacts | Where-Object { $_.type -eq "discussion_synthesis" }
  ).Count
  $finalTestEvents = @(
    $details.events | Where-Object { $_.event_type -eq "final.test_completed" }
  ).Count

  $result = [pscustomobject]@{
    mode = $Mode
    jobId = $jobId
    apiAliveAfterCrash = $apiAliveAfterCrash
    status = $status
    stages = @($details.stages).Count
    attempts = @($details.attempts).Count
    reviews = @($details.reviews).Count
    stageAgentRequested = $stageAgentRequested
    stageAgentCompleted = $stageAgentCompleted
    stageAgentReused = $stageAgentReused
    discussionRounds = $discussionRounds
    discussionMessages = $discussionMessages
    configuredDiscussionRounds = $details.job.discussion_rounds
    synthesisArtifacts = $synthesisArtifacts
    finalTestEvents = $finalTestEvents
  }

  if ($result.apiAliveAfterCrash) { throw "$Mode did not crash at expected hook" }
  if ($result.status -ne "succeeded") { throw "$Mode status was $($result.status)" }
  if ($result.stages -ne $ExpectedStages) { throw "$Mode stage count was $($result.stages)" }
  if ($result.attempts -ne $ExpectedAttempts) { throw "$Mode attempt count was $($result.attempts)" }
  if ($result.reviews -ne $ExpectedReviews) { throw "$Mode review count was $($result.reviews)" }
  if ($result.stageAgentRequested -ne $ExpectedAttempts) { throw "$Mode stage-agent request count was $($result.stageAgentRequested)" }
  if ($result.stageAgentCompleted -ne $ExpectedAttempts) { throw "$Mode stage-agent completion count was $($result.stageAgentCompleted)" }
  if ($result.stageAgentReused -ne 0) { throw "$Mode unexpectedly reused stage-agent calls after checkpoint crash" }
  if ($result.discussionRounds -ne $ExpectedDiscussionRounds) { throw "$Mode discussion round count was $($result.discussionRounds)" }
  if ($result.discussionMessages -ne $ExpectedDiscussionMessages) { throw "$Mode discussion message count was $($result.discussionMessages)" }
  if ($DiscussionRoundsConfig -gt 0 -and $result.configuredDiscussionRounds -ne $DiscussionRoundsConfig) { throw "$Mode configured discussion rounds was $($result.configuredDiscussionRounds)" }
  if ($result.synthesisArtifacts -ne $ExpectedSynthesisArtifacts) { throw "$Mode synthesis artifact count was $($result.synthesisArtifacts)" }
  if ($result.finalTestEvents -ne $ExpectedFinalTestEvents) { throw "$Mode final test event count was $($result.finalTestEvents)" }

  return $result
}

$results = @()
$results += Invoke-RecoverySmoke `
  -Mode "pipeline" `
  -Prompt "research current durable workflow recovery patterns, write a short summary, and create an image poster brief" `
  -ExpectedStages 3 `
  -ExpectedAttempts 3 `
  -ExpectedReviews 0 `
  -ExpectedDiscussionRounds 0 `
  -ExpectedDiscussionMessages 0 `
  -DiscussionRoundsConfig 0 `
  -ExpectedSynthesisArtifacts 0 `
  -ExpectedFinalTestEvents 1

$results += Invoke-RecoverySmoke `
  -Mode "master_slave_discussion" `
  -Prompt "research current durable workflow recovery patterns and write a short summary" `
  -ExpectedStages 2 `
  -ExpectedAttempts 6 `
  -ExpectedReviews 0 `
  -ExpectedDiscussionRounds 3 `
  -ExpectedDiscussionMessages 6 `
  -DiscussionRoundsConfig 3 `
  -ExpectedSynthesisArtifacts 1 `
  -ExpectedFinalTestEvents 1

$results | ConvertTo-Json -Depth 3
