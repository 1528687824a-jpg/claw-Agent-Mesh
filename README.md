# Agent OpenClaw

Agent OpenClaw is a local-first multi-agent orchestration platform for
OpenClaw. The GitHub repository is `claw-Agent-Mesh`; the product is Agent
OpenClaw.

Use it when a one-off bot script is too fragile, but a hosted workflow product
is too opaque. It gives you a durable DBOS/Postgres control plane, four routing
modes, HTTP and Feishu adapters, and a web control panel so an agent cluster can
be started, inspected, cancelled, and later generated from an interview-style
config flow.

## Why This Exists

Most multi-agent demos are easy to start and hard to trust: no durable state,
unclear handoffs, no replayable timeline, and no clean path from "my first
local run" to "my own agent cluster." Agent OpenClaw starts from the opposite
end:

```text
local first          run the stack on your machine
durable             DBOS checkpoints + Postgres business state
inspectable         jobs, messages, artifacts, and timeline are visible
mode-switchable     four routing modes are first-class product behavior
OpenClaw-native     a platform layer around OpenClaw, not a replacement for it
```

![HTTP-only quickstart demo](docs/assets/quickstart-demo.gif)

![Agent OpenClaw web panel](docs/assets/desktop-ui-mvp.png)

## Choose Your Path

```text
I want to open the web panel           npm run tryout:web
I want the same default alias          npm run tryout:start
I want the backend stack               docker compose up --build
I want the old full-stack tryout       npm run tryout:stack
I want to generate a cluster           read docs/m3-real-provider-operator-guide.md
I want to understand future memory     read docs/experience-memory.md
```

## Owner Tryout

Before cutting a public release, use the owner tryout path to feel the product
locally from the browser-based web panel:

```powershell
npm run tryout:web
```

This opens the web panel on First Run. It does not start Docker Desktop or
Docker Compose. If `http://localhost:3000` is already running, the panel shows
API online; otherwise it still opens and shows API offline. Start the backend
separately when you want live jobs:

```powershell
docker compose up --build
```

Stop the web panel with:

```powershell
npm run tryout:stop
```

See `docs/owner-tryout.md` for the local experience checklist.

## Quickstart

Start the local stack:

```powershell
docker compose up --build
```

This starts Postgres, `orchestrator-api` on `http://localhost:3000`, and the
DBOS worker. In another terminal, create a job:

```powershell
$body = @{
  prompt = 'Plan a short launch article for a new AI writing tool'
  requesterId = 'quickstart'
  routingMode = 'supervisor_pipeline'
} | ConvertTo-Json

$created = Invoke-RestMethod `
  -Uri 'http://localhost:3000/jobs' `
  -Method Post `
  -ContentType 'application/json' `
  -Body $body

$created
```

Expected shape:

```json
{
  "jobId": "JOB-...",
  "status": "queued",
  "ingressOrigin": "http"
}
```

Poll the job and read its visible outputs:

```powershell
do {
  Start-Sleep -Seconds 2
  $job = Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($created.jobId)"
  $job.status
} until (@('succeeded', 'failed', 'waiting_for_human', 'cancelled') -contains $job.status)

Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($created.jobId)/messages"
Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($created.jobId)/timeline"
```

Equivalent one-line `curl` create call:

```bash
curl -s -X POST http://localhost:3000/jobs -H 'content-type: application/json' -d '{"prompt":"Plan a short launch article for a new AI writing tool","requesterId":"quickstart","routingMode":"supervisor_pipeline"}'
```

Ready-made request bodies for all four routing modes live under
`examples/demo-jobs/`.

Stop the stack:

```powershell
docker compose down
```

The Docker volumes keep Postgres and job artifacts. Use
`docker compose down -v` only when you want to delete local state.

## Pick A Routing Mode

| Mode | Choose It When |
| --- | --- |
| `supervisor_pipeline` | You want the safest default: stage-by-stage handoff, test-agent review after each stage, retries, and human stop on repeated failure. |
| `pipeline` | You want a fast linear chain where each child agent hands output to the next, with a final quality gate. |
| `classic_master_slave` | You want the main agent to dispatch child agents independently and gather their outputs, with an optional final gate. |
| `master_slave_discussion` | You want multiple child agents to discuss for persisted rounds, then let the main agent synthesize the result. |

