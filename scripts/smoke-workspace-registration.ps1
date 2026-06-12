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

function Start-DevForWorkspaceSmoke {
  Set-Location $root
  $env:FEISHU_ADAPTER_ENABLED = "false"
  $env:FEISHU_DRY_RUN = "true"
  $env:OPENCLAW_AGENT_MODE = "mock"
  Remove-Item Env:\DBOS_TEST_CRASH_ONCE_AFTER -ErrorAction SilentlyContinue

  npm run dev:start | Out-Host
}

Start-DevForWorkspaceSmoke

$workspaceRoot = Join-Path $root ".runtime\workspace-registration-smoke-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $workspaceRoot | Out-Null
Set-Content -LiteralPath (Join-Path $workspaceRoot "sample.txt") -Value "workspace registration smoke" -Encoding UTF8

$rootPath = [System.IO.Path]::GetFullPath($workspaceRoot)
$rootPathKey = $rootPath.ToLowerInvariant()
$approvalTarget = "workspace://$rootPathKey"

$unregisteredStatus = $null
try {
  Invoke-WebRequest `
    -Uri "$apiBaseUrl/workspaces/inspect?rootPath=$([uri]::EscapeDataString($rootPath))" `
    -Headers $apiHeaders `
    -UseBasicParsing | Out-Null
} catch {
  $unregisteredStatus = [int]$_.Exception.Response.StatusCode
}
Assert-Equal -Actual $unregisteredStatus -Expected 403 -Message "unregistered workspace should be rejected"

$created = Invoke-RestMethod `
  -Uri "$apiBaseUrl/jobs" `
  -Method Post `
  -Headers $apiHeaders `
  -ContentType "application/json" `
  -Body (@{
    prompt = "Workspace registration smoke"
    requesterId = "workspace-registration-smoke"
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
    requesterActor = "workspace-registration-smoke"
    toolName = "workspace.register"
    actionType = "workspace_register"
    riskLevel = "high"
    reason = "Register smoke workspace"
    target = $approvalTarget
    command = "Register workspace $rootPath"
    input = @{ rootPath = $rootPath }
  } | ConvertTo-Json -Depth 6)

Invoke-RestMethod `
  -Uri "$apiBaseUrl/approvals/$($approval.id)/approve" `
  -Method Post `
  -Headers $apiHeaders `
  -ContentType "application/json" `
  -Body (@{
    decidedBy = "workspace-registration-smoke"
    decisionReason = "S2 workspace smoke approval"
  } | ConvertTo-Json) | Out-Null

$registered = Invoke-RestMethod `
  -Uri "$apiBaseUrl/workspaces/register" `
  -Method Post `
  -Headers $apiHeaders `
  -ContentType "application/json" `
  -Body (@{
    rootPath = $rootPath
    displayName = "Workspace smoke"
    approvalId = $approval.id
    registeredBy = "workspace-registration-smoke"
    metadata = @{ smoke = "workspace-registration" }
  } | ConvertTo-Json -Depth 6)

Assert-Equal -Actual $registered.approval.status -Expected "consumed" -Message "registration approval should be consumed"
Assert-Equal -Actual $registered.workspace.rootPathKey -Expected $rootPathKey -Message "registered root key"

$inspect = Invoke-RestMethod `
  -Uri "$apiBaseUrl/workspaces/inspect?rootPath=$([uri]::EscapeDataString($rootPath))" `
  -Headers $apiHeaders
$files = Invoke-RestMethod `
  -Uri "$apiBaseUrl/workspaces/files?rootPath=$([uri]::EscapeDataString($rootPath))&depth=0&limit=10" `
  -Headers $apiHeaders
$sample = Invoke-RestMethod `
  -Uri "$apiBaseUrl/workspaces/file?rootPath=$([uri]::EscapeDataString($rootPath))&subpath=sample.txt" `
  -Headers $apiHeaders

Assert-Equal -Actual $inspect.rootPath -Expected $rootPath -Message "inspect root"
Assert-True -Condition (@($files.entries).Count -ge 1) -Message "registered file listing should return entries"
Assert-Equal -Actual $sample.content.Trim() -Expected "workspace registration smoke" -Message "registered file read"

[pscustomobject]@{
  ok = $true
  jobId = $created.jobId
  approvalId = $approval.id
  workspaceId = $registered.workspace.id
  rootPathKey = $registered.workspace.rootPathKey
  unregisteredStatus = $unregisteredStatus
  fileCount = @($files.entries).Count
  checked = @(
    "unregistered_workspace_rejected",
    "workspace_registration_requires_approval",
    "workspace_registration_consumes_approval",
    "registered_workspace_inspect",
    "registered_workspace_files",
    "registered_workspace_file_read"
  )
} | ConvertTo-Json -Depth 4
