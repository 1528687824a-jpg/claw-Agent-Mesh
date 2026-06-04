# honeycomb

honeycomb is a local-first multi-agent orchestration platform for OpenClaw.
It gives an owner a durable control plane, a desktop console, and a guided
first-run interview that specializes an agent team around real work.

Use it when a one-off bot script is too fragile, but a hosted workflow product
is too opaque. It gives you a durable DBOS/Postgres control plane, four routing
modes, HTTP and Feishu adapters, and a desktop control console so an agent
cluster can be started, inspected, cancelled, and later generated from an
interview-style config flow.

## Why This Exists

Most multi-agent demos are easy to start and hard to trust: no durable state,
unclear handoffs, no replayable timeline, and no clean path from "my first
local run" to "my own agent cluster." honeycomb starts from the opposite
end:

```text
local first          run the stack on your machine
durable             DBOS checkpoints + Postgres business state
inspectable         jobs, messages, artifacts, and timeline are visible
mode-switchable     four routing modes are first-class product behavior
OpenClaw-native     a platform layer around OpenClaw, not a replacement for it
```

![HTTP-only quickstart demo](docs/assets/quickstart-demo.gif)

![honeycomb desktop UI](docs/assets/desktop-ui-mvp.png)

## Choose Your Path

```text
I want to feel the desktop product     npm run tryout:desktop
I want a desktop shortcut              npm run tryout:shortcut
I want the browser dev fallback        npm run tryout:start
I want the clean public quickstart     docker compose up --build
I want to generate a cluster           read docs/m3-real-provider-operator-guide.md
I want to understand future memory     read docs/experience-memory.md
```

## Owner Tryout

Before cutting a public release, use the owner tryout path to feel the product
locally from the Tauri desktop app:

```powershell
npm run tryout:desktop
```

This starts the HTTP-only mock backend, opens the desktop app on First Run, and
lets you configure a provider key, answer the work interview, generate a safe
agent setup bundle, then switch into the console. Stop it with:

```powershell
npm run tryout:stop
```

To put a launch icon on the Windows desktop:

```powershell
npm run tryout:shortcut
```

The shortcut opens the desktop app through a hidden launcher. Backend startup is
logged to `logs/desktop-launcher.log`; it should not leave a terminal window in
front of the app.

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
Desktop console                create, search/filter jobs, inspect timeline, cancel
Docker quickstart              Postgres + API + worker in mock HTTP-only mode
Optional adapters              Feishu local webhook, Feishu public ingress reference
OpenClaw real mode             adapter path exists; local smoke requires WSL setup
```

OpenClaw and ClawPanel are external products. This repository contains the
platform layer, templates, docs, and verification scripts that call OpenClaw
through a CLI adapter instead of modifying OpenClaw source.

## Desktop Console

The desktop shell lives under `apps/desktop-app`. It is a React/Tauri app for
the same HTTP API with two product views:

```text
First Run   guide, provider key, work interview, generated agent prompts
Console     create, search/filter jobs, inspect timelines, cancel runs
```

First Run keeps the raw provider key in memory and writes only a safe setup
bundle under the app data directory. Applying generated prompts into real
OpenClaw agent folders is a later explicit step with backups.

For the browser development fallback:

```powershell
npm install --prefix apps/desktop-app
npm --prefix apps/desktop-app run dev
```

Then open `http://localhost:5173` while the API is running. Full Tauri builds
require Rust/Cargo plus the native desktop packaging toolchain on the host. On
Windows that means Visual Studio Build Tools with MSVC and a Windows SDK. The
first local packaging proof and verified Windows installer artifact paths are tracked in
`docs/desktop-installer-notes.md`.

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
