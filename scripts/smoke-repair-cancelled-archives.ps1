$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

function Start-DevForRepairSmoke {
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

function Wait-ForStatus {
  param(
    [string]$JobId,
    [string[]]$Statuses
  )

  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 1
    $job = Invoke-RestMethod -Uri "http://localhost:3000/jobs/$JobId"
    if ($Statuses -contains $job.status) {
      return $job
    }
  }

  throw "Timed out waiting for $JobId to reach $($Statuses -join ', ')"
}

Start-DevForRepairSmoke

$createBody = @{
  prompt = "Repair cancelled archives smoke: create a legacy cancelled job fixture."
  requesterId = "repair-cancelled-archives-smoke"
  routingMode = "supervisor_pipeline"
  maxModelCalls = 1
} | ConvertTo-Json

$created = Invoke-RestMethod `
  -Uri "http://localhost:3000/jobs" `
  -Method Post `
  -ContentType "application/json" `
  -Body $createBody

Assert-True -Condition ([bool]$created.jobId) -Message "jobId missing"

$waiting = Wait-ForStatus -JobId $created.jobId -Statuses @("waiting_for_human", "failed", "succeeded", "cancelled")
Assert-Equal -Actual $waiting.status -Expected "waiting_for_human" -Message "fixture should wait for human"

$cancelBody = @{
  reason = "repair cancelled archives smoke"
  requesterId = "repair-cancelled-archives-smoke"
} | ConvertTo-Json

$cancelled = Invoke-RestMethod `
  -Uri "http://localhost:3000/jobs/$($created.jobId)/cancel" `
  -Method Post `
  -ContentType "application/json" `
  -Body $cancelBody
Assert-Equal -Actual $cancelled.status -Expected "cancelled" -Message "fixture cancel status"

$resetLegacySql = @'
import { closePool, pool } from "./packages/db/src/pool";

const jobId = process.argv[2];
if (!jobId) {
  throw new Error("job id missing");
}

await pool.query(
  `delete from agent.job_events
   where job_id = $1
     and event_type = 'job.archived'`,
  [jobId]
);
await pool.query(
  `delete from agent.agent_events
   where job_id = $1
     and event_type = 'job.archived'`,
  [jobId]
);
await pool.query(
  `update agent.jobs
   set archived_at = null,
       retention_until = null,
       cleanup_status = 'active',
       retention_policy = '{}'::jsonb,
       updated_at = now()
   where id = $1`,
  [jobId]
);

await closePool();
'@

$resetLegacySql | npx tsx - $created.jobId | Out-Host

$legacy = Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($created.jobId)"
Assert-Equal -Actual $legacy.status -Expected "cancelled" -Message "legacy fixture status"
Assert-Equal -Actual $legacy.archivedAt -Expected $null -Message "legacy fixture archivedAt"
Assert-Equal -Actual $legacy.retentionUntil -Expected $null -Message "legacy fixture retentionUntil"
Assert-Equal -Actual $legacy.cleanupStatus -Expected "active" -Message "legacy fixture cleanupStatus"

$dryRunText = npm run maintenance:repair-cancelled-archives -- --job-id $created.jobId
$dryRun = $dryRunText | Select-Object -Last 1 | ConvertFrom-Json
Assert-Equal -Actual $dryRun.apply -Expected $false -Message "dry-run apply flag"
Assert-Equal -Actual $dryRun.candidateCount -Expected 1 -Message "dry-run candidate count"
Assert-Equal -Actual $dryRun.repairedCount -Expected 0 -Message "dry-run repaired count"

$stillLegacy = Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($created.jobId)"
Assert-Equal -Actual $stillLegacy.archivedAt -Expected $null -Message "dry-run should not archive"

$applyText = npm run maintenance:repair-cancelled-archives -- --job-id $created.jobId --apply
$apply = $applyText | Select-Object -Last 1 | ConvertFrom-Json
Assert-Equal -Actual $apply.apply -Expected $true -Message "apply flag"
Assert-Equal -Actual $apply.candidateCount -Expected 1 -Message "apply candidate count"
Assert-Equal -Actual $apply.repairedCount -Expected 1 -Message "apply repaired count"

$repaired = Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($created.jobId)"
Assert-Equal -Actual $repaired.status -Expected "cancelled" -Message "repaired status"
Assert-True -Condition ([bool]$repaired.archivedAt) -Message "repaired archivedAt"
Assert-True -Condition ([bool]$repaired.retentionUntil) -Message "repaired retentionUntil"
Assert-Equal -Actual $repaired.cleanupStatus -Expected "retained" -Message "repaired cleanupStatus"
Assert-Equal -Actual $repaired.retentionPolicy.archiveReason -Expected "job_cancelled" -Message "repaired archive reason"

$timeline = Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($created.jobId)/timeline?limit=500"
$archiveEvents = @(
  $timeline.timeline | Where-Object { $_.source -eq "job_event" -and $_.eventType -eq "job.archived" }
)
Assert-Equal -Actual $archiveEvents.Count -Expected 1 -Message "repair should append one job.archived job event"

[pscustomobject]@{
  ok = $true
  jobId = $created.jobId
  dryRunCandidateCount = $dryRun.candidateCount
  applyRepairedCount = $apply.repairedCount
  cleanupStatus = $repaired.cleanupStatus
  archivedAt = $repaired.archivedAt
  retentionUntil = $repaired.retentionUntil
  timelineArchiveEvents = $archiveEvents.Count
  checked = @(
    "legacy_cancelled_fixture",
    "dry_run_finds_candidate_without_write",
    "apply_repairs_archive_fields",
    "repair_appends_job_archived_event",
    "archive_reason_job_cancelled"
  )
} | ConvertTo-Json -Depth 4
