$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

function Start-DevForListJobsSmoke {
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

function Create-SmokeJob {
  param(
    [string]$Marker,
    [string]$Name
  )

  $body = @{
    prompt = "List jobs smoke $Marker $Name"
    requesterId = "list-jobs-smoke"
    routingMode = "supervisor_pipeline"
    maxModelCalls = 1
  } | ConvertTo-Json
  $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)

  Invoke-RestMethod `
    -Uri "http://localhost:3000/jobs" `
    -Method Post `
    -ContentType "application/json; charset=utf-8" `
    -Body $bodyBytes
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

function Prompt-Names {
  param([object[]]$Jobs)

  @(
    $Jobs | ForEach-Object {
      if ($_.rawPrompt -match "List jobs smoke \S+ (?<name>.+)$") {
        $Matches.name
      }
    }
  )
}

Start-DevForListJobsSmoke

$marker = "list-" + ([guid]::NewGuid().ToString("N").Substring(0, 8))

$alpha = Create-SmokeJob -Marker $marker -Name "alpha"
Start-Sleep -Seconds 1
$beta = Create-SmokeJob -Marker $marker -Name "beta"
Start-Sleep -Seconds 1
$gamma = Create-SmokeJob -Marker $marker -Name "gamma"
Start-Sleep -Seconds 1
$cancelProbe = Create-SmokeJob -Marker $marker -Name "cancel-probe"

$waiting = Wait-ForStatus -JobId $cancelProbe.jobId -Statuses @("waiting_for_human", "failed", "succeeded", "cancelled")
Assert-Equal -Actual $waiting.status -Expected "waiting_for_human" -Message "cancel probe should wait for human"

$cancelBody = @{
  reason = "list jobs smoke status filter"
  requesterId = "list-jobs-smoke"
} | ConvertTo-Json
$cancelled = Invoke-RestMethod `
  -Uri "http://localhost:3000/jobs/$($cancelProbe.jobId)/cancel" `
  -Method Post `
  -ContentType "application/json" `
  -Body $cancelBody
Assert-Equal -Actual $cancelled.status -Expected "cancelled" -Message "cancel probe status"

$encodedMarker = [System.Uri]::EscapeDataString($marker)
$all = Invoke-RestMethod -Uri "http://localhost:3000/jobs?prompt=$encodedMarker&limit=10&sort=createdAt&order=asc"
$allJobs = @($all.jobs)
$allNames = Prompt-Names -Jobs $allJobs
Assert-Equal -Actual $allJobs.Count -Expected 4 -Message "prompt search should isolate four smoke jobs"
Assert-Equal -Actual ($allNames -join ",") -Expected "alpha,beta,gamma,cancel-probe" -Message "createdAt asc order"
Assert-Equal -Actual $all.page.sort -Expected "createdAt" -Message "page sort"
Assert-Equal -Actual $all.page.order -Expected "asc" -Message "page order"
Assert-Equal -Actual $all.page.hasMore -Expected $false -Message "all page hasMore"
Assert-Equal -Actual $all.page.filters.prompt -Expected $marker -Message "prompt filter echo"

$page1 = Invoke-RestMethod -Uri "http://localhost:3000/jobs?prompt=$encodedMarker&limit=2&sort=createdAt&order=asc"
$page1Jobs = @($page1.jobs)
$page1Names = Prompt-Names -Jobs $page1Jobs
Assert-Equal -Actual ($page1Names -join ",") -Expected "alpha,beta" -Message "page1 jobs"
Assert-Equal -Actual $page1.page.hasMore -Expected $true -Message "page1 hasMore"
Assert-True -Condition ([bool]$page1.page.nextCursor) -Message "page1 missing nextCursor"

$encodedCursor = [System.Uri]::EscapeDataString($page1.page.nextCursor)
$page2 = Invoke-RestMethod -Uri "http://localhost:3000/jobs?prompt=$encodedMarker&limit=2&sort=createdAt&order=asc&cursor=$encodedCursor"
$page2Jobs = @($page2.jobs)
$page2Names = Prompt-Names -Jobs $page2Jobs
Assert-Equal -Actual ($page2Names -join ",") -Expected "gamma,cancel-probe" -Message "page2 jobs"
Assert-Equal -Actual $page2.page.hasMore -Expected $false -Message "page2 hasMore"
Assert-Equal -Actual $page2.page.cursor -Expected $page1.page.nextCursor -Message "page2 cursor echo"

$desc = Invoke-RestMethod -Uri "http://localhost:3000/jobs?prompt=$encodedMarker&limit=2&sort=createdAt&order=desc"
$descNames = Prompt-Names -Jobs @($desc.jobs)
Assert-Equal -Actual ($descNames -join ",") -Expected "cancel-probe,gamma" -Message "createdAt desc order"

$cancelledOnly = Invoke-RestMethod -Uri "http://localhost:3000/jobs?prompt=$encodedMarker&status=cancelled&limit=10"
$cancelledJobs = @($cancelledOnly.jobs)
$cancelledNames = Prompt-Names -Jobs $cancelledJobs
Assert-Equal -Actual $cancelledJobs.Count -Expected 1 -Message "cancelled status filter count"
Assert-Equal -Actual ($cancelledNames -join ",") -Expected "cancel-probe" -Message "cancelled status filter job"

$httpOnly = Invoke-RestMethod -Uri "http://localhost:3000/jobs?prompt=$encodedMarker&ingressOrigin=http&limit=10"
Assert-Equal -Actual @($httpOnly.jobs).Count -Expected 4 -Message "ingressOrigin filter count"

$since = [System.Uri]::EscapeDataString($allJobs[1].createdAt)
$untilBoundary = ([DateTimeOffset]::Parse($allJobs[3].createdAt)).AddSeconds(1).UtcDateTime.ToString("o")
$until = [System.Uri]::EscapeDataString($untilBoundary)
$window = Invoke-RestMethod -Uri "http://localhost:3000/jobs?prompt=$encodedMarker&since=$since&until=$until&sort=createdAt&order=asc&limit=10"
$windowNames = Prompt-Names -Jobs @($window.jobs)
Assert-Equal -Actual ($windowNames -join ",") -Expected "beta,gamma,cancel-probe" -Message "since/until createdAt window"
Assert-Equal -Actual $window.page.filters.since -Expected $allJobs[1].createdAt -Message "since filter echo"
Assert-Equal -Actual $window.page.filters.until -Expected $untilBoundary -Message "until filter echo"

$invalidCursorStatus = $null
try {
  Invoke-WebRequest `
    -Uri "http://localhost:3000/jobs?prompt=$encodedMarker&cursor=not-a-valid-cursor" `
    -UseBasicParsing | Out-Null
} catch {
  $invalidCursorStatus = [int]$_.Exception.Response.StatusCode
}
Assert-Equal -Actual $invalidCursorStatus -Expected 400 -Message "invalid cursor status"

$caseMarker = "CaseProbe" + ([guid]::NewGuid().ToString("N").Substring(0, 8))
$caseProbe = Create-SmokeJob -Marker $caseMarker -Name "MixedCasePrompt"
$caseSearch = [System.Uri]::EscapeDataString($caseMarker.ToLowerInvariant())
$caseResult = Invoke-RestMethod -Uri "http://localhost:3000/jobs?prompt=$caseSearch&limit=10"
$caseJobs = @($caseResult.jobs | Where-Object { $_.id -eq $caseProbe.jobId })
Assert-Equal -Actual $caseJobs.Count -Expected 1 -Message "prompt search should be case-insensitive"

$chinesePrefix = -join ([char[]](0x4e2d, 0x6587, 0x6d4b, 0x8bd5, 0x4efb, 0x52a1))
$chineseMarker = $chinesePrefix + ([guid]::NewGuid().ToString("N").Substring(0, 8))
$chineseProbe = Create-SmokeJob -Marker $chineseMarker -Name "boundary"
$chineseSearch = [System.Uri]::EscapeDataString($chinesePrefix)
$chineseResult = Invoke-RestMethod -Uri "http://localhost:3000/jobs?prompt=$chineseSearch&limit=50"
$chineseJobs = @($chineseResult.jobs | Where-Object { $_.id -eq $chineseProbe.jobId })
Assert-Equal -Actual $chineseJobs.Count -Expected 1 -Message "prompt search should match Chinese input"

[pscustomobject]@{
  ok = $true
  marker = $marker
  jobIds = @($alpha.jobId, $beta.jobId, $gamma.jobId, $cancelProbe.jobId, $caseProbe.jobId, $chineseProbe.jobId)
  allOrder = $allNames
  page1 = $page1Names
  page2 = $page2Names
  desc = $descNames
  cancelledFilter = $cancelledNames
  window = $windowNames
  caseInsensitiveProbe = $caseProbe.jobId
  chineseProbe = $chineseProbe.jobId
  checked = @(
    "prompt_search",
    "created_at_asc_order",
    "created_at_desc_order",
    "cursor_page_1",
    "cursor_page_2",
    "status_filter",
    "ingress_origin_filter",
    "since_until_filter",
    "invalid_cursor_400",
    "prompt_search_case_insensitive",
    "prompt_search_chinese"
  )
} | ConvertTo-Json -Depth 5
