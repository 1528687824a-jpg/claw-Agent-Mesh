# Contributing

Thanks for helping make Agent OpenClaw usable by people who are not already
inside the author's local setup.

## Product Direction

The mainline goal is an open-source, downloadable multi-agent orchestration
platform built on top of OpenClaw:

```text
download -> start local stack -> generate/configure an agent cluster
         -> switch routing modes -> inspect and operate jobs
```

Feishu public ingress is an optional self-hosting adapter path. It should not
become required for the core product path.

## Boundaries

Keep OpenClaw/ClawPanel as an external runtime. Platform code should call it
through:

```text
apps/dbos-worker/src/adapters/openclaw.ts
```

Prompt/config templates belong under:

```text
platform-assets/openclaw-agent-templates/
```

Manual local vendor workarounds belong under:

```text
platform-assets/vendor-workarounds/
```

## Development Checks

Run the narrow checks that match your change. A broad local pass is:

```powershell
npm run check
npm run check:no-secrets
npm run smoke:m3-real-planner
npm run smoke:tauri-shell
```

For runtime changes, also run the relevant smoke:

```powershell
npm run smoke:http-only
npm run smoke:m3-config
npm run smoke:m2-recovery
```

Run local smoke scripts sequentially unless the script documents an isolated
runtime. Several smokes share Postgres and port 3000.

## Secrets

Never commit `.env`, provider keys, tokens, cookies, or private deployment
config. Use placeholders in docs and examples.

## Pull Request Expectations

Keep PRs scoped. Include:

```text
what changed
why it changed
which checks were run
any known follow-up or risk
```

If a change affects durable workflow behavior, explain how DBOS checkpointing,
Postgres state, and external OpenClaw idempotency are preserved.
