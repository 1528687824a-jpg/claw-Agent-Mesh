$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$webhookUrl = "http://localhost:3000/webhooks/feishu/events"
$token = "local-feishu-webhook-smoke-token"
$botOpenId = "ou_local_webhook_smoke_bot"

function Start-DevForWebhookSmoke {
  Set-Location $root
  $env:FEISHU_DRY_RUN = "true"
  $env:OPENCLAW_AGENT_MODE = "mock"
  $env:FEISHU_VERIFICATION_TOKEN = $token
  $env:FEISHU_BOT_OPEN_ID = $botOpenId
  Remove-Item Env:\DBOS_TEST_CRASH_ONCE_AFTER -ErrorAction SilentlyContinue

  npm run dev:start | Out-Host
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

function Invoke-Webhook {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Body
  )

  $json = ConvertTo-JsonContent -Body $Body

  try {
    $response = Invoke-WebRequest `
      -Uri $webhookUrl `
      -Method Post `
      -ContentType "application/json" `
      -Body $json `
      -UseBasicParsing

    return [pscustomobject]@{
      StatusCode = [int]$response.StatusCode
      Body = ConvertFrom-JsonContent -Content $response.Content
      RawBody = $response.Content
    }
  } catch {
    $response = $_.Exception.Response
    $content = $_.ErrorDetails.Message
    if (-not $content) {
      $content = Read-ErrorResponseContent -Response $response
    }
    $statusCode = if ($response) { [int]$response.StatusCode } else { 0 }

    return [pscustomobject]@{
      StatusCode = $statusCode
      Body = ConvertFrom-JsonContent -Content $content
      RawBody = $content
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

function Assert-Truthy {
  param(
    [object]$Value,
    [string]$Message
  )

  if (-not $Value) {
    throw $Message
  }
}

function New-WebhookBody {
  param(
    [string]$MessageId,
    [string]$Text,
    [string]$OpenId = "ou_local_webhook_smoke_user"
  )

  return @{
    header = @{
      token = $token
      event_type = "im.message.receive_v1"
    }
    event = @{
      sender = @{
        sender_id = @{
          open_id = $OpenId
          user_id = "local-webhook-smoke-user"
        }
      }
      message = @{
        message_id = $MessageId
        chat_id = "oc_local_webhook_smoke_chat"
        content = (@{ text = $Text } | ConvertTo-Json -Compress)
        mentions = @(
          @{
            key = "@_local_smoke_bot"
          }
        )
      }
    }
  }
}

function Wait-ForTerminalStatus {
  param(
    [string]$JobId
  )

  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 1
    $job = Invoke-RestMethod -Uri "http://localhost:3000/jobs/$JobId"
    if (@("succeeded", "failed", "waiting_for_human", "cancelled") -contains $job.status) {
      return $job
    }
  }

  throw "Timed out waiting for $JobId"
}

Start-DevForWebhookSmoke

$challenge = Invoke-Webhook -Body @{
  token = $token
  challenge = "local-webhook-smoke-challenge"
}
Assert-Equal -Actual $challenge.StatusCode -Expected 200 -Message "challenge status"
Assert-Equal -Actual $challenge.Body.challenge -Expected "local-webhook-smoke-challenge" -Message "challenge response"

$wrongToken = Invoke-Webhook -Body @{
  token = "wrong-token"
  challenge = "should-not-pass"
}
Assert-Equal -Actual $wrongToken.StatusCode -Expected 401 -Message "wrong token status"
Assert-Equal -Actual $wrongToken.Body.error -Expected "invalid_feishu_token" -Message "wrong token error"

$notMessage = Invoke-Webhook -Body @{
  header = @{
    token = $token
    event_type = "app.ticket"
  }
  event = @{}
}
Assert-Equal -Actual $notMessage.StatusCode -Expected 200 -Message "non-message status"
Assert-Equal -Actual $notMessage.Body.ignored -Expected $true -Message "non-message ignored"
Assert-Equal -Actual $notMessage.Body.reason -Expected "not_a_message_event" -Message "non-message reason"

$botMessage = Invoke-Webhook -Body (New-WebhookBody `
  -MessageId "feishu-smoke-bot-$([guid]::NewGuid().ToString('N'))" `
  -Text "@_local_smoke_bot ignore this bot echo" `
  -OpenId $botOpenId)
Assert-Equal -Actual $botMessage.StatusCode -Expected 200 -Message "bot message status"
Assert-Equal -Actual $botMessage.Body.ignored -Expected $true -Message "bot message ignored"
Assert-Equal -Actual $botMessage.Body.reason -Expected "bot_message_display_only" -Message "bot message reason"

$messageId = "feishu-smoke-$([guid]::NewGuid().ToString('N'))"
$normalBody = New-WebhookBody `
  -MessageId $messageId `
  -Text "@_local_smoke_bot research current durable webhook patterns and write a short local smoke summary"

$created = Invoke-Webhook -Body $normalBody
Assert-Equal -Actual $created.StatusCode -Expected 201 -Message "normal message status"
Assert-Equal -Actual $created.Body.ok -Expected $true -Message "normal message ok"
Assert-Truthy -Value $created.Body.jobId -Message "normal message jobId missing"
Assert-Equal -Actual $created.Body.ingressOrigin -Expected "feishu" -Message "normal message ingress origin"
Assert-Equal -Actual $created.Body.routingMode -Expected "supervisor_pipeline" -Message "default routing mode"
Assert-Equal -Actual $created.Body.maxModelCalls -Expected 20 -Message "default max model calls"
Assert-Equal -Actual $created.Body.classicFinalGateEnabled -Expected $false -Message "default classic final gate"
Assert-Equal -Actual $created.Body.discussionRounds -Expected 2 -Message "default discussion rounds"

$duplicate = Invoke-Webhook -Body $normalBody
Assert-Equal -Actual $duplicate.StatusCode -Expected 200 -Message "duplicate status"
Assert-Equal -Actual $duplicate.Body.duplicate -Expected $true -Message "duplicate flag"
Assert-Equal -Actual $duplicate.Body.jobId -Expected $created.Body.jobId -Message "duplicate job id"

$job = Wait-ForTerminalStatus -JobId $created.Body.jobId
Assert-Equal -Actual $job.status -Expected "succeeded" -Message "created job terminal status"
Assert-Equal -Actual $job.ingressOrigin -Expected "feishu" -Message "job ingress origin"
Assert-Equal -Actual $job.feishuMessageId -Expected $messageId -Message "job feishu message id"
Assert-Equal -Actual $job.discussionRounds -Expected 2 -Message "job discussion rounds"

[pscustomobject]@{
  ok = $true
  jobId = $created.Body.jobId
  duplicateJobId = $duplicate.Body.jobId
  terminalStatus = $job.status
  routingMode = $job.routingMode
  maxModelCalls = $job.maxModelCalls
  classicFinalGateEnabled = $job.classicFinalGateEnabled
  discussionRounds = $job.discussionRounds
  checked = @(
    "challenge"
    "wrong_token"
    "non_message_ignored"
    "bot_message_ignored"
    "normal_message_created_job"
    "duplicate_message_id_reused_job"
  )
} | ConvertTo-Json -Depth 4
