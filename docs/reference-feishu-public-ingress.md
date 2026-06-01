# Reference: Feishu Public HTTPS Ingress

This is an optional self-hosting reference for users who want Feishu events to
reach a local Agent OpenClaw API through their own public HTTPS endpoint.

It is not the main product quickstart and it is not required for the
HTTP-only, Docker Compose, M3 config-generation, or desktop UI paths.

```text
Feishu
  -> https://<your-domain>/webhooks/feishu/events
  -> your VPS / reverse proxy / tunnel
  -> local orchestrator-api http://127.0.0.1:3000/webhooks/feishu/events
  -> DBOS JobPipelineWorkflow
```

Feishu remains a human entrypoint and visible display screen. The agent-to-agent
control plane is DBOS + Postgres.

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

## Reference Files

```text
config/public-ingress/nginx/feishu-webhook.conf.example
config/public-ingress/frp/frps.toml.example
config/public-ingress/frp/frpc.toml.example
config/public-ingress/systemd/frps-agent-openclaw.service.example
config/public-ingress/systemd/frpc-agent-openclaw.service.example
scripts/prepare-public-ingress-bundle.ps1
scripts/smoke-public-feishu-webhook.ps1
```

Copy templates out of the repo, replace placeholders locally, and keep real
tokens out of git.

Generate an untracked deployment bundle:

```powershell
$env:FEISHU_PUBLIC_DOMAIN='example.com'
$env:FEISHU_PUBLIC_VPS_HOST='example.com'
npm run prepare:public-ingress
```

The bundle is written under:

```text
.runtime/public-ingress/
```

`.runtime/` is gitignored. Do not copy the generated token into committed docs
or chat.

## Preflight Checklist

On the public host:

```text
[ ] DNS points your domain to the public host.
[ ] Nginx or an equivalent reverse proxy is installed and serving HTTPS.
[ ] A certificate exists or can be issued.
[ ] frps or an equivalent tunnel endpoint is installed if the API remains local.
[ ] Firewall permits 80/443 and the tunnel bind port.
[ ] The reverse proxy forwards only /webhooks/feishu/events to the local API.
```

On the local machine:

```text
[ ] docker compose up --build or npm run dev:start works.
[ ] http://localhost:3000/health returns {"ok":true}.
[ ] .env has local Feishu values.
[ ] OPENCLAW_AGENT_MODE=mock for first public E2E.
[ ] FEISHU_DRY_RUN=false if you want visible Feishu group replies.
[ ] frpc or another tunnel client is connected to the public host.
```

In Feishu Open Platform:

```text
[ ] Event subscription request URL is:
    https://<your-domain>/webhooks/feishu/events
[ ] Encrypt Key is disabled for the first pass.
[ ] Verification Token matches local FEISHU_VERIFICATION_TOKEN.
[ ] Message event subscription is enabled.
[ ] Bot is in the target group.
```

## VPS / Reverse Proxy Outline

1. Install Nginx, certbot, and frps.
2. Copy `config/public-ingress/frp/frps.toml.example` to the public host.
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
POST /webhooks/feishu/events -> proxied to tunnel/local API
all other paths -> 404 unless explicitly needed
```

## Local Setup Outline

Start the local orchestrator in mock mode:

```powershell
$env:OPENCLAW_AGENT_MODE='mock'
$env:FEISHU_DRY_RUN='false'
npm run dev:start
```

Use `FEISHU_DRY_RUN='true'` only for inbound-only testing. Full visible Feishu
group validation needs real sending, so it requires `FEISHU_DRY_RUN=false` and
configured Feishu credentials.

Confirm local API:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

Expected:

```json
{"ok":true}
```

Copy `config/public-ingress/frp/frpc.toml.example` to a local untracked runtime
location and replace:

```text
{{VPS_HOST}}
{{FRP_BIND_PORT}}
{{FRP_AUTH_TOKEN}}
{{FRP_REMOTE_API_PORT}}
{{LOCAL_API_PORT}}
```

Start frpc and confirm the tunnel is online.

## Public Smoke Test

Run from the repo root after the public host, tunnel, and local API are
connected:

```powershell
$env:FEISHU_PUBLIC_WEBHOOK_URL='https://example.com/webhooks/feishu/events'
$env:FEISHU_PUBLIC_SMOKE_SEND_MESSAGE='false'
npm run smoke:feishu-public
```

The smoke checks:

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
https://<your-domain>/webhooks/feishu/events
```

Expected challenge behavior:

```text
Feishu sends POST with challenge + token
reverse proxy forwards it through the tunnel
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
5. Feishu group receives visible display messages from the bot.
```

## Troubleshooting

```text
404 on /webhooks/feishu/events:
  Reverse-proxy location is missing or not matching, or the request is not
  reaching the local API path.

502/504 from the reverse proxy:
  tunnel client is disconnected, the remote port is wrong, local API is down,
  or firewall rules block the tunnel.

401 invalid_feishu_token:
  FEISHU_VERIFICATION_TOKEN mismatch between Feishu backend and local API.

Feishu challenge timeout:
  Public host, tunnel, or local API path is too slow or unreachable. Check
  reverse-proxy logs, tunnel logs, and local orchestrator logs.

Duplicate Feishu message creates duplicate job:
  Check jobs_feishu_message_id_idx and getJobByFeishuMessageId behavior.

Group messages not visible:
  Check FEISHU_DRY_RUN, FEISHU_DEFAULT_CHAT_ID, bot permissions, and Feishu
  adapter delivery events in agent_events.
```
