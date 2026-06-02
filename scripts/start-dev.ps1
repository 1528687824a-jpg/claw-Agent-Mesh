$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dockerCli = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
$dockerDesktop = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
$dockerProbeTimeoutSeconds = 10
$dockerCommandTimeoutSeconds = 60
$dockerReadyWaitSeconds = 300
$postgresReadyWaitSeconds = 120
$env:Path = "C:\Program Files\Docker\Docker\resources\bin;$env:Path"

if (-not (Test-Path -LiteralPath $dockerCli)) {
  throw "Docker CLI not found at $dockerCli"
}

function Invoke-ProcessWithTimeout {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList,
    [int]$TimeoutSeconds,
    [switch]$IgnoreExitCode
  )

  function Join-ProcessArguments {
    param([string[]]$Arguments)

    $quoted = foreach ($argument in $Arguments) {
      if ($argument -match '[\s"]') {
        '"' + ($argument -replace '"', '\"') + '"'
      } else {
        $argument
      }
    }

    return ($quoted -join " ")
  }

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $FilePath
  $startInfo.Arguments = Join-ProcessArguments -Arguments $ArgumentList
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo

  try {
    [void]$process.Start()
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      $process.WaitForExit()
      throw "$FilePath $($ArgumentList -join ' ') timed out after $TimeoutSeconds seconds"
    }

    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    if (-not $IgnoreExitCode -and $process.ExitCode -ne 0) {
      throw "$FilePath $($ArgumentList -join ' ') failed with exit code $($process.ExitCode). $stderr"
    }

    return [pscustomobject]@{
      ExitCode = $process.ExitCode
      Stdout = $stdout
      Stderr = $stderr
    }
  } finally {
    $process.Dispose()
  }
}

