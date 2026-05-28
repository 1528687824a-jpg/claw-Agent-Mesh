$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $root ".runtime/public-ingress"
$templatesDir = Join-Path $root "config/public-ingress"

$domain = if ($env:FEISHU_PUBLIC_DOMAIN) { $env:FEISHU_PUBLIC_DOMAIN } else { "tomorrow123.art" }
$vpsHost = if ($env:FEISHU_PUBLIC_VPS_HOST) { $env:FEISHU_PUBLIC_VPS_HOST } else { $domain }
$frpBindPort = if ($env:FRP_BIND_PORT) { [int]$env:FRP_BIND_PORT } else { 7000 }
$frpRemoteApiPort = if ($env:FRP_REMOTE_API_PORT) { [int]$env:FRP_REMOTE_API_PORT } else { 13000 }
$localApiPort = if ($env:LOCAL_API_PORT) { [int]$env:LOCAL_API_PORT } else { 3000 }
$certFullchainPath = if ($env:CERT_FULLCHAIN_PATH) {
  $env:CERT_FULLCHAIN_PATH
} else {
  "/etc/letsencrypt/live/$domain/fullchain.pem"
}
$certPrivkeyPath = if ($env:CERT_PRIVKEY_PATH) {
  $env:CERT_PRIVKEY_PATH
} else {
  "/etc/letsencrypt/live/$domain/privkey.pem"
}

function New-Token {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

$tokenPath = Join-Path $runtimeDir "frp-token.txt"
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

if (Test-Path -LiteralPath $tokenPath) {
  $frpToken = (Get-Content -Raw -LiteralPath $tokenPath).Trim()
} else {
  $frpToken = New-Token
  Set-Content -LiteralPath $tokenPath -Value $frpToken -Encoding UTF8
}

$replacements = @{
  "{{DOMAIN}}" = $domain
  "{{VPS_HOST}}" = $vpsHost
  "{{FRP_BIND_PORT}}" = [string]$frpBindPort
  "{{FRP_REMOTE_API_PORT}}" = [string]$frpRemoteApiPort
  "{{LOCAL_API_PORT}}" = [string]$localApiPort
  "{{CERT_FULLCHAIN_PATH}}" = $certFullchainPath
  "{{CERT_PRIVKEY_PATH}}" = $certPrivkeyPath
  "{{FRP_AUTH_TOKEN}}" = $frpToken
}

function Expand-Template {
  param(
    [Parameter(Mandatory = $true)]
    [string]$TemplatePath,
    [Parameter(Mandatory = $true)]
    [string]$OutputPath
  )

  $content = Get-Content -Raw -LiteralPath $TemplatePath
  foreach ($key in $replacements.Keys) {
    $content = $content.Replace($key, $replacements[$key])
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null
  Set-Content -LiteralPath $OutputPath -Value $content -Encoding UTF8
}

Expand-Template `
  -TemplatePath (Join-Path $templatesDir "frp/frps.toml.example") `
  -OutputPath (Join-Path $runtimeDir "vps/etc/frp/agent-openclaw-frps.toml")
Expand-Template `
  -TemplatePath (Join-Path $templatesDir "frp/frpc.toml.example") `
  -OutputPath (Join-Path $runtimeDir "local/frpc/agent-openclaw-frpc.toml")
Expand-Template `
  -TemplatePath (Join-Path $templatesDir "nginx/tomorrow123.art.conf.example") `
  -OutputPath (Join-Path $runtimeDir "vps/nginx/$domain.conf")
Expand-Template `
  -TemplatePath (Join-Path $templatesDir "systemd/frps-agent-openclaw.service.example") `
  -OutputPath (Join-Path $runtimeDir "vps/systemd/frps-agent-openclaw.service")
Expand-Template `
  -TemplatePath (Join-Path $templatesDir "systemd/frpc-agent-openclaw.service.example") `
  -OutputPath (Join-Path $runtimeDir "local/systemd/frpc-agent-openclaw.service")

$vpsCommands = @"
# Agent OpenClaw public Feishu ingress - VPS commands
# Run on the VPS as a sudo-capable user. Do not paste secrets into chat.

set -euo pipefail

sudo mkdir -p /etc/frp /etc/nginx/sites-available /etc/nginx/sites-enabled

# Upload/copy these generated files first:
#   .runtime/public-ingress/vps/etc/frp/agent-openclaw-frps.toml -> /etc/frp/agent-openclaw-frps.toml
#   .runtime/public-ingress/vps/nginx/$domain.conf -> /etc/nginx/sites-available/$domain.conf
#   .runtime/public-ingress/vps/systemd/frps-agent-openclaw.service -> /etc/systemd/system/frps-agent-openclaw.service

sudo ln -sfn /etc/nginx/sites-available/$domain.conf /etc/nginx/sites-enabled/$domain.conf
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable --now frps-agent-openclaw.service
sudo systemctl reload nginx

sudo ss -lntp | grep -E ':($frpBindPort|$frpRemoteApiPort)\b' || true
sudo systemctl status frps-agent-openclaw.service --no-pager
"@
Set-Content -LiteralPath (Join-Path $runtimeDir "vps-commands.sh") -Value $vpsCommands -Encoding UTF8

$localCommands = @"
# Agent OpenClaw public Feishu ingress - local Windows commands

# 1. Start local orchestrator in mock mode for public Feishu E2E.
`$env:OPENCLAW_AGENT_MODE='mock'
`$env:FEISHU_DRY_RUN='false'
npm run dev:start

# 2. Start frpc with the generated config after installing/downloading frpc.
# Example:
# .\frpc.exe -c .runtime\public-ingress\local\frpc\agent-openclaw-frpc.toml

# 3. Verify public challenge path after frpc + VPS Nginx are connected.
`$env:FEISHU_PUBLIC_WEBHOOK_URL='https://$domain/webhooks/feishu/events'
npm run smoke:feishu-public
"@
Set-Content -LiteralPath (Join-Path $runtimeDir "local-commands.ps1") -Value $localCommands -Encoding UTF8

$manifest = [pscustomobject]@{
  domain = $domain
  vpsHost = $vpsHost
  frpBindPort = $frpBindPort
  frpRemoteApiPort = $frpRemoteApiPort
  localApiPort = $localApiPort
  certFullchainPath = $certFullchainPath
  certPrivkeyPath = $certPrivkeyPath
  runtimeDir = $runtimeDir
  secretTokenFile = $tokenPath
  generatedAt = (Get-Date).ToString("o")
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $runtimeDir "manifest.json") -Encoding UTF8

[pscustomobject]@{
  ok = $true
  runtimeDir = $runtimeDir
  vpsFrpsConfig = Join-Path $runtimeDir "vps/etc/frp/agent-openclaw-frps.toml"
  vpsNginxConfig = Join-Path $runtimeDir "vps/nginx/$domain.conf"
  localFrpcConfig = Join-Path $runtimeDir "local/frpc/agent-openclaw-frpc.toml"
  vpsCommands = Join-Path $runtimeDir "vps-commands.sh"
  localCommands = Join-Path $runtimeDir "local-commands.ps1"
  tokenStoredIn = $tokenPath
} | ConvertTo-Json -Compress

