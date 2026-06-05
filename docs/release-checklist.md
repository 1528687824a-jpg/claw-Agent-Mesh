# Release Checklist

This checklist keeps alpha/release work pointed at the product goal: a
downloadable OpenClaw multi-agent orchestration platform that a new user can
start locally, inspect, and extend without depending on the author's private
Feishu/domain setup.

## Alpha Definition

Alpha is ready when a new operator can verify these paths from the public repo:

```text
1. HTTP-only Docker quickstart reaches a succeeded mock job.
2. README and QUICKSTART explain the first run without private credentials.
3. Desktop console is visible and usable against the local API.
4. Windows desktop installer can be built locally.
5. M3 real-provider config path has one explicitly authorized real-provider
   smoke result.
6. Git remote/CI exists and the CI-safe checks are green.
```

The first alpha does not require:

```text
Feishu public HTTPS ingress on the author's domain.
waiting_for_human resume/accept/retry API.
M2 recovery nightly CI.
macOS/Linux desktop installers.
Real media providers.
OpenClaw real mode across all four routing modes.
```

Those remain useful follow-up work, but they should not displace first-run
onboarding and release trust signals.

## Public Release Readiness

Passing the alpha gates means the project is technically eligible for a first
alpha, but it should not be published before the maintainer can experience the
local product loop directly.

Before cutting `v0.1.0-alpha`:

```text
1. Run npm run tryout:start.
2. Confirm the desktop console opens and shows API online.
3. Create at least one job from the console.
4. Inspect messages and timeline.
5. Stop with npm run tryout:stop after the manual tryout is done.
```

This keeps the release path anchored in "can I use it?" rather than "can CI
pass?"

## Current Gate State

```text
HTTP-only Docker quickstart        done
  latest proof: JOB-20260601-EF874902 succeeded, persistenceCheck=passed

README/QUICKSTART first run        done
  docs/assets/quickstart-demo.gif is linked from both files

Desktop console                    done for MVP
  create/search/filter/cancel/timeline smokes pass in dev and prod UI modes

Windows desktop installer          done on local Windows host
  MSI/NSIS artifacts copied to D:\AgentOpenClaw\installers\2026-06-01

Cross-platform installer probes    partial
  smoke:tauri-shell reports native packaging readiness on Windows, macOS, and
  Linux, but only Windows has a verified installer artifact so far

M3 real-provider smoke             done with explicit operator authorization
  latest proof: 2026-06-02 DeepSeek openai-compatible planner,
  model=deepseek-v4-pro, JOB-20260602-A219930D succeeded

Git remote + hosted CI             done
  latest proof: 71a49c4 hosted CI success, followed by 00a9e17
  desktop handoff checkpoint [skip ci]

Owner local tryout path            done for dev/browser console
  latest proof: npm run tryout:start -- -NoOpen passed on 2026-06-02;
  desktop UI smoke created JOB-20260602-41970DBA and rendered timeline
```

## Pre-Release Local Commands

Safe commands that can run without paid providers:

```powershell
npm run check
npm run check:no-secrets
npm run smoke:docker-compose
npm run smoke:http-only
npm run smoke:m3-config
npm run smoke:m3-real-planner
npm run smoke:cancel-job
npm run smoke:timeline-since
npm run smoke:list-jobs
npm run smoke:experience-memory
npm run smoke:desktop-ui
npm run smoke:desktop-ui-prod
npm run smoke:desktop-memory
npm run smoke:tauri-shell
npm --prefix apps/desktop-app run tauri:build
```

Run sequentially when they share the dev stack. The smoke lock protects common
cases, but parallel smoke runs still make the operator experience worse.

Checks requiring explicit operator authorization:

```powershell
npm run smoke:m3-real-provider
npm run smoke:openclaw-real
```

Provider keys in `.env` are not permission to spend quota.

## Artifact Policy

Commit:

```text
source code
docs
small docs/assets demo media
Tauri Cargo.lock
Tauri icon source assets
```

Do not commit:

```text
.env
.runtime
node_modules
apps/desktop-app/dist
apps/desktop-app/src-tauri/target
installer binaries
job data
logs
```

Installer artifacts should be generated per release and attached to the release
outside Git. The current local Windows proof artifacts are intentionally kept on
D: only.

## Direction Guardrails

Keep these decisions intact unless the product goal changes:

```text
Feishu is an optional adapter/display path, not the control plane.
tomorrow123.art is a private/reference deployment detail, not a product fact.
Postgres remains the v1 durability database; do not switch to SQLite/pglite.
Desktop app is a thin client for v1; it does not embed the backend stack yet.
Real provider and real OpenClaw checks require explicit operator authorization.
```
