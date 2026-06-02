$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dockerCli = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
$dockerCommandTimeoutSeconds = 60
$env:Path = "C:\Program Files\Docker\Docker\resources\bin;$env:Path"

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

Set-Location $root

if (Test-Path ".runtime\pids.json") {
  $pids = Get-Content ".runtime\pids.json" | ConvertFrom-Json
  foreach ($pidValue in @($pids.workerPid, $pids.apiPid)) {
    if ($pidValue) {
      Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
    }
  }
  Remove-Item ".runtime\pids.json" -Force -ErrorAction SilentlyContinue
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

if (Test-Path -LiteralPath $dockerCli) {
  try {
    $composeDown = Invoke-ProcessWithTimeout -FilePath $dockerCli -ArgumentList @("compose", "down", "--remove-orphans") -TimeoutSeconds $dockerCommandTimeoutSeconds -IgnoreExitCode
    if ($composeDown.ExitCode -ne 0) {
      $message = "docker compose down skipped or failed with exit code $($composeDown.ExitCode)"
      if ($composeDown.Stderr) {
        $message = "$message. $($composeDown.Stderr.Trim())"
      }
      Write-Warning $message
    }
  } catch {
    Write-Warning "docker compose down skipped or failed. $($_.Exception.Message)"
  }
}

Stop-NonDockerPortListeners -Port 3000

Write-Output "Dev services stopped"
