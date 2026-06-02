param(
  [int]$TimeoutSeconds = 180,
  [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dockerCli = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
$dockerDesktop = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
$desktopExe = Join-Path $root "apps\desktop-app\src-tauri\target\release\agent-openclaw.exe"
$logPath = Join-Path $root "logs\desktop-launcher.log"
$dockerProbeTimeoutSeconds = 10
$dockerCommandTimeoutSeconds = 90

Set-Location $root
New-Item -ItemType Directory -Force -Path "logs", ".runtime" | Out-Null

function Write-LaunchLog($Message) {
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
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

function Test-HttpReady($Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

try {
  Write-LaunchLog "Launcher started"

  if (-not (Test-Path -LiteralPath $dockerCli)) {
    $dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $dockerCommand) {
      throw "Docker CLI not found"
    }
    $dockerCli = $dockerCommand.Source
  }

  $dockerReadyDeadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $initialProbeTimeoutSeconds = [Math]::Min($dockerProbeTimeoutSeconds, [Math]::Max(1, $TimeoutSeconds))
  if (-not (Test-DockerReady -TimeoutSeconds $initialProbeTimeoutSeconds)) {
    Write-LaunchLog "Docker not ready; starting Docker Desktop"
    Start-Service com.docker.service -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $dockerDesktop) {
      Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
    }
  }

  $dockerReady = Wait-ForDockerReady -Deadline $dockerReadyDeadline -SleepSeconds 1
  if (-not $dockerReady) {
    throw "Docker daemon did not become ready within $TimeoutSeconds seconds"
  }

  Write-LaunchLog "Starting backend stack"
  Invoke-ProcessWithTimeout -FilePath $dockerCli -ArgumentList @("compose", "up", "-d") -TimeoutSeconds $dockerCommandTimeoutSeconds | Out-Null

  $apiReady = Wait-ForCondition -Condition { Test-HttpReady "http://localhost:3000/health" } -TimeoutSeconds $TimeoutSeconds -SleepSeconds 1
  if (-not $apiReady) {
    throw "API did not become ready within $TimeoutSeconds seconds"
  }

  if (-not (Test-Path -LiteralPath $desktopExe)) {
    Write-LaunchLog "Desktop exe missing; building release app without bundle"
    npm --prefix apps/desktop-app exec tauri build -- --no-bundle *> (Join-Path $root "logs\desktop-launcher-build.log")
    if ($LASTEXITCODE -ne 0) {
      throw "Tauri no-bundle build failed"
    }
  }

  if (-not $NoLaunch) {
    Write-LaunchLog "Launching desktop app"
    Start-Process -FilePath $desktopExe -WorkingDirectory (Split-Path -Parent $desktopExe)
  }

  Write-LaunchLog "Launcher completed"
} catch {
  Write-LaunchLog "Launcher failed: $($_.Exception.Message)"
  throw
}