function Test-DockerReady {
  param(
    [int]$TimeoutSeconds = $dockerProbeTimeoutSeconds
  )

  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $probeTimeoutSeconds = [Math]::Max(1, $TimeoutSeconds)
    $result = Invoke-ProcessWithTimeout -FilePath $dockerCli -ArgumentList @("info") -TimeoutSeconds $probeTimeoutSeconds -IgnoreExitCode
    return $result.ExitCode -eq 0
  } catch {
    return $false
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

function Get-RemainingSeconds {
  param(
    [datetime]$Deadline
  )

  return [Math]::Max(0, [int][Math]::Ceiling(($Deadline - (Get-Date)).TotalSeconds))
}

function Wait-ForDockerReady {
  param(
    [datetime]$Deadline,
    [int]$SleepSeconds = 1
  )

  while ($true) {
    $remainingSeconds = Get-RemainingSeconds -Deadline $Deadline
    if ($remainingSeconds -le 0) {
      return $false
    }

    $probeTimeoutSeconds = [Math]::Min($dockerProbeTimeoutSeconds, $remainingSeconds)
    if (Test-DockerReady -TimeoutSeconds $probeTimeoutSeconds) {
      return $true
    }

    $remainingSeconds = Get-RemainingSeconds -Deadline $Deadline
    if ($remainingSeconds -le 0) {
      return $false
    }

    Start-Sleep -Seconds ([Math]::Min($SleepSeconds, $remainingSeconds))
  }
}

function Wait-ForCondition {
  param(
    [scriptblock]$Condition,
    [int]$TimeoutSeconds,
    [int]$SleepSeconds = 1
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (& $Condition) {
      return $true
    }
    Start-Sleep -Seconds $SleepSeconds
  }

  return $false
}

function Stop-NonDockerPortListeners {
  param(
    [int]$Port
  )

  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  $ownerIds = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($ownerId in $ownerIds) {
    if (-not $ownerId -or $ownerId -eq $PID) {
      continue
    }

    $process = Get-Process -Id $ownerId -ErrorAction SilentlyContinue
    if (-not $process) {
      continue
    }

    $processPath = ""
    try {
      $processPath = $process.Path
    } catch {
      $processPath = ""
    }

    $isDockerProcess = $process.ProcessName -match "docker|wsl" -or $processPath -like "C:\Program Files\Docker\*"
    if ($isDockerProcess) {
      Write-Warning "Port $Port is owned by Docker/WSL process $($process.ProcessName) ($ownerId); skipping direct process kill"
      continue
    }

    Stop-Process -Id $ownerId -Force -ErrorAction SilentlyContinue
  }
}

$dockerReadyDeadline = (Get-Date).AddSeconds($dockerReadyWaitSeconds)
$initialProbeTimeoutSeconds = [Math]::Min($dockerProbeTimeoutSeconds, $dockerReadyWaitSeconds)
if (-not (Test-DockerReady -TimeoutSeconds $initialProbeTimeoutSeconds)) {
  if (-not (Test-Path -LiteralPath $dockerDesktop)) {
    throw "Docker Desktop not found at $dockerDesktop"
  }

  Start-Process -FilePath $dockerDesktop -WindowStyle Hidden

  $ready = Wait-ForDockerReady -Deadline $dockerReadyDeadline -SleepSeconds 3

  if (-not $ready) {
    throw "Docker daemon did not become ready within $dockerReadyWaitSeconds seconds"
  }
}

Set-Location $root
Invoke-ProcessWithTimeout -FilePath $dockerCli -ArgumentList @("compose", "stop", "orchestrator-api", "dbos-worker") -TimeoutSeconds $dockerCommandTimeoutSeconds -IgnoreExitCode | Out-Null
Invoke-ProcessWithTimeout -FilePath $dockerCli -ArgumentList @("compose", "rm", "-f", "orchestrator-api", "dbos-worker") -TimeoutSeconds $dockerCommandTimeoutSeconds -IgnoreExitCode | Out-Null
Invoke-ProcessWithTimeout -FilePath $dockerCli -ArgumentList @("compose", "up", "-d", "--remove-orphans", "postgres") -TimeoutSeconds $dockerCommandTimeoutSeconds | Out-Null

$postgresReady = Wait-ForCondition -TimeoutSeconds $postgresReadyWaitSeconds -SleepSeconds 2 -Condition {
  $inspect = Invoke-ProcessWithTimeout -FilePath $dockerCli -ArgumentList @("inspect", "-f", "{{.State.Health.Status}}", "agent-openclaw-postgres") -TimeoutSeconds $dockerProbeTimeoutSeconds -IgnoreExitCode
  $health = ""
  if ($inspect.Stdout) {
    $health = $inspect.Stdout.Trim()
  }
  if ($inspect.ExitCode -eq 0 -and $health -eq "healthy") {
    return $true
  }
  return $false
}

if (-not $postgresReady) {
  throw "Postgres did not become healthy within $postgresReadyWaitSeconds seconds"
}

npm run db:migrate
if ($LASTEXITCODE -ne 0) {
  throw "Database migration failed"
}

New-Item -ItemType Directory -Force -Path ".runtime", "logs" | Out-Null

if (Test-Path ".runtime\pids.json") {
  $pids = Get-Content ".runtime\pids.json" | ConvertFrom-Json
  foreach ($pidValue in @($pids.workerPid, $pids.apiPid)) {
    if ($pidValue) {
      Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
    }
  }
}

$managedProcesses = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -match "apps[/\\]dbos-worker[/\\]src[/\\]worker\.ts" -or
  $_.CommandLine -match "apps[/\\]temporal-worker[/\\]src[/\\]worker\.ts" -or
  $_.CommandLine -match "apps[/\\]orchestrator-api[/\\]src[/\\]server\.ts"
}
foreach ($process in $managedProcesses) {
  if ($process.ProcessId -ne $PID) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

Stop-NonDockerPortListeners -Port 3000

$apiCmd = "cd '$root'; npm run dev:api *> '$root\logs\api.log'"

$api = Start-Process -FilePath powershell -WindowStyle Hidden -PassThru -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  $apiCmd
)

@{
  apiPid = $api.Id
} | ConvertTo-Json | Set-Content ".runtime\pids.json"

Start-Sleep -Seconds 5

Write-Output "Dev services started"
Write-Output "API: http://localhost:3000"
Get-Content ".runtime\pids.json"
