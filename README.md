# Agent OpenClaw Orchestrator

A DBOS/Postgres-based multi-agent orchestration platform built around OpenClaw.

OpenClaw and ClawPanel are external products. This repository contains the
platform code, templates, docs, and local verification scripts that orchestrate
OpenClaw agents through a CLI adapter.

## Quickstart

```powershell
docker compose up --build
```

In another terminal:

```powershell
$body = @{ prompt = 'demo multi-agent job'; requesterId = 'quickstart' } | ConvertTo-Json
$job = Invoke-RestMethod -Uri 'http://localhost:3000/jobs' -Method Post -ContentType 'application/json' -Body $body
Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($job.jobId)"
Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($job.jobId)/messages"
```

The default Docker Compose path is HTTP-only and mock-mode. Feishu and real
OpenClaw are optional adapters/modes configured after the core stack is running.

## Repository Layout

```text
apps/                  API and DBOS worker code.
packages/              Shared DB and type packages.
scripts/               Dev/start/smoke/maintenance scripts.
platform-assets/       Agent templates and clearly marked vendor workarounds.
docs/                  Project structure, boundaries, setup notes, history.
CONTEXT.md             Current agent-facing project checkpoint.
SETUP.md               Local setup and smoke-test guide.
```

For details, read:

```text
docs/PROJECT_STRUCTURE.md
docs/BOUNDARIES.md
docs/feishu-public-ingress.md
SETUP.md
INSTALL.md
SECURITY.md
CONTRIBUTING.md
```

## License

Apache-2.0. See `LICENSE`.

## Local Checks

```powershell
npm run check
npm run check:no-secrets
npm run build
npm run smoke:docker-compose
npm run smoke:http-only
npm run smoke:feishu-webhook
npm run smoke:m2-recovery
npm run smoke:m3-config
npm run smoke:m3-real-planner
npm run smoke:tauri-shell
```

Optional real OpenClaw check, requiring a configured WSL OpenClaw runtime:

```powershell
npm run smoke:openclaw-real
```

Private/reference Feishu public ingress helpers:

```powershell
npm run prepare:public-ingress
npm run smoke:feishu-public
```

## Boundary Rule

Do not modify OpenClaw or ClawPanel source code as part of normal platform
development. Use `apps/dbos-worker/src/adapters/openclaw.ts` as the runtime
boundary, and keep prompt/config assets under
`platform-assets/openclaw-agent-templates/`.
