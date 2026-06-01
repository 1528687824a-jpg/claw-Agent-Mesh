# Security Policy

## Supported Status

Agent OpenClaw is early-stage software. Treat it as a local/developer platform
unless you have reviewed and hardened the deployment yourself.

## Secret Handling

Do not commit secrets. This includes:

```text
Feishu app secrets and verification tokens
planner provider API keys
OpenClaw/model provider API keys
admin API tokens
cookies, bearer tokens, and private SSH keys
```

Use `.env` for local secrets. `.env` is ignored by git. `.env.example` must keep
secret values empty or use obvious placeholders.

Before opening a PR, run:

```powershell
npm run check:no-secrets
```

The checker is a hygiene guard, not a complete secret scanner. If you suspect a
secret was committed, rotate it immediately.

## Automated Provider Calls

Automated checks and agent-driven maintenance must not call paid LLM providers
without explicit operator authorization. CI-safe checks use mock mode or local
fake-provider smokes.

Examples that are safe to run automatically:

```text
npm run smoke:m3-real-planner
npm run smoke:m3-config
npm run smoke:http-only
```

Examples that require an explicit operator decision because they may call a
real provider or spend quota:

```text
npm run smoke:m3-real-provider
npm run smoke:openclaw-real
```

Do not treat the presence of provider keys in `.env` as permission to spend
quota. The operator must intentionally choose the real-provider run.

## Public Ingress

Only expose the narrow webhook path required by an adapter. For Feishu public
ingress, expose:

```text
/webhooks/feishu/events
```

Do not expose these paths to the public internet without additional auth,
network policy, and rate limiting:

```text
/jobs
/jobs/:id/details
/admin/*
```

The admin model-call recovery endpoint must remain disabled unless
`ADMIN_API_TOKEN` is set. If enabled, protect it behind private network access
or equivalent controls.

## Adapter Boundary

OpenClaw and ClawPanel are external products. This repo should call OpenClaw
through the adapter boundary instead of patching vendor code as part of normal
operation. Manual vendor workarounds under `platform-assets/vendor-workarounds`
are local recovery aids, not the default install path.

## Reporting

This repository does not yet have a public security mailbox. Until one exists,
report vulnerabilities privately to the repository owner or through the hosting
platform's private vulnerability reporting feature if enabled.
