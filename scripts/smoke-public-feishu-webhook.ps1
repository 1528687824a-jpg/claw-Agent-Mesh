$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
if (-not $env:FEISHU_PUBLIC_WEBHOOK_URL) {
  throw "FEISHU_PUBLIC_WEBHOOK_URL is required, for example: `$env:FEISHU_PUBLIC_WEBHOOK_URL='https://example.com/webhooks/feishu/events'"
}
$publicWebhookUrl = $env:FEISHU_PUBLIC_WEBHOOK_URL
$localApiBaseUrl = if ($env:ORCHESTRATOR_LOCAL_BASE_URL) {
  $env:ORCHESTRATOR_LOCAL_BASE_URL.TrimEnd("/")
} else {
  "http://localhost:3000"
}

function Read-DotEnvValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $envPath = Join-Path $root ".env"
  if (-not (Test-Path -LiteralPath $envPath)) {
    return $null
  }

  foreach ($line in Get-Content -LiteralPath $envPath) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }

    $index = $trimmed.IndexOf("=")
    if ($index -le 0) {
      continue
    }

    $key = $trimmed.Substring(0, $index).Trim()
    if ($key -ne $Name) {
      continue
    }

    $value = $trimmed.Substring($index + 1).Trim()
    return $value.Trim('"').Trim("'")
  }

  return $null
}

function Get-VerificationToken {
  if ($env:FEISHU_VERIFICATION_TOKEN) {
    return $env:FEISHU_VERIFICATION_TOKEN
  }

  $fromDotEnv = Read-DotEnvValue -Name "FEISHU_VERIFICATION_TOKEN"
  if ($fromDotEnv) {
    return $fromDotEnv
  }

  throw "FEISHU_VERIFICATION_TOKEN is not set in the environment or .env"
}

function ConvertTo-JsonContent {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Body
  )

  return $Body | ConvertTo-Json -Depth 20 -Compress
}

function ConvertFrom-JsonContent {
  param(
    [string]$Content
  )

  if (-not $Content) {
    return $null
  }

  try {
    return $Content | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Read-ErrorResponseContent {
  param(
    [object]$Response
  )

  if (-not $Response) {
    return ""
  }

  $stream = $Response.GetResponseStream()
  if (-not $stream) {
    return ""
  }

  $reader = New-Object System.IO.StreamReader($stream)
  try {
    return $reader.ReadToEnd()
  } finally {
    $reader.Dispose()
  }
}

function Invoke-PublicWebhook {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Body
  )

  $json = ConvertTo-JsonContent -Body $Body

  try {
    $response = Invoke-WebRequest `
      -Uri $publicWebhookUrl `
      -Method Post `
      -ContentType "application/json" `
      -Body $json `
      -UseBasicParsing `
      -TimeoutSec 20

    return [pscustomobject]@{
      StatusCode = [int]$response.StatusCode
      Content = $response.Content
      Body = ConvertFrom-JsonContent -Content $response.Content
    }
  } catch {
    $statusCode = $null
    $content = ""
    if ($_.Exception.Response) {
      $statusCode = [int]$_.Exception.Response.StatusCode
      $content = Read-ErrorResponseContent -Response $_.Exception.Response
    }

    return [pscustomobject]@{
      StatusCode = $statusCode
      Content = $content
      Body = ConvertFrom-JsonContent -Content $content
      Error = $_.Exception.Message
    }
  }
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

function Assert-GetNotSuccessful {
  try {
    $response = Invoke-WebRequest `
      -Uri $publicWebhookUrl `
      -Method Get `
      -UseBasicParsing `
      -TimeoutSec 12

    if ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 300) {
      throw "GET $publicWebhookUrl unexpectedly succeeded with $($response.StatusCode)"
    }
  } catch {
    if ($_.Exception.Response) {
      $statusCode = [int]$_.Exception.Response.StatusCode
      if ($statusCode -eq 404 -or $statusCode -eq 405 -or $statusCode -eq 401) {
        return
      }
    }

    if ($_.Exception.Message -like "*unexpectedly succeeded*") {
      throw
    }
  }
}

function Wait-ForJobTerminalStatus {
  param(
    [Parameter(Mandatory = $true)]
    [string]$JobId
  )

  $terminal = @("succeeded", "failed", "waiting_for_human", "cancelled")
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 2
    try {
      $job = Invoke-RestMethod -Uri "$localApiBaseUrl/jobs/$JobId" -Method Get -TimeoutSec 5
      if ($terminal -contains $job.status) {
        return $job
      }
    } catch {
      if ($i -gt 5) {
        throw
      }
    }
  }

  throw "Timed out waiting for job $JobId to reach a terminal status"
}

$token = Get-VerificationToken
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$challenge = "codex-public-smoke-$stamp"

Write-Host "Checking public Feishu webhook: $publicWebhookUrl"

Assert-GetNotSuccessful

$challengeResponse = Invoke-PublicWebhook -Body @{
  challenge = $challenge
  token = $token
}
Assert-Equal -Actual $challengeResponse.StatusCode -Expected 200 -Message "challenge status"
Assert-Equal -Actual $challengeResponse.Body.challenge -Expected $challenge -Message "challenge echo"

$wrongTokenResponse = Invoke-PublicWebhook -Body @{
  challenge = "wrong-token-$stamp"
  token = "wrong-public-smoke-token"
}
Assert-Equal -Actual $wrongTokenResponse.StatusCode -Expected 401 -Message "wrong token status"
Assert-Equal -Actual $wrongTokenResponse.Body.error -Expected "invalid_feishu_token" -Message "wrong token error"

$createdJob = $null
if ($env:FEISHU_PUBLIC_SMOKE_SEND_MESSAGE -eq "true") {
  $messageId = "om_public_smoke_$stamp"
  $messageContent = @{ text = "public webhook smoke write a short local note" } | ConvertTo-Json -Compress
  $messageBody = @{
    schema = "2.0"
    header = @{
      token = $token
      event_id = "ev_public_smoke_$stamp"
      event_type = "im.message.receive_v1"
    }
    event = @{
      sender = @{
        sender_id = @{
          open_id = "ou_public_smoke_user"
        }
      }
      message = @{
        message_id = $messageId
        content = $messageContent
        mentions = @()
      }
    }
  }

  $messageResponse = Invoke-PublicWebhook -Body $messageBody
  Assert-Equal -Actual $messageResponse.StatusCode -Expected 201 -Message "message event status"
  Assert-True -Condition ([bool]$messageResponse.Body.jobId) -Message "message event did not create a job"
  $createdJob = Wait-ForJobTerminalStatus -JobId $messageResponse.Body.jobId
  Assert-Equal -Actual $createdJob.status -Expected "succeeded" -Message "created job terminal status"
}

$result = [pscustomobject]@{
  ok = $true
  publicWebhookUrl = $publicWebhookUrl
  challenge = "passed"
  wrongToken = "passed"
  getNotSuccessful = "passed"
  syntheticMessage = if ($createdJob) { "succeeded" } else { "skipped" }
  jobId = if ($createdJob) { $createdJob.id } else { $null }
}

$result | ConvertTo-Json -Compress
