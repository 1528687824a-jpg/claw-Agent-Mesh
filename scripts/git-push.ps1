param(
  [int]$Attempts = 4,
  [int]$DelaySeconds = 15,
  [string]$Remote = "origin",
  [string]$Branch = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $Branch) {
  $Branch = (git branch --show-current).Trim()
}
if (-not $Branch) {
  throw "Could not determine current branch."
}

for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
  Write-Host "git push attempt $attempt/$Attempts -> $Remote $Branch"
  git push $Remote $Branch
  if ($LASTEXITCODE -eq 0) {
    Write-Host "git push succeeded"
    exit 0
  }

  if ($attempt -lt $Attempts) {
    Start-Sleep -Seconds $DelaySeconds
  }
}

throw "git push failed after $Attempts attempts."