Most first runs should use `supervisor_pipeline`. Use
`master_slave_discussion` for ambiguous tasks where disagreement is useful, and
`pipeline` for predictable production chains.

## What Works Now

```text
HTTP job API                  POST /jobs, GET /jobs, messages, timeline, cancel
Durable orchestration          DBOS checkpoints + Postgres business state
Routing modes                  supervisor, pipeline, classic, discussion
M3 config generation           mock and fake-provider smokes pass
Web panel                      create, search/filter jobs, inspect timeline, cancel
Docker quickstart              Postgres + API + worker in mock HTTP-only mode
Optional adapters              Feishu local webhook, Feishu public ingress reference
OpenClaw real mode             adapter path exists; local smoke requires WSL setup
```

OpenClaw and ClawPanel are external products. This repository contains the
platform layer, templates, docs, and verification scripts that call OpenClaw
through a CLI adapter instead of modifying OpenClaw source.

## Web Panel

The web panel currently lives under `apps/desktop-app` for historical reasons.
It is a React/Vite app for the same HTTP API with two product views:

```text
First Run   guide, provider key, work interview, generated agent prompts
Console     create, search/filter jobs, inspect timelines, cancel runs
```

First Run keeps the raw provider key in memory and saves only a safe preview in
browser state. Applying generated prompts into real OpenClaw agent folders is a
later explicit step with backups.

Open the web panel:

```powershell
npm run tryout:web
```

Optional Tauri packaging can wrap the same panel later, but it is no longer the
primary product path.

## Local Checks

Local Node-based scripts require Node `^20.19.0 || >=22.12.0` and npm `>=10`.

```powershell
npm run check
npm run check:no-secrets
npm run build
npm run smoke:docker-compose
npm run smoke:http-only
npm run smoke:m3-config
npm run smoke:m3-real-planner
npm run smoke:cancel-job
npm run smoke:desktop-ui
npm run smoke:desktop-ui-prod
npm run smoke:tauri-shell
```

Optional checks:

```powershell
npm run smoke:m3-real-provider
npm run smoke:feishu-webhook
npm run smoke:m2-recovery
npm run smoke:openclaw-real
```

`smoke:m3-real-provider` requires local `M3_PLANNER_BASE_URL`,
`M3_PLANNER_MODEL`, and `M3_PLANNER_API_KEY` configuration. It does not print
secret values. See `docs/m3-real-provider-operator-guide.md` for provider
templates and failure triage. `smoke:openclaw-real` requires a configured WSL
OpenClaw runtime.

Feishu public HTTPS ingress is an optional self-hosting reference path, not a
quickstart or product gate. See `docs/reference-feishu-public-ingress.md`; the
helper scripts require explicit `FEISHU_PUBLIC_*` environment variables.

## Repository Map

```text
apps/                  API, worker, and desktop client.
examples/              Pasteable demo jobs and M3 interview answers.
packages/              Shared DB and type packages.
scripts/               Dev/start/smoke/maintenance scripts.
platform-assets/       Agent templates and marked vendor workarounds.
docs/                  Project boundaries, setup notes, and reference guides.
CONTEXT.md             Current agent-facing project checkpoint.
SETUP.md               Detailed local setup and smoke-test guide.
```

Read next:

```text
QUICKSTART.md
INSTALL.md
SETUP.md
docs/PROJECT_STRUCTURE.md
docs/BOUNDARIES.md
docs/job-cancellation-semantics.md
docs/m3-real-provider-operator-guide.md
docs/experience-memory.md
docs/owner-tryout.md
docs/desktop-installer-notes.md
docs/release-checklist.md
docs/reference-feishu-public-ingress.md
SECURITY.md
CONTRIBUTING.md
```

## Boundary Rule

Do not modify OpenClaw or ClawPanel source code as part of normal platform
development. Use `apps/dbos-worker/src/adapters/openclaw.ts` as the runtime
boundary, and keep prompt/config assets under
`platform-assets/openclaw-agent-templates/`.

## License

Apache-2.0. See `LICENSE`.
