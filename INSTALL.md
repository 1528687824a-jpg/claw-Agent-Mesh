# Install Agent OpenClaw

Agent OpenClaw is a DBOS/Postgres multi-agent orchestration platform that runs
OpenClaw agents through an adapter boundary. The default install path is
HTTP-only and mock-mode so new users can verify the platform before adding
Feishu, real OpenClaw, or planner credentials.

## Requirements

```text
Docker with Docker Compose
Node.js ^20.19.0 or >=22.12.0
npm >=10
PowerShell on Windows for local smoke scripts
```

CI currently runs Node 22. Local development has also been verified on
Node 24.15.0 with npm 11.12.1.

OpenClaw real mode additionally requires a working OpenClaw CLI runtime. The
Docker quickstart does not require OpenClaw.

## Docker Quickstart

```powershell
git clone <repo-url>
cd agent-openclaw
docker compose up --build
```

In another terminal:

```powershell
$body = @{ prompt = 'demo multi-agent job'; requesterId = 'quickstart' } | ConvertTo-Json
$job = Invoke-RestMethod -Uri 'http://localhost:3000/jobs' -Method Post -ContentType 'application/json' -Body $body
Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($job.jobId)"
Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($job.jobId)/messages"
```

Default Compose mode:

```text
FEISHU_ADAPTER_ENABLED=false
FEISHU_DRY_RUN=true
OPENCLAW_AGENT_MODE=mock
```

Stop the stack:

```powershell
docker compose down
```

Use `docker compose down -v` only when you intentionally want to delete local
Postgres and job-data volumes.

## Local Development

```powershell
npm install
npm run dev:start
```

Useful checks:

```powershell
npm run check
npm run check:no-secrets
npm run smoke:http-only
npm run smoke:m3-real-planner
npm run smoke:tauri-shell
```

Run local smoke scripts sequentially. Several scripts start/stop the same local
API process, use the same Postgres instance, and bind port 3000.

## M3 Configuration Generation

Mock planner preview:

```powershell
npm run m3:generate -- --answers examples/m3/interview.answers.example.json --out .runtime/m3-preview
```

Write generated config and agent prompts:

```powershell
npm run m3:generate -- --answers examples/m3/interview.answers.example.json --out .runtime/m3-content-studio --approve
```

Optional real planner mode uses an OpenAI-compatible chat-completions endpoint:

```powershell
$env:M3_PLANNER_MODE = 'openai-compatible'
$env:M3_PLANNER_BASE_URL = 'https://api.example.com/v1'
$env:M3_PLANNER_MODEL = '<planner-model>'
$env:M3_PLANNER_API_KEY = '<secret>'
npm run m3:generate -- --answers examples/m3/interview.answers.example.json --out .runtime/m3-real-preview --approve
```

Never commit planner API keys.

## Optional Integrations

Feishu is an optional ingress/egress adapter, not the product control bus. Keep
the default HTTP path working without Feishu credentials.

Real OpenClaw mode is enabled with:

```text
OPENCLAW_AGENT_MODE=real
OPENCLAW_WSL_DISTRO=<your-wsl-distro>
OPENCLAW_CLI=<path-to-openclaw-cli>
```

See `SETUP.md` for the full local setup and smoke-test guide.
