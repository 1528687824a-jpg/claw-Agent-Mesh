$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "honeycomb-api-token.ps1")
$apiHeaders = Get-HoneycombApiHeaders
$apiBaseUrl = "http://127.0.0.1:3000"
$runtimeDir = Join-Path $root ".runtime"
$serverPath = Join-Path $runtimeDir "web-search-browser-server.cjs"
$port = 39617 + (Get-Random -Minimum 0 -Maximum 300)
$serverProcess = $null

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

try {
  Set-Location $root
  $env:FEISHU_ADAPTER_ENABLED = "false"
  $env:FEISHU_DRY_RUN = "true"
  $env:OPENCLAW_AGENT_MODE = "mock"
  Remove-Item Env:\DBOS_TEST_CRASH_ONCE_AFTER -ErrorAction SilentlyContinue

  if (-not (Test-Path -LiteralPath $runtimeDir)) {
    New-Item -ItemType Directory -Path $runtimeDir | Out-Null
  }

  @'
const http = require("node:http");

const port = Number(process.env.SMOKE_WEB_PORT);

const server = http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.url && request.url.startsWith("/search")) {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`
      <html><body>
        <a href="https://example.com/research">Research Result</a>
        <a href="/local-result">Local Result</a>
      </body></html>
    `);
    return;
  }

  if (request.url === "/page") {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`
      <html>
        <head><title>Smoke Snapshot</title></head>
        <body>
          <h1>Honeycomb Browser Snapshot</h1>
          <a href="/next">Next</a>
        </body>
      </html>
    `);
    return;
  }

  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found");
});

server.listen(port, "127.0.0.1");
'@ | Set-Content -LiteralPath $serverPath -Encoding UTF8

  $node = (Get-Command node).Source
  $env:SMOKE_WEB_PORT = [string]$port
  $serverProcess = Start-Process -FilePath $node -ArgumentList @($serverPath) -PassThru -WindowStyle Hidden

  $healthUrl = "http://127.0.0.1:$port/health"
  for ($i = 0; $i -lt 50; $i++) {
    try {
      Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1 | Out-Null
      break
    } catch {
      Start-Sleep -Milliseconds 100
      if ($i -eq 49) {
        throw "Timed out waiting for fake web server"
      }
    }
  }

  npm run dev:start | Out-Host

  $created = Invoke-RestMethod `
    -Uri "$apiBaseUrl/jobs" `
    -Method Post `
    -Headers $apiHeaders `
    -ContentType "application/json" `
    -Body (@{
      prompt = "Web search/browser smoke"
      requesterId = "web-search-browser-smoke"
      startWorkflow = $false
    } | ConvertTo-Json)

  $query = "honeycomb agents"
  $endpointUrl = "http://127.0.0.1:$port/search?q={query}"
  $searchUrl = "http://127.0.0.1:$port/search?q=honeycomb%20agents"
  $searchCommand = "SEARCH $query VIA $searchUrl"

  $searchApproval = Invoke-RestMethod `
    -Uri "$apiBaseUrl/approvals" `
    -Method Post `
    -Headers $apiHeaders `
    -ContentType "application/json" `
    -Body (@{
      jobId = $created.jobId
      agentId = "research-agent"
      requesterActor = "smoke"
      toolName = "web.search"
      actionType = "web_search"
      riskLevel = "medium"
      target = $searchUrl
      command = $searchCommand
      input = @{ allowPrivateNetwork = $true }
      policy = @{ allowPrivateNetwork = $true }
    } | ConvertTo-Json -Depth 6)

  Invoke-RestMethod `
    -Uri "$apiBaseUrl/approvals/$($searchApproval.id)/approve" `
    -Method Post `
    -Headers $apiHeaders `
    -ContentType "application/json" `
    -Body (@{ decidedBy = "smoke" } | ConvertTo-Json) | Out-Null

  $search = Invoke-RestMethod `
    -Uri "$apiBaseUrl/tools/web/search" `
    -Method Post `
    -Headers $apiHeaders `
    -ContentType "application/json" `
    -Body (@{
      query = $query
      endpointUrl = $endpointUrl
      allowPrivateNetwork = $true
      maxResults = 2
      approvalId = $searchApproval.id
    } | ConvertTo-Json -Depth 6)

  Assert-Equal -Actual $search.search.results[0].title -Expected "Research Result" -Message "search first result title"
  Assert-Equal -Actual $search.approval.status -Expected "consumed" -Message "search approval consumed"

  $pageUrl = "http://127.0.0.1:$port/page"
  $snapshotApproval = Invoke-RestMethod `
    -Uri "$apiBaseUrl/approvals" `
    -Method Post `
    -Headers $apiHeaders `
    -ContentType "application/json" `
    -Body (@{
      jobId = $created.jobId
      agentId = "research-agent"
      requesterActor = "smoke"
      toolName = "browser.snapshot"
      actionType = "browser_snapshot"
      riskLevel = "medium"
      target = $pageUrl
      command = "SNAPSHOT $pageUrl"
      input = @{ allowPrivateNetwork = $true }
      policy = @{ allowPrivateNetwork = $true }
    } | ConvertTo-Json -Depth 6)

  Invoke-RestMethod `
    -Uri "$apiBaseUrl/approvals/$($snapshotApproval.id)/approve" `
    -Method Post `
    -Headers $apiHeaders `
    -ContentType "application/json" `
    -Body (@{ decidedBy = "smoke" } | ConvertTo-Json) | Out-Null

  $snapshot = Invoke-RestMethod `
    -Uri "$apiBaseUrl/tools/browser/snapshot" `
    -Method Post `
    -Headers $apiHeaders `
    -ContentType "application/json" `
    -Body (@{
      url = $pageUrl
      allowPrivateNetwork = $true
      maxLinks = 5
      approvalId = $snapshotApproval.id
    } | ConvertTo-Json -Depth 6)

  Assert-Equal -Actual $snapshot.snapshot.title -Expected "Smoke Snapshot" -Message "snapshot title"
  Assert-True -Condition ($snapshot.snapshot.textPreview -match "Honeycomb Browser Snapshot") -Message "snapshot text missing"
  Assert-Equal -Actual $snapshot.approval.status -Expected "consumed" -Message "snapshot approval consumed"

  [pscustomobject]@{
    ok = $true
    jobId = $created.jobId
    searchResults = @($search.search.results).Count
    snapshotLinks = @($snapshot.snapshot.links).Count
    checks = @(
      "approval_gated_web_search",
      "search_results_extracted",
      "approval_gated_browser_snapshot",
      "snapshot_title_text_links_extracted"
    )
  } | ConvertTo-Json -Depth 5
} finally {
  if ($null -ne $serverProcess -and -not $serverProcess.HasExited) {
    Stop-Process -Id $serverProcess.Id -Force
  }
}
