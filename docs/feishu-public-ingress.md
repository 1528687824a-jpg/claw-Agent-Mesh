# Feishu Public HTTPS Ingress

This guide describes the first production-style ingress for Feishu events:

```text
Feishu
  -> https://tomorrow123.art/webhooks/feishu/events
  -> VPS Nginx HTTPS
  -> frp TCP tunnel
  -> local Windows orchestrator-api http://127.0.0.1:3000/webhooks/feishu/events
  -> DBOS JobPipelineWorkflow
```

Feishu remains a human entrypoint and visible display screen. It is not the
agent-to-agent control plane. Real orchestration remains DBOS + Postgres.

## Current Verified Public State

As of the latest check:

```text
tomorrow123.art -> 49.232.90.172
http://tomorrow123.art/health -> 308 Permanent Redirect
https://tomorrow123.art/health -> 200 {"status":"ok"}
https://tomorrow123.art/webhooks/feishu/events -> 404
```

Interpretation:

```text
DNS and HTTPS are alive, but /webhooks/feishu/events is not yet proxied to
orchestrator-api. The current /health response is likely a VPS/Nginx health
endpoint, not the local orchestrator-api health response.
```

## Security Boundary

Only expose this public path:

```text
/webhooks/feishu/events
```

Do not expose these routes to the public internet:

```text
/jobs
/jobs/:jobId
/jobs/:jobId/details
/admin/*
```

First production pass should keep Feishu Encrypt Key disabled and rely on
`FEISHU_VERIFICATION_TOKEN`. If Encrypt Key is enabled later, add decrypt and
signature handling before turning it on in Feishu.

Never copy `.env` secrets, Feishu app secrets, tenant tokens, OpenClaw provider
keys, or frp tokens into documentation, chat, or committed files.

## Files Added For Ingress

```text
config/public-ingress/nginx/tomorrow123.art.conf.example
config/public-ingress/frp/frps.toml.example
config/public-ingress/frp/frpc.toml.example
config/public-ingress/systemd/frps-agent-openclaw.service.example
config/public-ingress/systemd/frpc-agent-openclaw.service.example
scripts/smoke-public-feishu-webhook.ps1
```

Copy templates out of the repo, replace placeholders locally, and keep real
tokens out of git.

To generate a local untracked deployment bundle with a random frp token:

```powershell
npm run prepare:public-ingress
```

The bundle is written under:

```text
.runtime/public-ingress/
```

`.runtime/` is gitignored. Do not copy the generated token into committed docs
or chat.

## Preflight Checklist

On the VPS:

```text
[ ] DNS A record points tomorrow123.art to the VPS public IP.
[ ] Nginx is installed and serving HTTPS.
[ ] Certbot/Let's Encrypt certificate exists or can be issued.
[ ] frps is installed.
[ ] Firewall permits 80/443 and frps bind port, but does not publicly expose
    the frp remote API port unless intentionally allowed.
[ ] Nginx has a location for /webhooks/feishu/events that proxies to the frp
    remote TCP port.
```

On the local Windows machine:

```text
[ ] Docker Desktop / Postgres can start.
[ ] npm run dev:start works.
[ ] http://localhost:3000/health returns {"ok":true}.
[ ] .env has Feishu values configured locally.
[ ] OPENCLAW_AGENT_MODE=mock for first public E2E.
[ ] FEISHU_DRY_RUN=false if you want visible Feishu group replies.
[ ] frpc is installed and connected to the VPS frps.
```

In Feishu Open Platform:

```text
[ ] Event subscription request URL is ready to set to:
    https://tomorrow123.art/webhooks/feishu/events
[ ] Encrypt Key is disabled for first pass.
[ ] Verification Token matches local FEISHU_VERIFICATION_TOKEN.
[ ] Message event subscription is enabled.
[ ] Bot is in the target group.
```

## VPS Setup Outline

1. Install Nginx, certbot, and frps.
2. Copy `config/public-ingress/frp/frps.toml.example` to the VPS.
3. Replace placeholders:

```text
{{FRP_BIND_PORT}}
{{FRP_AUTH_TOKEN}}
{{FRP_REMOTE_API_PORT}}
```

