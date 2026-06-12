$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "honeycomb-api-token.ps1")
$apiHeaders = Get-HoneycombApiHeaders
$apiBaseUrl = "http://127.0.0.1:3000"
$runtimeDir = Join-Path $root ".runtime"
$serverPath = Join-Path $runtimeDir "provider-batch-verify-server.cjs"
$port = 39217 + (Get-Random -Minimum 0 -Maximum 300)
$serverProcess = $null

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

try {
  Set-Location $root
  $env:FEISHU_ADAPTER_ENABLED = "false"
  $env:FEISHU_DRY_RUN = "true"
  $env:OPENCLAW_AGENT_MODE = "mock"
  Remove-Item Env:\DBOS_TEST_CRASH_ONCE_AFTER -ErrorAction SilentlyContinue

  if (-not (Test-Path -LiteralPath $runtimeDir)) {
    New-Item -ItemType Directory -Path $runtimeDir | Out-Null
  }

  @'
const http = require("node:http");

const port = Number(process.env.SMOKE_PROVIDER_PORT);
const expectedKey = process.env.SMOKE_PROVIDER_API_KEY;

const server = http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "not_found" } }));
    return;
  }

  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    if (request.headers.authorization !== `Bearer ${expectedKey}`) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "bad_key" } }));
      return;
    }

    const parsed = JSON.parse(body || "{}");
    const delayMs = String(parsed.model || "").includes("slow") ? 80 : 10;
    setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "OK" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      }));
    }, delayMs);
  });
});

server.listen(port, "127.0.0.1");
'@ | Set-Content -LiteralPath $serverPath -Encoding UTF8

  $node = (Get-Command node).Source
  $env:SMOKE_PROVIDER_PORT = [string]$port
  $env:SMOKE_PROVIDER_API_KEY = "sk-batch-smoke"
  $serverProcess = Start-Process -FilePath $node -ArgumentList @($serverPath) -PassThru -WindowStyle Hidden

  $healthUrl = "http://127.0.0.1:$port/health"
  for ($i = 0; $i -lt 50; $i++) {
    try {
      Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1 | Out-Null
      break
    } catch {
      Start-Sleep -Milliseconds 100
      if ($i -eq 49) {
        throw "Timed out waiting for fake provider server"
      }
    }
  }

  npm run dev:start | Out-Host

  $suffix = [guid]::NewGuid().ToString("N").Substring(0, 8)
  $fastProviderId = "batch-fast-$suffix"
  $slowProviderId = "batch-slow-$suffix"
  $baseUrl = "http://127.0.0.1:$port/v1"

  foreach ($providerSpec in @(
    @{ id = $fastProviderId; model = "fast-model-$suffix"; name = "Batch fast smoke" },
    @{ id = $slowProviderId; model = "slow-model-$suffix"; name = "Batch slow smoke" }
  )) {
    Invoke-RestMethod `
      -Uri "$apiBaseUrl/providers" `
      -Method Post `
      -Headers $apiHeaders `
      -ContentType "application/json" `
      -Body (@{
        id = $providerSpec.id
        displayName = $providerSpec.name
        baseUrl = $baseUrl
        defaultModel = $providerSpec.model
        apiKey = "sk-batch-smoke"
      } | ConvertTo-Json -Depth 6) | Out-Null
  }

  $batch = Invoke-RestMethod `
    -Uri "$apiBaseUrl/providers/verify-batch" `
    -Method Post `
    -Headers $apiHeaders `
    -ContentType "application/json" `
    -Body (@{
      providerIds = @($fastProviderId, $slowProviderId)
      timeoutMs = 5000
    } | ConvertTo-Json -Depth 6)

  Assert-Equal -Actual $batch.count -Expected 2 -Message "batch count"
  Assert-Equal -Actual $batch.succeeded -Expected 2 -Message "batch succeeded count"
  Assert-Equal -Actual $batch.failed -Expected 0 -Message "batch failed count"

  $fastResult = @($batch.results) | Where-Object { $_.providerId -eq $fastProviderId } | Select-Object -First 1
  $slowResult = @($batch.results) | Where-Object { $_.providerId -eq $slowProviderId } | Select-Object -First 1
  Assert-True -Condition ($null -ne $fastResult) -Message "fast provider batch result missing"
  Assert-True -Condition ($null -ne $slowResult) -Message "slow provider batch result missing"
  Assert-True -Condition ($fastResult.verification.latencyMs -ge 0) -Message "fast latency missing"
  Assert-True -Condition ($slowResult.verification.latencyMs -ge $fastResult.verification.latencyMs) -Message "slow latency should not be faster than fast smoke"
  Assert-Equal -Actual $fastResult.provider.metadata.verification.status -Expected "succeeded" -Message "fast metadata verification status"
  Assert-True -Condition ($fastResult.provider.metadata.verification.latencyMs -ge 0) -Message "fast metadata latency missing"

  [pscustomobject]@{
    ok = $true
    fastProviderId = $fastProviderId
    slowProviderId = $slowProviderId
    fastLatencyMs = $fastResult.verification.latencyMs
    slowLatencyMs = $slowResult.verification.latencyMs
    checks = @(
      "fake_openai_compatible_provider_started",
      "provider_batch_verify_endpoint",
      "verification_latency_recorded",
      "provider_metadata_verification_updated"
    )
  } | ConvertTo-Json -Depth 5
} finally {
  if ($null -ne $serverProcess -and -not $serverProcess.HasExited) {
    Stop-Process -Id $serverProcess.Id -Force
  }
}
