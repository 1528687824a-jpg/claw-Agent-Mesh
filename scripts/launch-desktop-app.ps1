param(
  [int]$TimeoutSeconds = 180,
  [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dockerCli = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
$dockerDesktop = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
$desktopExe = Join-Path $root "apps\desktop-app\src-tauri\target\release\honeycomb.exe"
$logPath = Join-Path $root "logs\desktop-launcher.log"
$backendBuildStampPath = Join-Path $root ".runtime\backend-launcher-build.stamp"
$honeycombRuntimeHostDir = Join-Path ([Environment]::GetFolderPath("ApplicationData")) "io.agentopenclaw.desktop\openclaw-runtime"
$honeycombSecretHostDir = Join-Path ([Environment]::GetFolderPath("ApplicationData")) "io.agentopenclaw.desktop\honeycomb-secrets"
$dockerProbeTimeoutSeconds = 10
$dockerCommandTimeoutSeconds = 90
$dockerBuildTimeoutSeconds = 600
$desktopBuildTimeoutSeconds = 600
$apiHealthUrl = "http://127.0.0.1:3000/health"
$apiProtectedProbeUrl = "http://127.0.0.1:3000/agents"
$desktopLaunched = $false

Set-Location $root
New-Item -ItemType Directory -Force -Path "logs", ".runtime" | Out-Null
New-Item -ItemType Directory -Force -Path $honeycombRuntimeHostDir | Out-Null
New-Item -ItemType Directory -Force -Path $honeycombSecretHostDir | Out-Null
. (Join-Path $PSScriptRoot "honeycomb-api-token.ps1")
Initialize-HoneycombApiToken | Out-Null
$env:HONEYCOMB_OPENCLAW_RUNTIME_HOST_DIR = $honeycombRuntimeHostDir
$env:HONEYCOMB_SECRET_HOST_DIR = $honeycombSecretHostDir
$env:HONEYCOMB_OPENCLAW_RUNTIME_DIR = "/app/honeycomb-runtime"
$env:AGENT_CLUSTER_CONFIG_PATH = "/app/honeycomb-runtime/cluster.config.json"
$env:HONEYCOMB_AGENT_MODEL_CONFIG_PATH = "/app/honeycomb-runtime/agent-model-configs.json"
$env:HONEYCOMB_FIRST_RUN_AGENTS_DIR = "/app/honeycomb-runtime/agents"
$env:HONEYCOMB_PANEL_SUPERVISOR_AGENT_ID = "panel-supervisor-agent"

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

function Test-AuthenticatedApiReady {
  try {
    if (-not $env:HONEYCOMB_API_TOKEN) {
      return $false
    }
    $response = Invoke-WebRequest `
      -Uri $apiProtectedProbeUrl `
      -UseBasicParsing `
      -TimeoutSec 2 `
      -Headers @{ Authorization = "Bearer $env:HONEYCOMB_API_TOKEN" }
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Get-LatestDesktopSourceWriteTimeUtc {
  $sourcePaths = @(
    "apps\desktop-app\index.html",
    "apps\desktop-app\package.json",
    "apps\desktop-app\tsconfig.json",
    "apps\desktop-app\vite.config.ts",
    "apps\desktop-app\src",
    "apps\desktop-app\src-tauri\Cargo.toml",
    "apps\desktop-app\src-tauri\tauri.conf.json",
    "apps\desktop-app\src-tauri\src",
    "apps\desktop-app\src-tauri\icons"
  )

  $latest = [datetime]::MinValue
  foreach ($relativePath in $sourcePaths) {
    $path = Join-Path $root $relativePath
    if (-not (Test-Path -LiteralPath $path)) {
      continue
    }

    $item = Get-Item -LiteralPath $path
    if ($item.PSIsContainer) {
      $children = Get-ChildItem -LiteralPath $path -Recurse -File -ErrorAction SilentlyContinue
      foreach ($child in $children) {
        if ($child.LastWriteTimeUtc -gt $latest) {
          $latest = $child.LastWriteTimeUtc
        }
      }
    } elseif ($item.LastWriteTimeUtc -gt $latest) {
      $latest = $item.LastWriteTimeUtc
    }
  }

  return $latest
}

function Test-DesktopExeNeedsBuild {
  if (-not (Test-Path -LiteralPath $desktopExe)) {
    return $true
  }

  $exeWriteTime = (Get-Item -LiteralPath $desktopExe).LastWriteTimeUtc
  $sourceWriteTime = Get-LatestDesktopSourceWriteTimeUtc
  return $sourceWriteTime -gt $exeWriteTime
}

function Get-LatestBackendSourceWriteTimeUtc {
  $sourcePaths = @(
    "Dockerfile.api",
    "Dockerfile.worker",
    "docker-compose.yml",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "apps\orchestrator-api\src",
    "apps\dbos-worker\src",
    "packages",
    "platform-assets\openclaw-agent-templates"
  )

  $latest = [datetime]::MinValue
  foreach ($relativePath in $sourcePaths) {
    $path = Join-Path $root $relativePath
    if (-not (Test-Path -LiteralPath $path)) {
      continue
    }

    $item = Get-Item -LiteralPath $path
    if ($item.PSIsContainer) {
      $children = Get-ChildItem -LiteralPath $path -Recurse -File -ErrorAction SilentlyContinue
      foreach ($child in $children) {
        if ($child.LastWriteTimeUtc -gt $latest) {
          $latest = $child.LastWriteTimeUtc
        }
      }
    } elseif ($item.LastWriteTimeUtc -gt $latest) {
      $latest = $item.LastWriteTimeUtc
    }
  }

  return $latest
}

function Test-BackendStackNeedsBuild {
  if (-not (Test-Path -LiteralPath $backendBuildStampPath)) {
    return $true
  }

  $stampWriteTime = (Get-Item -LiteralPath $backendBuildStampPath).LastWriteTimeUtc
  $sourceWriteTime = Get-LatestBackendSourceWriteTimeUtc
  return $sourceWriteTime -gt $stampWriteTime
}

function Update-BackendBuildStamp {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backendBuildStampPath) | Out-Null
  Set-Content -LiteralPath $backendBuildStampPath -Value ((Get-Date).ToUniversalTime().ToString("o")) -Encoding ASCII
}

function Get-NpmCli {
  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npmCommand) {
    $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
  }
  if (-not $npmCommand) {
    throw "npm CLI not found"
  }

  return $npmCommand.Source
}

function Get-CargoCli {
  $cargoCommand = Get-Command cargo.exe -ErrorAction SilentlyContinue
  if (-not $cargoCommand) {
    $cargoCommand = Get-Command cargo -ErrorAction SilentlyContinue
  }
  if (-not $cargoCommand) {
    throw "Cargo CLI not found"
  }

  return $cargoCommand.Source
}

function Invoke-TauriNoBundleBuild {
  param(
    [string]$NpmCli
  )

  return Invoke-ProcessWithTimeout `
    -FilePath $npmCli `
    -ArgumentList @("--prefix", "apps/desktop-app", "exec", "tauri", "build", "--", "--no-bundle") `
    -TimeoutSeconds $desktopBuildTimeoutSeconds `
    -IgnoreExitCode
}

function Invoke-CargoCleanForDesktop {
  $cargoCli = Get-CargoCli
  $manifestPath = Join-Path $root "apps\desktop-app\src-tauri\Cargo.toml"
  $result = Invoke-ProcessWithTimeout `
    -FilePath $cargoCli `
    -ArgumentList @("clean", "--manifest-path", $manifestPath) `
    -TimeoutSeconds 180 `
    -IgnoreExitCode

  if ($result.ExitCode -ne 0) {
    throw "Cargo clean failed with exit code $($result.ExitCode). $($result.Stderr)"
  }

  return $result
}

function Write-DesktopBuildLog {
  param(
    [string]$BuildLogPath,
    [object[]]$Attempts
  )

  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($attempt in $Attempts) {
    $lines.Add("ATTEMPT: $($attempt.Name)")
    $lines.Add("EXIT_CODE: $($attempt.Result.ExitCode)")
    $lines.Add("")
    $lines.Add("STDOUT:")
    $lines.Add($attempt.Result.Stdout)
    $lines.Add("")
    $lines.Add("STDERR:")
    $lines.Add($attempt.Result.Stderr)
    $lines.Add("")
  }
  $lines | Set-Content -LiteralPath $BuildLogPath -Encoding UTF8
}

function Invoke-DesktopNoBundleBuild {
  $buildLogPath = Join-Path $root "logs\desktop-launcher-build.log"
  $npmCli = Get-NpmCli
  $attempts = New-Object System.Collections.Generic.List[object]
  $result = Invoke-TauriNoBundleBuild -NpmCli $npmCli
  $attempts.Add([pscustomobject]@{ Name = "tauri-build"; Result = $result })
  Write-DesktopBuildLog -BuildLogPath $buildLogPath -Attempts $attempts

  if ($result.ExitCode -eq 0) {
    return
  }

  Write-LaunchLog "Tauri no-bundle build failed; cleaning Cargo target and retrying once"
  $cleanResult = Invoke-CargoCleanForDesktop
  $attempts.Add([pscustomobject]@{ Name = "cargo-clean"; Result = $cleanResult })
  $retryResult = Invoke-TauriNoBundleBuild -NpmCli $npmCli
  $attempts.Add([pscustomobject]@{ Name = "tauri-build-after-cargo-clean"; Result = $retryResult })
  Write-DesktopBuildLog -BuildLogPath $buildLogPath -Attempts $attempts

  if ($retryResult.ExitCode -ne 0) {
    throw "Tauri no-bundle build failed after Cargo clean with exit code $($retryResult.ExitCode). See $buildLogPath"
  }
}

try {
  Write-LaunchLog "Launcher started"

  $mutex = [System.Threading.Mutex]::new($false, "Global\HoneycombDesktopLauncher")
  $lockTaken = $mutex.WaitOne(0)
  if (-not $lockTaken) {
    Write-LaunchLog "Another launcher instance is already running; exiting"
    exit 0
  }

  if (Test-DesktopExeNeedsBuild) {
    Write-LaunchLog "Desktop exe missing or stale; building release app without bundle"
    Invoke-DesktopNoBundleBuild
  } else {
    Write-LaunchLog "Desktop exe is up to date"
  }

  if (-not $NoLaunch) {
    Write-LaunchLog "Launching desktop app before backend startup"
    Start-Process -FilePath $desktopExe -WorkingDirectory (Split-Path -Parent $desktopExe)
    $desktopLaunched = $true
  }

  if (-not (Test-Path -LiteralPath $dockerCli)) {
    $dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $dockerCommand) {
      throw "Docker CLI not found"
    }
    $dockerCli = $dockerCommand.Source
  }

  $backendNeedsBuild = Test-BackendStackNeedsBuild
  if ((Test-HttpReady $apiHealthUrl) -and (Test-AuthenticatedApiReady) -and -not $backendNeedsBuild) {
    Write-LaunchLog "API already healthy and authenticated, and backend images are up to date; skipping Docker Compose startup"
  } else {
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

    if ($backendNeedsBuild) {
      Write-LaunchLog "Backend source missing build stamp or newer than stamp; rebuilding backend stack"
    } else {
      Write-LaunchLog "Starting backend stack with image rebuild"
    }
    Invoke-ProcessWithTimeout -FilePath $dockerCli -ArgumentList @("compose", "up", "-d", "--build") -TimeoutSeconds $dockerBuildTimeoutSeconds | Out-Null
    Update-BackendBuildStamp
  }

  $apiReady = Wait-ForCondition -Condition { (Test-HttpReady $apiHealthUrl) -and (Test-AuthenticatedApiReady) } -TimeoutSeconds $TimeoutSeconds -SleepSeconds 1
  if (-not $apiReady) {
    throw "API did not become ready for authenticated desktop requests within $TimeoutSeconds seconds"
  }

  Write-LaunchLog "Launcher completed"
} catch {
  Write-LaunchLog "Launcher failed: $($_.Exception.Message)"
  if (-not $desktopLaunched) {
    throw
  }
} finally {
  if ($lockTaken) {
    $mutex.ReleaseMutex()
  }
  if ($mutex) {
    $mutex.Dispose()
  }
}
