param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Name,

  [Parameter(Mandatory = $true, Position = 1)]
  [string]$ScriptPath
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$lockDir = Join-Path $root ".runtime\locks"
$lockPath = Join-Path $lockDir "$Name.lock"
$resolvedScriptPath = [System.IO.Path]::GetFullPath((Join-Path $root $ScriptPath))
$resolvedScriptsRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)

if (-not $resolvedScriptPath.StartsWith($resolvedScriptsRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to run script outside scripts directory: $resolvedScriptPath"
}

if (-not (Test-Path -LiteralPath $resolvedScriptPath)) {
  throw "Smoke script not found: $resolvedScriptPath"
}

New-Item -ItemType Directory -Force -Path $lockDir | Out-Null

$stream = $null
try {
  try {
    $stream = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  } catch {
    $owner = ""
    if (Test-Path -LiteralPath $lockPath) {
      $owner = Get-Content -LiteralPath $lockPath -Raw -ErrorAction SilentlyContinue
    }
    throw "Smoke lock '$Name' is already held. Lock file: $lockPath`n$owner"
  }

  $payload = @{
    pid = $PID
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
    scriptPath = $resolvedScriptPath
  } | ConvertTo-Json -Depth 3

  $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
  $stream.SetLength(0)
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Flush()

  Write-Output "Acquired smoke lock '$Name'"

  & powershell -NoProfile -ExecutionPolicy Bypass -File $resolvedScriptPath
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    exit $exitCode
  }
} finally {
  if ($stream) {
    $stream.Dispose()
  }
  Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}
