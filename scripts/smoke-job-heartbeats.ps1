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

Set-Location $root
$env:FEISHU_ADAPTER_ENABLED = "false"
$env:FEISHU_DRY_RUN = "true"
$env:OPENCLAW_AGENT_MODE = "mock"
Remove-Item Env:\DBOS_TEST_CRASH_ONCE_AFTER -ErrorAction SilentlyContinue

npm run dev:start | Out-Host

$suffix = [guid]::NewGuid().ToString("N").Substring(0, 8)
$marker = "heartbeat-smoke-$suffix"
$jobId = $null

try {
  $seedScript = @'
import { createJob } from "./packages/db/src/jobs";
import { closePool, pool } from "./packages/db/src/pool";

const marker = process.env.HB_SMOKE_MARKER;
if (!marker) {
  throw new Error("HB_SMOKE_MARKER missing");
}

const job = await createJob({
  rawPrompt: `Heartbeat smoke ${marker}`,
  ingressOrigin: "http",
  routingMode: "supervisor_pipeline",
  maxModelCalls: 1
});

await pool.query(
  `update agent.jobs
   set status = 'running',
       heartbeat_at = now() - interval '100 years',
       heartbeat_status = 'healthy',
       heartbeat_source = 'smoke.seed',
       heartbeat_note = null,
       stalled_at = null,
       updated_at = now() - interval '100 years'
   where id = $1`,
  [job.id]
);

console.log(JSON.stringify({ jobId: job.id, marker }));
await closePool();
'@

  $env:HB_SMOKE_MARKER = $marker
  $seedOutput = $seedScript | node --import tsx --input-type=module -
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to seed stale heartbeat job"
  }
  $seed = $seedOutput | ConvertFrom-Json
  $jobId = $seed.jobId
  Assert-True -Condition ([bool]$jobId) -Message "seeded job id missing"

  $before = Invoke-RestMethod `
    -Uri "$apiBaseUrl/runtime/heartbeats?timeoutSeconds=60&limit=20" `
    -Headers $apiHeaders
  Assert-True -Condition ([int]$before.staleCandidates -ge 1) -Message "stale heartbeat candidate should be visible before scan"

  $scan = Invoke-RestMethod `
    -Uri "$apiBaseUrl/runtime/heartbeats/scan" `
    -Method Post `
    -Headers $apiHeaders `
    -ContentType "application/json" `
    -Body (@{
      timeoutSeconds = 60
      limit = 1
    } | ConvertTo-Json)
  $scannedJob = @($scan.stalledJobs | Where-Object { $_.id -eq $jobId })
  Assert-Equal -Actual $scannedJob.Count -Expected 1 -Message "heartbeat scan should mark seeded job stalled"

  $job = Invoke-RestMethod -Uri "$apiBaseUrl/jobs/$jobId" -Headers $apiHeaders
  Assert-Equal -Actual $job.heartbeatStatus -Expected "stalled" -Message "job heartbeat status"
  Assert-Equal -Actual $job.heartbeatSource -Expected "heartbeat.scan" -Message "job heartbeat source"
  Assert-True -Condition ([bool]$job.stalledAt) -Message "job stalledAt missing"

  $diagnostics = Invoke-RestMethod -Uri "$apiBaseUrl/runtime/diagnostics" -Headers $apiHeaders
  $heartbeatCheck = @($diagnostics.checks | Where-Object { $_.id -eq "job_heartbeats" })[0]
  if ($null -eq $heartbeatCheck) {
    throw "job_heartbeats diagnostic check missing"
  }
  Assert-Equal -Actual $heartbeatCheck.status -Expected "warning" -Message "heartbeat diagnostics should warn on stalled job"

  [pscustomobject]@{
    ok = $true
    jobId = $jobId
    marker = $marker
    timeoutSeconds = $scan.timeoutSeconds
    scanned = $scan.scanned
    heartbeatStatus = $job.heartbeatStatus
    diagnosticsStatus = $heartbeatCheck.status
    checks = @(
      "heartbeat_summary_reports_stale_candidates",
      "heartbeat_scan_marks_stalled_job",
      "job_endpoint_returns_heartbeat_fields",
      "runtime_diagnostics_reports_job_heartbeats"
    )
  } | ConvertTo-Json -Depth 5
} finally {
  Remove-Item Env:\HB_SMOKE_MARKER -ErrorAction SilentlyContinue
  if ($jobId) {
    try {
      Invoke-RestMethod `
        -Uri "$apiBaseUrl/jobs/$jobId/cancel" `
        -Method Post `
        -Headers $apiHeaders `
        -ContentType "application/json" `
        -Body (@{
          reason = "job heartbeat smoke cleanup"
          requesterId = "job-heartbeat-smoke"
        } | ConvertTo-Json) | Out-Null
    } catch {
      Write-Warning "Failed to clean up heartbeat smoke job ${jobId}: $($_.Exception.Message)"
    }
  }
}
