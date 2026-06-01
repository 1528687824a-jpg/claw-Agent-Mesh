$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

function Start-DevForTimelineSinceSmoke {
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

Start-DevForTimelineSinceSmoke

$createBody = @{
  prompt = "Timeline since smoke: run the mock pipeline and produce enough events for incremental timeline paging."
  requesterId = "timeline-since-smoke"
  routingMode = "supervisor_pipeline"
} | ConvertTo-Json

$created = Invoke-RestMethod `
  -Uri "http://localhost:3000/jobs" `
  -Method Post `
  -ContentType "application/json" `
  -Body $createBody

Assert-True -Condition ([bool]$created.jobId) -Message "jobId missing"

$job = Wait-ForTerminalStatus -JobId $created.jobId
Assert-Equal -Actual $job.status -Expected "succeeded" -Message "job terminal status"

$sameTimestampFixture = @'
import { closePool, pool } from "./packages/db/src/pool";

const jobId = process.argv[2];
if (!jobId) {
  throw new Error("job id missing");
}

const stamp = new Date().toISOString();
await pool.query(
  `insert into agent.job_events (job_id, event_type, payload, created_at)
   values
     ($1, 'smoke.same_timestamp_a', '{}'::jsonb, $2::timestamptz),
     ($1, 'smoke.same_timestamp_b', '{}'::jsonb, $2::timestamptz)`,
  [jobId, stamp]
);

await closePool();
'@

$sameTimestampFixture | npx tsx - $created.jobId | Out-Host

$fullTimeline = Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($created.jobId)/timeline?limit=1000"
$fullItems = @($fullTimeline.timeline)
Assert-True -Condition ($fullItems.Count -gt 6) -Message "timeline should have enough events for since pagination"
Assert-Equal -Actual $fullTimeline.summary.totalTimelineItems -Expected $fullItems.Count -Message "full totalTimelineItems"
Assert-Equal -Actual $fullTimeline.summary.matchedTimelineItems -Expected $fullItems.Count -Message "full matchedTimelineItems"
Assert-Equal -Actual $fullTimeline.summary.hasMore -Expected $false -Message "full timeline hasMore"
Assert-Equal -Actual $fullTimeline.summary.since -Expected $null -Message "full timeline since should be null"
Assert-Equal -Actual $fullTimeline.summary.nextSince -Expected $fullItems[-1].at -Message "full timeline nextSince"
Assert-True -Condition ([bool]$fullItems[-1].cursor) -Message "full timeline item cursor"
Assert-Equal -Actual $fullTimeline.summary.nextCursor -Expected $fullItems[-1].cursor -Message "full timeline nextCursor"

$cursorIndex = [Math]::Floor($fullItems.Count / 2)
$cursor = $fullItems[$cursorIndex].at
$encodedCursor = [System.Uri]::EscapeDataString($cursor)
$expectedAfter = @(
  $fullItems | Where-Object { [DateTimeOffset]::Parse($_.at) -gt [DateTimeOffset]::Parse($cursor) }
)
Assert-True -Condition ($expectedAfter.Count -gt 2) -Message "timeline should have events after cursor"

$sinceTimeline = Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($created.jobId)/timeline?limit=1000&since=$encodedCursor"
$sinceItems = @($sinceTimeline.timeline)
Assert-Equal -Actual $sinceTimeline.summary.since -Expected $cursor -Message "since summary cursor"
Assert-Equal -Actual $sinceTimeline.summary.totalTimelineItems -Expected $fullItems.Count -Message "since totalTimelineItems"
Assert-Equal -Actual $sinceTimeline.summary.matchedTimelineItems -Expected $expectedAfter.Count -Message "since matchedTimelineItems"
Assert-Equal -Actual $sinceItems.Count -Expected $expectedAfter.Count -Message "since returned item count"
Assert-Equal -Actual $sinceTimeline.summary.hasMore -Expected $false -Message "since hasMore"
Assert-Equal -Actual $sinceTimeline.summary.nextSince -Expected $sinceItems[-1].at -Message "since nextSince"

for ($i = 0; $i -lt $sinceItems.Count; $i++) {
  Assert-Equal -Actual $sinceItems[$i].id -Expected $expectedAfter[$i].id -Message "since item order at index $i"
  Assert-True `
    -Condition ([DateTimeOffset]::Parse($sinceItems[$i].at) -gt [DateTimeOffset]::Parse($cursor)) `
    -Message "since item should be after cursor"
}

$limitedTimeline = Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($created.jobId)/timeline?limit=2&since=$encodedCursor"
$limitedItems = @($limitedTimeline.timeline)
Assert-Equal -Actual $limitedItems.Count -Expected 2 -Message "limited since returned item count"
Assert-Equal -Actual $limitedTimeline.summary.matchedTimelineItems -Expected $expectedAfter.Count -Message "limited matchedTimelineItems"
Assert-Equal -Actual $limitedTimeline.summary.returnedTimelineItems -Expected 2 -Message "limited returnedTimelineItems"
Assert-Equal -Actual $limitedTimeline.summary.hasMore -Expected $true -Message "limited hasMore"
Assert-Equal -Actual $limitedTimeline.summary.truncated -Expected $true -Message "limited truncated"
Assert-Equal -Actual $limitedTimeline.summary.nextSince -Expected $limitedItems[-1].at -Message "limited nextSince"
Assert-Equal -Actual $limitedTimeline.summary.nextCursor -Expected $limitedItems[-1].cursor -Message "limited nextCursor"
Assert-Equal -Actual $limitedItems[0].id -Expected $expectedAfter[0].id -Message "limited first item"
Assert-Equal -Actual $limitedItems[1].id -Expected $expectedAfter[1].id -Message "limited second item"

$sameTimestampIndex = -1
for ($i = 0; $i -lt ($fullItems.Count - 1); $i++) {
  if ($fullItems[$i].at -eq $fullItems[$i + 1].at) {
    $sameTimestampIndex = $i
    break
  }
}
Assert-True -Condition ($sameTimestampIndex -ge 0) -Message "timeline should contain a same-timestamp pair for cursor hardening"

$itemCursor = $fullItems[$sameTimestampIndex].cursor
$encodedItemCursor = [System.Uri]::EscapeDataString($itemCursor)
$cursorTimeline = Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($created.jobId)/timeline?limit=1000&cursor=$encodedItemCursor"
$cursorItems = @($cursorTimeline.timeline)
$expectedAfterItemCursor = @($fullItems | Select-Object -Skip ($sameTimestampIndex + 1))
Assert-Equal -Actual $cursorTimeline.summary.cursor -Expected $itemCursor -Message "item cursor echo"
Assert-Equal -Actual $cursorTimeline.summary.matchedTimelineItems -Expected $expectedAfterItemCursor.Count -Message "item cursor matched count"
Assert-Equal -Actual $cursorItems[0].id -Expected $expectedAfterItemCursor[0].id -Message "item cursor first id"
Assert-Equal -Actual $cursorItems[0].at -Expected $expectedAfterItemCursor[0].at -Message "item cursor preserves same timestamp next event"
Assert-Equal -Actual $cursorTimeline.summary.nextCursor -Expected $cursorItems[-1].cursor -Message "item cursor nextCursor"

$invalidCursorStatus = $null
try {
  Invoke-WebRequest `
    -Uri "http://localhost:3000/jobs/$($created.jobId)/timeline?cursor=not-a-valid-cursor" `
    -UseBasicParsing | Out-Null
} catch {
  $invalidCursorStatus = [int]$_.Exception.Response.StatusCode
}
Assert-Equal -Actual $invalidCursorStatus -Expected 400 -Message "invalid timeline cursor status"

[pscustomobject]@{
  ok = $true
  jobId = $created.jobId
  terminalStatus = $job.status
  totalTimelineItems = $fullTimeline.summary.totalTimelineItems
  sinceCursor = $cursor
  sinceMatchedItems = $sinceTimeline.summary.matchedTimelineItems
  limitedReturnedItems = $limitedTimeline.summary.returnedTimelineItems
  limitedHasMore = $limitedTimeline.summary.hasMore
  nextSince = $limitedTimeline.summary.nextSince
  sameTimestampCursorIndex = $sameTimestampIndex
  cursorMatchedItems = $cursorTimeline.summary.matchedTimelineItems
  invalidCursorStatus = $invalidCursorStatus
  checked = @(
    "timeline_full_summary",
    "timeline_since_filter",
    "timeline_since_order",
    "timeline_since_limit",
    "timeline_since_has_more",
    "timeline_since_next_cursor",
    "timeline_item_cursor",
    "timeline_cursor_preserves_same_timestamp_event",
    "timeline_invalid_cursor_400"
  )
} | ConvertTo-Json -Depth 4