4. Install and start the frps systemd service using the template.
5. Copy the Nginx template and adjust:

```text
{{DOMAIN}}
{{FRP_REMOTE_API_PORT}}
{{CERT_FULLCHAIN_PATH}}
{{CERT_PRIVKEY_PATH}}
```

6. Reload Nginx.

Recommended Nginx behavior:

```text
GET /webhooks/feishu/events -> 404 or 405
POST /webhooks/feishu/events -> proxied to frp/local API
all other paths -> 404 unless explicitly needed
```

## Local Setup Outline

1. Start the local orchestrator in mock mode:

```powershell
$env:OPENCLAW_AGENT_MODE='mock'
$env:FEISHU_DRY_RUN='false'
npm run dev:start
```

Use `FEISHU_DRY_RUN='true'` only for inbound-only testing. Full visible Feishu
group validation needs real sending, so it requires `FEISHU_DRY_RUN=false` and
configured Feishu credentials.

2. Confirm local API:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

Expected:

```json
{"ok":true}
```

3. Copy `config/public-ingress/frp/frpc.toml.example` to a local untracked
runtime location and replace:

```text
{{VPS_HOST}}
{{FRP_BIND_PORT}}
{{FRP_AUTH_TOKEN}}
{{FRP_REMOTE_API_PORT}}
{{LOCAL_API_PORT}}
```

4. Start frpc and confirm the tunnel is online.

## Public Smoke Test

Run from the repo root after Nginx/frp/local API are connected:

```powershell
$env:FEISHU_PUBLIC_WEBHOOK_URL='https://tomorrow123.art/webhooks/feishu/events'
$env:FEISHU_PUBLIC_SMOKE_SEND_MESSAGE='false'
npm run smoke:feishu-public
```

The default smoke checks:

```text
1. POST challenge with the configured token returns the challenge.
2. POST challenge with a wrong token returns 401 invalid_feishu_token.
3. GET on the webhook path is not treated as success.
```

Optional fake-message E2E through the public URL:

```powershell
$env:FEISHU_PUBLIC_SMOKE_SEND_MESSAGE='true'
npm run smoke:feishu-public
```

This sends a synthetic Feishu-style message event with the configured token. It
should create one job and wait for the job to reach `succeeded` in mock mode.
Use this only when local orchestrator-api is intentionally running and pointed
at the same `FEISHU_VERIFICATION_TOKEN`.

## Feishu Backend Configuration

Set request URL:

```text
https://tomorrow123.art/webhooks/feishu/events
```

Expected Feishu challenge behavior:

```text
Feishu sends POST with challenge + token
Nginx proxies it through frp
orchestrator-api validates FEISHU_VERIFICATION_TOKEN
orchestrator-api returns {"challenge":"..."}
Feishu backend accepts the URL
```

After Feishu accepts the URL, send a normal message in the target group. First
end-to-end pass should use:

```text
OPENCLAW_AGENT_MODE=mock
FEISHU_DRY_RUN=false
```

Expected:

```text
1. Feishu message event reaches POST /webhooks/feishu/events.
2. A new agent.jobs row is created.
3. DBOS workflow starts.
4. Job reaches succeeded.
5. Feishu group receives visible display messages from the single bot.
```

## Troubleshooting

```text
404 on /webhooks/feishu/events:
  Nginx location is missing or not matching, or request is not reaching the
  frp/local API path.

502/504 from Nginx:
  frpc is disconnected, frps remote port is wrong, local API is down, or
  firewall blocks the frp remote port.

401 invalid_feishu_token:
  FEISHU_VERIFICATION_TOKEN mismatch between Feishu backend and local API.

Feishu challenge timeout:
  Nginx/frp/local API path is too slow or unreachable. Check Nginx access/error
  logs, frps/frpc logs, and local orchestrator logs.

Duplicate Feishu message creates duplicate job:
  Check `jobs_feishu_message_id_idx` and getJobByFeishuMessageId behavior.

Group messages not visible:
  Check FEISHU_DRY_RUN, FEISHU_DEFAULT_CHAT_ID, bot permissions, and Feishu
  adapter delivery events in agent_events.
```
