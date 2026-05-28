$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root ".runtime\m3-config-smoke"
$answersPath = Join-Path $root "examples\m3\interview.answers.example.json"
$configPath = Join-Path $outDir "cluster.config.json"

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

  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Seconds 1
    $job = Invoke-RestMethod -Uri "http://localhost:3000/jobs/$JobId"
    if (@("succeeded", "failed", "waiting_for_human", "cancelled") -contains $job.status) {
      return $job
    }
  }

  throw "Timed out waiting for $JobId"
}

Set-Location $root

if (Test-Path -LiteralPath $outDir) {
  Remove-Item -LiteralPath $outDir -Recurse -Force
}

npm run m3:generate -- --answers $answersPath --out $outDir --approve | Out-Host

Assert-True -Condition (Test-Path -LiteralPath $configPath) -Message "cluster.config.json was not generated"
Assert-True -Condition (Test-Path -LiteralPath (Join-Path $outDir "agents\research-agent\AGENTS.md")) -Message "research agent prompt missing"
Assert-True -Condition (Test-Path -LiteralPath (Join-Path $outDir "agents\writer-agent\AGENTS.md")) -Message "writer agent prompt missing"
Assert-True -Condition (Test-Path -LiteralPath (Join-Path $outDir "agents\image-agent\AGENTS.md")) -Message "image agent prompt missing"

$env:AGENT_CLUSTER_CONFIG_PATH = $configPath
$env:FEISHU_ADAPTER_ENABLED = "false"
$env:FEISHU_DRY_RUN = "true"
$env:OPENCLAW_AGENT_MODE = "mock"
Remove-Item Env:\DBOS_TEST_CRASH_ONCE_AFTER -ErrorAction SilentlyContinue

npm run dev:stop | Out-Host
npm run dev:start | Out-Host

$body = @{
  prompt = "Use the generated content studio cluster to research, write, and create an image brief for a tiny product launch."
  requesterId = "m3-config-smoke"
} | ConvertTo-Json

$created = Invoke-RestMethod -Uri "http://localhost:3000/jobs" -Method Post -ContentType "application/json" -Body $body
$job = Wait-ForTerminalStatus -JobId $created.jobId
Assert-Equal -Actual $job.status -Expected "succeeded" -Message "job terminal status"

$details = Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($created.jobId)/details"
$stageAgents = @($details.stages | ForEach-Object { $_.agent_id })

Assert-Equal -Actual $stageAgents.Count -Expected 3 -Message "generated stage count"
Assert-Equal -Actual $stageAgents[0] -Expected "research-agent" -Message "stage 1 agent"
Assert-Equal -Actual $stageAgents[1] -Expected "writer-agent" -Message "stage 2 agent"
Assert-Equal -Actual $stageAgents[2] -Expected "image-agent" -Message "stage 3 agent"

$clusterPlanEvents = @(
  $details.events | Where-Object {
    $_.event_type -eq "main.pipeline_planned" -and $_.payload.clusterId -eq "content-studio-demo"
  }
)
Assert-True -Condition ($clusterPlanEvents.Count -gt 0) -Message "cluster planning event missing"

[pscustomobject]@{
  ok = $true
  clusterConfigPath = $configPath
  jobId = $created.jobId
  terminalStatus = $job.status
  stageAgents = $stageAgents
  checked = @(
    "generate_cluster_config",
    "write_agent_prompts",
    "load_cluster_config_in_dbos_step",
    "run_demo_job_succeeded"
  )
} | ConvertTo-Json -Depth 4
