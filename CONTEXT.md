# Agent OpenClaw Context Checkpoint

## Standing User Workflow Rule

```text
After each completed task, Codex must:
1. update the relevant context/memory files;
2. tell the user the next several tasks in execution order.

This rule was confirmed by the user on 2026-05-28 and applies to subsequent
work on this project unless the user changes it.
```

## 2026-05-30 Claude Review And Open-Source License Checkpoint

Claude's latest analysis was reviewed independently instead of adopted blindly.

Judgment:

```text
Claude was mostly right on the product risks:
1. M3 real planner is a real missing product-value layer and should move up.
2. Tauri shell smoke was too shallow if it only checked file presence.
3. Smoke-script concurrency risk should live in project docs/checks, not only
   in chat memory.
4. tomorrow123.art remains a private/reference deployment task, not product
   mainline.

Adjustment:
1. LICENSE is cheap and important for open-source readiness, so it was done
   immediately.
2. Rust/Tauri real build proof matters, but should not block M3 real planner
   on this host just because cargo/rustc is currently missing.
3. The next mainline should keep product value first: harden smokes/docs, then
   start M3 real planner vertical slice.
```

Completed in this checkpoint:

```text
Added LICENSE with Apache-2.0 terms.
Added "license": "Apache-2.0" to root package.json.
Added "license": "Apache-2.0" to apps/desktop-app/package.json.
Updated README.md with a License section.
Regenerated package-lock metadata through npm install --package-lock-only
--ignore-scripts.
```

Next ordered tasks:

```text
1. Current: harden smoke guidance and smoke:tauri-shell content assertions.
2. Next: M3 real planner vertical slice behind explicit env/provider config.
3. Then: CI for no-secret checks (check, http-only smoke, m3 smoke,
   tauri-shell smoke).
4. Then: INSTALL.md / SECURITY.md / CONTRIBUTING.md.
5. Then: Rust toolchain + real Tauri build proof when host/tooling is ready.
6. Later: job timeline/inspect endpoint and cancel job API.
```

## 2026-05-30 Smoke Guidance And Tauri Shell Checkpoint

Completed:

```text
Updated SETUP.md with Smoke Script Rules:
  - run local smoke scripts sequentially;
  - several scripts share npm run dev:start/dev:stop, Postgres, and port 3000;
  - smoke:docker-compose uses an isolated Compose project and should be treated
    as a separate quickstart proof;
  - smoke:feishu-public remains a private/reference deployment check.

Strengthened scripts/smoke-tauri-shell.ps1:
  - asserts Vite dev server host/port/strictPort;
  - asserts Tauri productName, identifier, devUrl, frontendDist;
  - asserts desktop tauri:dev and tauri:build scripts;
  - asserts Cargo package name and Tauri v2 dependency.
```

Validation:

```text
npm run smoke:tauri-shell -> passed
  rustToolchain=missing
  buildRunnable=false
  checked=react_shell_files, api_client, vite_dev_server_config,
          tauri_config, desktop_package_scripts, cargo_manifest,
          rust_toolchain_probe

npm run check -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Next ordered tasks:

```text
1. Current: M3 real planner vertical slice behind explicit env/provider config.
2. Then: CI for no-secret checks (check, http-only smoke, m3 smoke,
   tauri-shell smoke).
3. Then: INSTALL.md / SECURITY.md / CONTRIBUTING.md.
4. Then: Rust toolchain + real Tauri build proof when host/tooling is ready.
5. Later: job timeline/inspect endpoint and cancel job API.
```

## 2026-05-30 M3 Real Planner Checkpoint

M3 now has a real-planner vertical slice while preserving the mock default.

Code changes:

```text
Updated scripts/generate-cluster-config.ts:
  - added --planner mock|openai-compatible;
  - added optional --model and --base-url CLI overrides;
  - added M3_PLANNER_MODE, M3_PLANNER_BASE_URL, M3_PLANNER_MODEL,
    M3_PLANNER_API_KEY, M3_PLANNER_TEMPERATURE, and
    M3_PLANNER_TIMEOUT_SECONDS env support;
  - default remains mock and requires no secret/network call;
  - openai-compatible planner calls /chat/completions, asks for JSON, validates
    roles against the local role catalog, and converts planner-selected stages
    into AgentClusterConfig.

Updated AgentClusterConfig source metadata:
  - source.planner is now "mock" | "openai-compatible";
  - source.model can record the planner model without storing secrets.

Added scripts/smoke-m3-real-planner.ts and npm run smoke:m3-real-planner:
  - starts a local fake OpenAI-compatible chat-completions provider;
  - runs m3:generate through the openai-compatible planner path;
  - verifies auth/model request shape, JSON response parsing, source metadata,
    and planner-selected stage order.

Updated .env.example / README.md / SETUP.md with the optional planner env and
the new smoke.
```

Validation:

```text
npm run smoke:m3-real-planner -> passed
  planner=openai-compatible
  model=planner-smoke-model
  stageAgents=research-agent, writer-agent, video-agent

npm run check -> passed
git diff --check -> passed; only Windows CRLF warnings were printed

npm run smoke:m3-config -> passed
  job=JOB-20260530-9ECC11C2
  terminalStatus=succeeded
  stageAgents=research-agent, writer-agent, image-agent
```

Notes:

```text
Do not commit real M3 planner API keys. Real provider use is opt-in through
environment variables. The fake-provider smoke is the normal CI-safe proof.

During smoke:m3-config, Docker Desktop printed a transient npipe connection
warning but the local dev stack started and the smoke passed.
```

Next ordered tasks:

```text
1. Current: CI for no-secret checks (check, http-only smoke, m3 smoke,
   m3-real-planner smoke, tauri-shell smoke).
2. Then: INSTALL.md / SECURITY.md / CONTRIBUTING.md.
3. Then: Rust toolchain + real Tauri build proof when host/tooling is ready.
4. Later: job timeline/inspect endpoint and cancel job API.
```

## 2026-05-30 CI Checkpoint

CI scaffolding is added for the open-source product path.

Code changes:

```text
Added .github/workflows/ci.yml with two jobs:
  node-smokes on windows-latest:
    npm ci
    npm run check
    npm run check:no-secrets
    npm run smoke:m3-real-planner
    npm run smoke:tauri-shell

  docker-quickstart on ubuntu-latest:
    docker compose up -d --build
    POST /jobs
    poll job to succeeded
    verify ingressOrigin=http
    GET /jobs/:id/messages
    docker compose down -v

Added scripts/check-no-secrets.ts and npm run check:no-secrets.
The check scans tracked files for high-confidence secret-looking tokens and
non-placeholder values for sensitive env names, while allowing documented local
smoke placeholders and GitHub secrets references.

Updated README.md and SETUP.md with the new check and CI-safe subset.
```

Local validation:

```text
npm run check -> passed
npm run check:no-secrets -> passed
npm run smoke:m3-real-planner -> passed
npm run smoke:tauri-shell -> passed
docker compose config -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Notes:

```text
The full GitHub Actions workflow has not run remotely from this local session.
The Ubuntu docker-quickstart job is designed to test the HTTP-only product path
without relying on Windows PowerShell scripts.
```

Next ordered tasks:

```text
1. Current: INSTALL.md / SECURITY.md / CONTRIBUTING.md.
2. Then: Rust toolchain + real Tauri build proof when host/tooling is ready.
3. Then: job timeline/inspect endpoint.
4. Then: cancel job API.
```

## 2026-05-30 Open-Source Docs Checkpoint

Completed:

```text
Added INSTALL.md:
  - Docker quickstart;
  - local development;
  - M3 mock and real planner usage;
  - optional Feishu/OpenClaw integration notes.

Added SECURITY.md:
  - early-stage support status;
  - secret handling rules;
  - public ingress exposure boundary;
  - admin endpoint caution;
  - OpenClaw adapter boundary;
  - reporting note.

Added CONTRIBUTING.md:
  - product direction;
  - OpenClaw/ClawPanel boundary;
  - development checks;
  - sequential smoke rule;
  - PR expectations.

Updated README.md to link INSTALL.md, SECURITY.md, and CONTRIBUTING.md.
```

Validation:

```text
npm run check:no-secrets -> passed
npm run check -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Next ordered tasks:

```text
1. Current: Rust toolchain + real Tauri build proof when host/tooling is ready.
2. Then: job timeline/inspect endpoint.
3. Then: cancel job API.
```

## 2026-05-28 Stage 1.1 Adapter Abstraction Checkpoint

Stage 1.1 is implemented: HTTP is now the core ingress/egress path and Feishu
is an optional adapter/plugin.

Code changes:

```text
1. packages/shared/src/types.ts
   - added INGRESS_ORIGINS, IngressOrigin, IngressAdapter, EgressAdapter,
     OutboundMessage, DeliveryResult.
2. packages/db/src/migrate.ts
   - added agent.jobs.ingress_origin text not null default 'http'.
3. packages/db/src/jobs.ts
   - createJob persists ingressOrigin; JobRecord exposes ingressOrigin.
4. apps/orchestrator-api/src/adapters/
   - added HTTP ingress adapter for POST /jobs.
   - added Feishu ingress adapter for POST /webhooks/feishu/events.
   - Feishu adapter is disabled when FEISHU_ADAPTER_ENABLED=false and otherwise
     enabled when Feishu-related env is present.
5. apps/orchestrator-api/src/server.ts
   - mounts enabled ingress adapters.
   - added GET /jobs/:jobId/messages for HTTP egress consumption.
6. apps/dbos-worker/src/egress/
   - added EgressDispatcher, HttpEgressAdapter, FeishuEgressAdapter.
   - worker group-message delivery now routes by job.ingressOrigin.
7. scripts/smoke-http-only-end-to-end.ps1
   - added HTTP-only smoke with FEISHU_ADAPTER_ENABLED=false.
8. scripts/smoke-feishu-webhook.ps1
   - now asserts Feishu-created jobs have ingressOrigin=feishu.
9. README.md / SETUP.md
   - updated product smoke order and documented HTTP-only core path.
```

Validation:

```text
npm run check -> passed
npm run smoke:http-only -> passed
  job=JOB-20260528-7153FEB0
  terminalStatus=succeeded
  ingressOrigin=http
  messageCount=4
  finalMessageCount=2
  Feishu adapter disabled and no Feishu message id attached.

npm run smoke:feishu-webhook -> passed
  job=JOB-20260528-6187CD70
  terminalStatus=succeeded
  ingressOrigin=feishu assertion passed

npm run smoke:m2-recovery -> passed before final doc/smoke assertion edits
  pipeline job=JOB-20260528-0484B8DE succeeded
  master_slave_discussion job=JOB-20260528-85E3E240 succeeded

git diff --check -> passed; only Windows CRLF warnings were printed.
```

Notes:

```text
Do not run multiple smoke scripts that call npm run dev:start in parallel.
They share the same Postgres/dev stack and can race during migration. Sequential
runs are clean.

npm run smoke:feishu-public is not a Stage 1.1 product gate. It remains a
private/reference deployment check for tomorrow123.art and is still expected to
fail until VPS Nginx/frp routing is configured.
```

Next ordered tasks:

```text
1. Completed: Stage 1.1 committed as c30f4d6 Add adapter-based ingress and egress.
2. Stage 1.2: Docker Compose one-command quickstart, default HTTP-only.
3. Add smoke:docker-compose on a clean runner path.
4. After Docker quickstart, start M3 config generation vertical slice.
5. Later: OpenClaw real-mode E2E proof and Tauri shell.
```

## 2026-05-28 Stage 1.2 Docker Compose Quickstart Checkpoint

Task 2 is implemented: Docker Compose now describes the default open-source
quickstart stack.

Code changes:

```text
Added .dockerignore.
Added Dockerfile.api.
Added Dockerfile.worker.
Added packages/db/src/wait-for-postgres.ts.
Updated docker-compose.yml:
  postgres: postgres:17-alpine with persistent postgres-data volume.
  orchestrator-api: HTTP API on port 3000, runs wait -> migrate -> server.
  dbos-worker: optional recovery worker, starts after API is healthy.
  job-data volume persists generated job files.
  default env is HTTP-only + mock:
    FEISHU_ADAPTER_ENABLED=false
    FEISHU_DRY_RUN=true
    OPENCLAW_AGENT_MODE=mock
Updated scripts/start-dev.ps1 to start only the postgres service so local dev
does not collide with the Docker quickstart API container.
Updated README.md and SETUP.md so docker compose up --build is the public
quickstart path.
```

Validation:

```text
npm run build -> passed
npm run check -> passed
docker compose config -> passed
```

Next ordered tasks:

```text
1. Completed: Stage 1.1 committed as c30f4d6.
2. Completed: Stage 1.2 Docker Compose quickstart files/config.
3. Current: add and run smoke:docker-compose from up -> POST /jobs -> poll -> messages -> down.
4. Next: M3 config generation vertical slice.
5. Later: OpenClaw real-mode E2E proof and Tauri shell.
```

## 2026-05-28 Docker Compose Smoke Checkpoint

Task 3 is implemented and verified.

Code changes:

```text
Added scripts/smoke-docker-compose.ps1.
Added npm script: npm run smoke:docker-compose.
Updated README.md and SETUP.md to include the repeatable Docker smoke.
```

Smoke behavior:

```text
1. stops local dev stack;
2. uses isolated compose project agent-openclaw-smoke;
3. docker compose up -d --build;
4. waits for /health;
5. POST /jobs through HTTP core ingress;
6. polls job to succeeded;
7. reads GET /jobs/:jobId/messages;
8. docker compose down, then up again without deleting the smoke volume;
9. verifies the job is still present;
10. final cleanup removes only the smoke project volumes.
```

Validation:

```text
npm run smoke:docker-compose -> passed
  job=JOB-20260528-A047A8AC
  terminalStatus=succeeded
  ingressOrigin=http
  messageCount=4
  persistenceCheck=passed

Note:
  The first attempt exposed a local Postgres 16 volume vs Postgres 17 image
  incompatibility. The smoke now uses an isolated compose project so it does
  not touch or delete the user's existing default development volume.
```

Next ordered tasks:

```text
1. Completed: Stage 1.1 committed as c30f4d6.
2. Completed: Stage 1.2 Docker Compose quickstart, committed as c5fee50.
3. Completed: smoke:docker-compose verified, committed as c5fee50.
4. Current: M3 config generation vertical slice.
5. Later: OpenClaw real-mode E2E proof and Tauri shell.
```

## 2026-05-28 M3 Config Generation Vertical Slice Checkpoint

Task 4 is implemented and verified. M3 now exists as a backend/CLI vertical
slice before any Tauri UI work.

Code changes:

```text
Added examples/m3/interview.answers.example.json.
Added scripts/generate-cluster-config.ts.
Added scripts/smoke-m3-config.ps1.
Added npm scripts:
  npm run m3:generate
  npm run smoke:m3-config
Added packages/shared AgentClusterConfig types.
Added apps/dbos-worker/src/config/cluster.ts.
Updated createPipelinePlan so AGENT_CLUSTER_CONFIG_PATH is read inside the
checkpointed DBOS planning step. If not set, the old prompt-inference behavior
remains unchanged.
Updated README.md and SETUP.md with M3 CLI/smoke usage.
```

Generated cluster flow:

```text
structured interview answers JSON
  -> mock planner
  -> preview gate
  -> cluster.config.json
  -> agents/<agent-id>/AGENTS.md
  -> AGENT_CLUSTER_CONFIG_PATH
  -> DBOS createPipelinePlan uses generated stages
```

Validation:

```text
npm run m3:generate -- --answers examples/m3/interview.answers.example.json --out .runtime/m3-preview-test
  preview passed without writing files

npm run smoke:m3-config -> passed
  generated cluster=content-studio-demo
  config=.runtime/m3-config-smoke/cluster.config.json
  job=JOB-20260528-FA47F791
  terminalStatus=succeeded
  stageAgents=research-agent, writer-agent, image-agent
```

Notes:

```text
The first smoke attempt exposed the default Postgres 16 volume vs Postgres 17
image incompatibility. docker-compose.yml now uses a new postgres17-data volume
name, preserving the old PG16 volume without deleting user data.
```

Next ordered tasks:

```text
1. Completed: Stage 1.1 committed as c30f4d6.
2. Completed: Stage 1.2 / smoke:docker-compose committed as c5fee50.
3. Completed: M3 config generation vertical slice, committed as 4838a1f.
4. Current: OpenClaw real-mode E2E proof.
5. Then: Tauri shell initial proof.
```

## 2026-05-28 OpenClaw Real Mode And Tauri Shell Checkpoint

Task 5 is implemented to the current environment boundary.

OpenClaw real-mode changes:

```text
Added scripts/smoke-openclaw-real.ps1.
Added npm script: npm run smoke:openclaw-real.
Updated apps/dbos-worker/src/adapters/openclaw.ts:
  - OpenClaw external session ids are sanitized because OpenClaw rejects colons.
  - OpenClaw JSON extraction now reads payloads[0].text and finalAssistant* fields.
Updated packages/db/src/model-calls.ts and activities error handling:
  - model-call error text strips NUL bytes before PostgreSQL writes.
Updated tool.openclaw_agent_completed event payload to include mode.
```

Real-mode validation:

```text
Direct OpenClaw CLI probe:
  OpenClaw 2026.5.7 (eeef486)
  writer-agent direct call returned JSON.

First orchestrator real-mode attempt:
  job=JOB-20260528-2B3CB19D
  exposed two real bugs:
    1. OpenClaw rejects colon-containing session ids.
    2. WSL/OpenClaw error text can include NUL bytes that PostgreSQL rejects.
  Both bugs were fixed.

npm run smoke:openclaw-real -> passed
  job=JOB-20260528-C809526F
  terminalStatus=succeeded
  routingMode=classic_master_slave
  realCompletionEvents=1
  stageOutputArtifacts=1
```

Tauri shell changes:

```text
Added apps/desktop-app:
  package.json
  index.html
  tsconfig.json
  vite.config.ts
  src/api.ts
  src/main.tsx
  src/styles.css
  src-tauri/Cargo.toml
  src-tauri/build.rs
  src-tauri/src/main.rs
  src-tauri/tauri.conf.json
  README.md
Added scripts/smoke-tauri-shell.ps1.
Added npm script: npm run smoke:tauri-shell.
Updated README.md and SETUP.md with real-mode and Tauri shell instructions.
```

Tauri validation:

```text
npm run smoke:tauri-shell -> passed
  shell files present
  API client present
  Tauri config present
  Cargo manifest present
  rustToolchain=missing
  buildRunnable=false

Interpretation:
  Tauri shell scaffold is present and structurally valid. Full Tauri build was
  not run because this Windows host currently has no cargo/rustc installed.
```

Next ordered tasks after Task 5:

```text
1. Completed: Task 5 committed as 1c1b194 Prove real mode and scaffold desktop shell.
2. Add CI: npm run check + smoke:http-only + smoke:m3-config + smoke:tauri-shell.
3. Add INSTALL.md / SECURITY.md / LICENSE.
4. Add job timeline/inspect endpoint or CLI.
5. Add cancel job API.
6. Install Rust toolchain and run a real Tauri build.
```

## 2026-05-28 Product Direction Correction

The product goal is an open-source, downloadable multi-agent orchestration
platform built on top of OpenClaw. Users should be able to download it, start an
agent cluster, switch among four routing modes, generate configuration through
an interview-style flow, and eventually manage it through a Tauri desktop
console.

Important correction:

```text
tomorrow123.art / Feishu public webhook is not the product goal. It is the
author's private/reference deployment path for demos and self-use.

The code/doc work already added for public Feishu ingress is still useful as a
reference deployment example and smoke-test harness. However, manually
configuring VPS Nginx + frp for tomorrow123.art should not be treated as the
main product milestone.
```

Current product-level estimate:

```text
Orchestration kernel: ~80-90% skeleton complete.
Overall open-source downloadable product: ~25-30% complete.

Major gaps:
1. M3 configuration generation pipeline: interview -> role plan -> prompt
   generation -> preview gate -> injection.
2. Input adapter abstraction: Feishu should become one adapter, not the entry
   model.
3. OpenClaw real-mode end-to-end verification.
4. Docker Compose / one-command local install path.
5. Open-source readiness: LICENSE, CI, INSTALL, demo.
6. Tauri desktop console scaffold and later full UI.
```

Revised mainline direction:

```text
Primary product path:
1. Input-adapter abstraction + keep Feishu as first concrete adapter.
2. Docker Compose one-command local quickstart for Postgres + API + worker.
3. M3 configuration generation pipeline, initially as a backend/CLI vertical
   slice before the Tauri UI.
4. OpenClaw real-mode E2E proof.
5. Tauri desktop app scaffold and control surface.

Demoted/off-critical-path:
  tomorrow123.art VPS Nginx + frp + Feishu verify. Keep as private demo/reference
  deployment task only, useful when preparing a demo video or blog post.
```

Stage 0 product boundary decision recommendation after reviewing the Claude
discussion file:

```text
UI delivery:
  Choose option C: one React/TypeScript Web UI that can run in browser and can
  also be packaged inside a Tauri desktop shell. Tauri is the default end-user
  download experience, but the Web UI remains available for developers/server
  deployments.

Tauri backend startup:
  Choose option 3: phased approach. v1 Tauri is a thin client that connects to a
  local backend started by Docker Compose / one-click scripts; v2 can revisit an
  embedded sidecar. Do not switch away from Postgres/pglite/sqlite prematurely,
  because DBOS checkpointing and the current agent ledger are already built on
  PostgreSQL.

Confirmed platform boundary:
  docker compose default is HTTP-only; Feishu is an optional plugin/adapter.
  POST /jobs or an equivalent HTTP ingress remains the core always-on path.
```

Stage 0 closed by user on 2026-05-28:

```text
Decisions confirmed:
1. UI delivery uses option C: one React/TypeScript Web UI, also packaged by
   Tauri for default end-user desktop delivery.
2. Tauri backend startup uses option 3: v1 thin client + Docker Compose /
   one-click scripts; v2 may revisit embedded sidecar.
3. v1 keeps PostgreSQL. Do not switch to pglite/sqlite because DBOS checkpoint
   tables and the agent ledger depend on PostgreSQL behavior.
4. docker compose default is HTTP-only; Feishu is optional plugin/adapter.

Current implementation sequence:
1. Stage 1.1: IngressAdapter/EgressAdapter abstraction.
2. Stage 1.1 acceptance: HTTP-only smoke plus existing Feishu/M2 smokes pass.
3. Stage 1.2: Docker Compose quickstart after Feishu is decoupled.
```

## 2026-05-28 Public Feishu Ingress Status Checkpoint

Historical/private deployment note:

```text
This section records useful public Feishu ingress prep work, but it is no
longer the product mainline. Product mainline is the Stage 0 decision closure,
then InputAdapter abstraction, Docker Compose quickstart, and M3 config
generation. tomorrow123.art work is private demo/reference deployment.
```

ICP 备案已通过，公网 webhook 工作从“等待备案/DNS”切换到“配置
VPS Nginx + SSL + frp + 飞书后台 URL”的阶段。

Current status check:

```text
git status:
  ## master
   M CONTEXT.md

DNS:
  tomorrow123.art -> 49.232.90.172

HTTP/HTTPS:
  http://tomorrow123.art/health -> 308 Permanent Redirect
  https://tomorrow123.art/health -> 200 {"status":"ok"}
  https://tomorrow123.art/webhooks/feishu/events -> 404
```

Interpretation:

```text
1. DNS is correct and still points to the VPS.
2. HTTPS is alive on the VPS.
3. The current /health response is not the local orchestrator-api response
   (`orchestrator-api` returns {"ok":true}), so it is likely a VPS/Nginx
   health endpoint.
4. The Feishu webhook path is not yet proxied to local orchestrator-api/frp.
5. Do not configure Feishu backend as final until POST challenge on
   /webhooks/feishu/events reaches orchestrator-api and returns challenge.
```

Historical immediate work for private/reference deployment:

```text
1. Add public ingress docs and templates for VPS Nginx, frps/frpc, Feishu
   backend configuration, and mock-mode E2E checklist.
2. Add a public webhook smoke script that can verify challenge, invalid token,
   and optional fake message creation through the public URL.
3. Keep first private/reference deployment pass in OPENCLAW_AGENT_MODE=mock.
4. This no longer blocks product mainline work.
```

Work completed in this pass:

```text
Added docs/feishu-public-ingress.md.
Added config/public-ingress/nginx/tomorrow123.art.conf.example.
Added config/public-ingress/frp/frps.toml.example.
Added config/public-ingress/frp/frpc.toml.example.
Added config/public-ingress/systemd/frps-agent-openclaw.service.example.
Added config/public-ingress/systemd/frpc-agent-openclaw.service.example.
Added scripts/smoke-public-feishu-webhook.ps1.
Added npm script: npm run smoke:feishu-public.
Updated README.md and SETUP.md to point to the public ingress guide/templates.
```

Verification:

```text
npm run smoke:feishu-public
  result: failed at challenge check
  observed: challenge status expected 200, got 404

This is the expected current failure while
https://tomorrow123.art/webhooks/feishu/events is not yet proxied to the local
orchestrator-api through Nginx/frp.

npm run check
  passed

git diff --check
  passed; only Windows CRLF warnings were printed
```

Deployment attempt status:

```text
SSH network check:
  tomorrow123.art:22 reachable

SSH auth check:
  root@tomorrow123.art -> Permission denied (publickey,password)
  ubuntu@tomorrow123.art -> Permission denied (publickey,password)

Interpretation:
  The current Windows machine can reach the VPS SSH port, but has no configured
  non-interactive SSH key/login for the VPS. Codex cannot directly install frps
  or edit Nginx on the VPS from this environment until SSH access is provided
  or commands are run manually on the VPS.
```

Local/public-ingress preparation status:

```text
npm run smoke:feishu-webhook
  passed
  job=JOB-20260528-F9A66E71
  terminalStatus=succeeded

npm run prepare:public-ingress
  passed
  generated untracked deployment bundle under .runtime/public-ingress/
  generated frp token under .runtime/public-ingress/frp-token.txt
  generated VPS frps config, VPS Nginx config, local frpc config, and command
  helper files

npm run dev:stop
  passed

Restarted local dev stack for public E2E:
  OPENCLAW_AGENT_MODE=mock
  FEISHU_DRY_RUN=false
  npm run dev:start -> API http://localhost:3000

Local readiness:
  http://localhost:3000/health -> {"ok":true}
  POST http://localhost:3000/webhooks/feishu/events with .env
  FEISHU_VERIFICATION_TOKEN challenge -> passed
```

Current blocker:

```text
VPS work still needs to be performed manually or through valid SSH access:
1. install/start frps with .runtime/public-ingress/vps/etc/frp/agent-openclaw-frps.toml
2. start local frpc with .runtime/public-ingress/local/frpc/agent-openclaw-frpc.toml
3. update Nginx with .runtime/public-ingress/vps/nginx/tomorrow123.art.conf
4. nginx -t && reload
5. rerun npm run smoke:feishu-public; expected result after proxy is fixed:
   challenge 200, wrong token 401, optional synthetic message succeeded
```

Final sanity check after local preparation:

```text
npm run check -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
http://localhost:3000/health -> {"ok":true}
https://tomorrow123.art/webhooks/feishu/events -> 404 Not Found

Interpretation:
  Local orchestrator-api is ready in mock-mode public-E2E settings.
  The remaining gap is still VPS frps + Nginx routing to the local frpc tunnel.
```

## 2026-05-28 Project File Organization Checkpoint

Repository files were organized for long-term platform development and future
GitHub/open-source publishing.

Current top-level ownership:

```text
apps/                  API and DBOS worker platform source.
packages/              Shared DB and type packages.
scripts/               Dev/start/smoke/maintenance scripts.
platform-assets/       OpenClaw agent templates and manual vendor workarounds.
docs/                  Project structure, boundaries, agent setup notes, historical docs.
README.md              GitHub entry point and boundary summary.
SETUP.md               Local setup and smoke-test guide.
CONTEXT.md             Agent-facing project checkpoint.
```

Moved/created files:

```text
openclaw/ -> platform-assets/openclaw-agent-templates/
scripts/patch-openclaw-ark-media.ps1 -> platform-assets/vendor-workarounds/openclaw/patch-ark-media.ps1
OPENCLAW_AGENT_CREATION.md -> docs/openclaw-agent-creation.md
openclaw-feishu-temporal-agent-pipeline-plan.md -> docs/historical/openclaw-feishu-temporal-agent-pipeline-plan.md
README.md added
docs/PROJECT_STRUCTURE.md added
docs/BOUNDARIES.md added
```

Important boundary decision:

```text
OpenClaw/ClawPanel is an external runtime/product. Platform code must call it
through apps/dbos-worker/src/adapters/openclaw.ts and environment-configured
CLI paths. Prompt/config templates belong under platform-assets/. Manual vendor
workarounds are isolated under platform-assets/vendor-workarounds/ and must
not become the default downloadable-user install path.
```

Verification:

```text
commit=7a58f6b Organize platform project files
npm run check passed
git diff --check passed, with only CRLF warnings
old repo-local openclaw/agents and openclaw/config references cleared
git status clean after commit
```

## 2026-05-28 Tech Stack Confirmation and M3 Desktop Framework Decision

Tech stack confirmed:

```text
Backend  : Node.js + TypeScript（monorepo，npm workspaces）
Apps     : apps/orchestrator-api（HTTP API）, apps/dbos-worker（DBOS workflow engine）
Database : PostgreSQL — dbos.* checkpoint 表 + agent.* 业务账本
Frontend : v1 无 web 前端。飞书是人机界面层。
M3 app   : Tauri + React + TypeScript（桌面控制台 — 尚未开始）
```

M3 桌面框架决策：选 Tauri，不选 Electron。

```text
- Tauri 使用操作系统原生 WebView，打包体积约 5-15 MB；
  Electron 自带 Chromium，打包体积约 150-300 MB。
- 前端仍然是 React + TypeScript，团队无需学新技术。
- M3 桌面 app 只是配置 UI + 状态面板，业务逻辑在 orchestrator-api，
  桌面 app 通过 localhost HTTP 调用 API；Tauri Rust 主进程极简。
- Tauri 2.0 2026 年已稳定，新项目首选。
- Electron 的 Node.js 主进程优势在本项目不适用（后端独立运行，不内嵌）。
```

M3 monorepo 结构（尚未开始）：

```text
apps/desktop-app/     Tauri shell
  src/main/           Rust 主进程（极简）
  src/renderer/       React + TypeScript UI
```

## 2026-05-27 Feishu Webhook Readiness Checkpoint

Added local Feishu webhook smoke coverage before public HTTPS ingress:

```text
1. package.json:
   - npm run smoke:feishu-webhook
2. scripts/smoke-feishu-webhook.ps1:
   - starts dev stack with FEISHU_DRY_RUN=true and OPENCLAW_AGENT_MODE=mock
   - overrides FEISHU_VERIFICATION_TOKEN with a local smoke token
   - overrides FEISHU_BOT_OPEN_ID with a local bot open_id
   - verifies challenge
   - verifies invalid token -> 401 invalid_feishu_token
   - verifies non-message event ignored
   - verifies bot self-message ignored
   - verifies normal Feishu message creates one job and starts DBOS workflow
   - verifies duplicate message_id reuses the same job
   - waits for the created job to reach succeeded
3. SETUP.md:
   - documents npm run smoke:feishu-webhook
   - documents public ingress plan: Feishu -> VPS Nginx HTTPS -> frp -> local API
   - warns to expose only /webhooks/feishu/events publicly
   - notes first production pass should keep Feishu Encrypt Key disabled
```

Verification:

```text
npm run smoke:feishu-webhook
  passed

job=JOB-20260527-DD7634DD
duplicateJobId=JOB-20260527-DD7634DD
terminalStatus=succeeded
routingMode=supervisor_pipeline
maxModelCalls=20
classicFinalGateEnabled=false
discussionRounds=2
checked=challenge,wrong_token,non_message_ignored,bot_message_ignored,normal_message_created_job,duplicate_message_id_reused_job
```

Current next step: after this smoke delta is committed, prepare the public Feishu HTTPS ingress when ICP/DNS is ready.

## 2026-05-27 discussionRounds Persistence Checkpoint

Implemented and verified `discussionRounds` as persisted job configuration:

```text
1. packages/shared/src/types.ts:
   - DEFAULT_DISCUSSION_ROUNDS=2
   - JobRecord.discussionRounds
   - CreateJobInput.discussionRounds
2. packages/db/src/migrate.ts:
   - agent.jobs.discussion_rounds int not null default 2
3. packages/db/src/jobs.ts:
   - createJob persists discussion_rounds
   - toJobRecord returns discussionRounds
   - job.created event includes discussionRounds
4. apps/orchestrator-api/src/server.ts:
   - POST /jobs accepts discussionRounds int 1..10
   - POST /jobs and Feishu webhook responses include discussionRounds
5. apps/dbos-worker/src/activities.ts:
   - getJobDiscussionRounds DBOS step reads persisted value
   - emits discussion.round_count_selected
6. apps/dbos-worker/src/workflows.ts:
   - removed DISCUSSION_ROUND_COUNT constant
   - master_slave_discussion loop uses the checkpointed step value
7. scripts/smoke-m2-recovery.ps1:
   - discussion recovery case now sends discussionRounds=3
   - asserts persisted config and 3-round recovery counts
```

Verification:

```text
npm run check
  passed

git diff --check
  passed; only Git CRLF warnings printed

npm run smoke:m2-recovery
  passed

pipeline:
  job=JOB-20260527-260F9CAC
  result=succeeded
  attempts=3
  finalTestEvents=1

master_slave_discussion:
  job=JOB-20260527-3233B7D7
  requested/configured discussionRounds=3
  result=succeeded
  stages=2
  attempts=6
  discussionRounds=3
  discussionMessages=6
  synthesisArtifacts=1
  finalTestEvents=1
```

Current next step: Feishu public HTTPS webhook setup. The discussion round hard-code is no longer current truth.

## 2026-05-26 M2.5 Quality Gates And Budget Checkpoint

已完成非监督模式质量门和通用 model-call 预算上限：

```text
1. agent.jobs 新增 max_model_calls，默认 20。
2. agent.jobs 新增 classic_final_gate_enabled，默认 false。
3. POST /jobs 支持 maxModelCalls 和 classicFinalGateEnabled。
4. workflow 在每次 OpenClaw-backed 调用前运行 enforceModelCallBudget。
5. 预算耗尽时写 budget.model_calls_exhausted，job 进入 waiting_for_human。
6. pipeline 在所有 stage 完成后跑一次 final test-agent gate。
7. master_slave_discussion 在 main-agent synthesis 后跑一次 final test-agent gate。
8. classic_master_slave 默认不跑 final gate；classicFinalGateEnabled=true 时跑。
9. final gate 生成 test_report artifact，并写 final.test_completed 事件。
10. smoke:m2-recovery 已更新，恢复后也断言 finalTestEvents=1。
```

M2.5 本地验证结果：

```text
pipeline_final_gate:
  job=JOB-20260526-C3ACA6A8
  result=succeeded
  stages=3
  attempts=3
  modelCallRows=4
  finalTestEvents=1

discussion_final_gate:
  job=JOB-20260526-C42B17BD
  result=succeeded
  stages=2
  attempts=4
  modelCallRows=6
  synthesisArtifacts=1
  finalTestEvents=1

classic_default_no_gate:
  job=JOB-20260526-22329D8E
  result=succeeded
  modelCallRows=3
  finalTestEvents=0

classic_enabled_gate:
  job=JOB-20260526-FA995683
  result=succeeded
  modelCallRows=4
  finalTestEvents=1

budget_waiting:
  job=JOB-20260526-0EB0A046
  result=waiting_for_human
  maxModelCalls=1
  attempts=1
  modelCallRows=1
  budgetEvents=1
```

更新后的恢复脚本结果：

```text
npm run smoke:m2-recovery

pipeline:
  job=JOB-20260526-7045BD80
  result=succeeded
  attempts=3
  finalTestEvents=1

master_slave_discussion:
  job=JOB-20260526-0FC11103
  result=succeeded
  attempts=4
  discussionRounds=2
  synthesisArtifacts=1
  finalTestEvents=1
```

已更新：discussion_rounds 持久化配置已于 2026-05-27 完成；当前 discussion 轮次不再是 workflow 常量 2。

## 2026-05-26 M2 Hardening Checkpoint

本轮复核结论：用户指出的主要问题是对的。M2 主体能跑，但还需要补崩溃恢复
和 discussion 模式的 main-agent 收口。已完成以下加固：

```text
1. master_slave_discussion 现在新增 mainAgentSynthesizeDiscussion DBOS step。
2. 该 step 读取 agent_events 讨论账本、discussion.round_completed 事件和各轮 stage output artifact。
3. main-agent 通过 OpenClaw idempotent model_call 执行/复用 synthesis。
4. 生成 artifact：<jobId>-ART-DISCUSSION-SYNTHESIS，type=discussion_synthesis。
5. finalizeJob 会把 discussion synthesis 纳入 final output。
6. classic_master_slave 当前确认是串行执行，不是并行；并行留作后续单独验证。
7. model_calls 新增 failed_unknown_outcome 状态，人工确认后可解除 started 黑洞。
8. 新增受 ADMIN_API_TOKEN 保护的 admin unstick endpoint：
   POST /admin/model-calls/failed-unknown-outcome
9. 新增可重复恢复冒烟脚本：npm run smoke:m2-recovery
```

M2 崩溃恢复补测已通过，均使用 `FEISHU_DRY_RUN=true` 和
`OPENCLAW_AGENT_MODE=mock`：

```text
pipeline crash smoke:
  hook=after-runStageAgent-stage-002-attempt-01
  job=JOB-20260526-08CE74AE
  result=succeeded
  stages=3
  attempts=3
  reviews=0
  stageAgentRequested=3
  stageAgentCompleted=3
  stageAgentReused=0
  stage2OutputMessages=1

master_slave_discussion crash smoke:
  hook=after-runStageAgent-stage-002-attempt-01
  job=JOB-20260526-B720C1B2
  result=succeeded
  stages=2
  attempts=4
  reviews=0
  stageAgentRequested=4
  stageAgentCompleted=4
  stageAgentReused=0
  discussionRounds=2
  discussionMessages=4
  synthesisEvents=1
  synthesisArtifacts=1
```

非监督者模式质量门决策（先记录，M2.5 再实现）：

```text
pipeline：最终输出处加一道 test-agent 终检，不做每阶段检查。
classic_master_slave：main-agent 是主合成者，后续加可选 final test-agent gate。
master_slave_discussion：main-agent synthesis 必须做；synthesis 后加一道 final test-agent gate。
all modes：后续加总 attempts / model calls / 成本预算上限。
```

## 2026-05-26 M2 Routing Modes Checkpoint

已完成 DBOS 编排内核的四种 routing mode 策略层：

```text
pipeline
supervisor_pipeline
classic_master_slave
master_slave_discussion
```

默认模式是 `supervisor_pipeline`，也就是迁移前已经验证过的现行行为：
stage-agent 产出 -> test-agent 质量闸门 -> PASS 交给下一阶段 -> FAIL 回到原
stage-agent 修复 -> 连续 3 次失败进入 waiting_for_human。

M2 新增内容：

```text
1. agent.jobs 新增 routing_mode 字段。
2. POST /jobs 支持 routingMode 入参。
3. pipeline：顺序流水线，无 test-agent，每个阶段输出直接作为下一阶段输入。
4. classic_master_slave：main-agent 独立分发给各子 agent，子 agent 输出回 main-agent 汇总。
5. master_slave_discussion：固定 2 轮讨论，每轮所有子 agent 跑一次，写 discussion.round_completed。
6. group_messages/messageType 和 agent_events payload 会记录 routingMode、handoff target、message type。
```

本地四模式验证已通过，均使用 `FEISHU_DRY_RUN=true` 和 `OPENCLAW_AGENT_MODE=mock`：

```text
supervisor_pipeline     JOB-20260526-0BC974B1 succeeded stages=2 attempts=2 reviews=2 discussionRounds=0
pipeline                JOB-20260526-0848E07B succeeded stages=3 attempts=3 reviews=0 discussionRounds=0
classic_master_slave    JOB-20260526-7F4DB40F succeeded stages=3 attempts=3 reviews=0 discussionRounds=0
master_slave_discussion JOB-20260526-284C033C succeeded stages=2 attempts=4 reviews=0 discussionRounds=2
```

当前边界：M2 只落最小可运行策略。pipeline/classic/discussion 还没有质量闸门；
后续如果要把质量控制也加进去，需要明确每种模式下 test-agent 的位置和是否允许返工。

## 2026-05-25 DBOS Migration Checkpoint

当前编排内核已从 Temporal 切换到 DBOS：

```text
orchestrator-api
  -> DBOS JobPipelineWorkflow
  -> Postgres dbos.* checkpoint tables
  -> Postgres agent.* business ledger
  -> OpenClaw / Feishu adapters
```

已完成：

```text
1. 移除本地 dev stack 里的 Temporal Server / Temporal UI，只保留 Postgres。
2. apps/dbos-worker/src/workflows.ts 使用 DBOS.registerWorkflow 和 DBOS.registerStep。
3. apps/orchestrator-api/src/server.ts 使用 DBOS.startWorkflow 启动 job workflow。
4. 业务表继续保留在 agent schema，DBOS 只作为 durable execution layer。
5. 本地 POST /jobs 已验证成功：JOB-20260525-88AF3B8F -> succeeded。
6. DBOS 表已验证：dbos.workflow_status.status = SUCCESS，dbos.operation_outputs 记录了各 step checkpoint。
7. 验证时临时使用 FEISHU_DRY_RUN=true，没有发送真实飞书消息。
```

当前优先级：

```text
1. 继续验证崩溃恢复和幂等。
2. 再实现 4 种编排模式策略。
3. 最后回到飞书公网 HTTPS webhook。
```

## 2026-05-26 DBOS Recovery Verification

已完成 DBOS 崩溃恢复实测：

```text
测试 hook：DBOS_TEST_CRASH_ONCE_AFTER=after-runStageAgent-stage-001-attempt-01
测试 job：JOB-20260526-894EDEC2
崩溃点：第一阶段 runStageAgent step 完成并 checkpoint 后，进程退出。
崩溃后状态：agent.jobs.status=planning，dbos.workflow_status.status=PENDING。
崩溃后 DBOS checkpoint：operation_outputs 已有 markJobRunning / prepareJobWorkspace / createPipelinePlan / runStageAgent。
重启方式：移除 DBOS_TEST_CRASH_ONCE_AFTER，重新 npm run dev:start。
恢复结果：DBOS 日志显示 Recovering 1 workflows，job 最终 succeeded。
幂等结果：第一阶段 attempt 行数=1，stage.agent_started 事件=1，第一阶段输出消息行=1。
```

已补外部发送幂等保护：

```text
1. agent.group_messages upsert 不再把已有 feishu_message_id 覆盖成 null。
2. postGroupMessage 若发现同一逻辑消息已有 feishu_message_id，则跳过外部 Feishu send。
3. 本地 SQL probe 验证同 ID upsert 后 fake feishu_message_id 被保留。
```

## 2026-05-26 OpenClaw Idempotency Hardening

已补 OpenClaw 调用幂等：

```text
1. 新增 agent.model_calls 表。
2. idempotency_key = jobId + stageId + attemptNo + actionType。
3. runStageAgent / runTestAgent 都通过 model_calls 保护 OpenClaw 调用。
4. 如果已有 succeeded model_call，恢复时复用结果并写 tool.openclaw_agent_reused。
5. 如果只有 started 但没有完成结果，视为 ambiguous，不静默二次调用 OpenClaw。
```

已完成 step 中途崩溃实测：

```text
测试 hook：DBOS_TEST_CRASH_ONCE_AFTER=after-openclaw-stage-agent-stage-001-attempt-01
测试 job：JOB-20260526-18E997BA
崩溃点：第一阶段 OpenClaw 调用完成、model_calls 写入 succeeded 后，但 runStageAgent DBOS step 尚未 checkpoint。
崩溃后状态：dbos.workflow_status.status=PENDING，operation_outputs 只有 markJobRunning / prepareJobWorkspace / createPipelinePlan，没有 runStageAgent。
崩溃后业务状态：agent.model_calls 已有第一阶段 stage-agent succeeded 记录，stage_attempts 只有 1 行且仍 running。
重启恢复：job 最终 succeeded。
验证结果：第一阶段 stage-agent requested=1，completed=1，reused=1；model_calls=1；attempt rows=1；输出 group message=1。
```

注意：对同步外部 LLM 调用，若进程刚好崩在“OpenClaw 已返回但 model_calls 还没写入 succeeded”之前，仍无法绝对证明外部没有执行。当前策略是在本地记录存在且 completed 时复用；如果只有 started 无 completed，则阻止静默二次调用，交给人工/后续恢复策略处理。

保存时间：2026-05-25

## 当前目标

在飞书群内搭建一个多 Agent 流水线：

```text
用户在飞书群发任务
  -> main-agent 作为唯一入口、任务拆解者、调度者和最终汇报者
  -> 子 Agent 按阶段执行
  -> 子 Agent 完成后，编排服务把产物交给 test-agent 测试
  -> test-agent PASS 后，编排服务把 artifact 交给下一个子 Agent
  -> test-agent FAIL 后，编排服务把测试报告交回原子 Agent 返工
  -> 连续 FAIL 3 次后停止并等待用户决策
```

## 最新 Agent 清单

当前保留 6 个 Agent：

```text
main-agent
research-agent
writer-agent
image-agent
video-agent
test-agent
```

已删除/不再需要：

```text
planner-agent：任务拆解归 main-agent。
executor-agent：暂时不要通用执行角色，避免职责模糊。
copy-agent：文案职责归 writer-agent。
```

## Agent 职责

```text
main-agent：接收用户任务、拆解阶段、调度子 Agent、维护状态、最终汇总和汇报。
research-agent：根据任务搜索资料、事实、来源、背景、风险和约束。
writer-agent：写文案、文章、脚本、故事、标题、总结等文字产物。
image-agent：生成图片 brief、图片提示词，必要时调用图片生成工具产出图片。
video-agent：生成视频 brief、分镜、视频提示词，必要时调用视频生成工具产出视频。
test-agent：测试每个阶段输出，只测试，不修改业务产物。
```

## 当前技术栈

> ⚠️ 以下为历史记录（DBOS 迁移前，Temporal 时代）。**当前技术栈以顶部各里程碑 Checkpoint 为准**：Node.js + TypeScript 后端，PostgreSQL，DBOS 取代 Temporal，无 web 前端，M3 桌面 app 选 Tauri + React + TypeScript。

```text
Feishu group：真人任务入口和可见显示屏，不作为 agent-to-agent 控制总线。
OpenClaw：Agent runtime，默认 mock，可通过 OPENCLAW_AGENT_MODE=real 调 WSL OpenClaw CLI。
Temporal：无状态 Harness，负责任务排队、重试、暂停、恢复、等待人工决策。
Postgres：append-only Session ledger + 任务状态、阶段、attempt、artifact、测试报告、群消息记录。
Tool Gateway：OpenClaw/Feishu 等外部工具边界，密钥不进入 prompt。
orchestrator-api：HTTP 任务入口。
temporal-worker：执行 JobPipelineWorkflow。
```

## 已完成

```text
Docker Compose：Postgres + Temporal + Temporal UI
API：POST /jobs, POST /webhooks/feishu/events, GET /jobs/:jobId, GET /jobs/:jobId/details
Temporal workflow：JobPipelineWorkflow
DB migration：agent.jobs / agent_events / job_stages / stage_attempts / test_reviews / artifacts / group_messages / job_events
Mock pipeline：main-agent 动态规划 research/writer/image 阶段
测试逻辑：PASS 交给下一阶段，FAIL 退回原子 Agent，连续 3 次失败进入 waiting_for_human
OpenClaw prompt 模板：6 个 Agent
```

## 关键文件

```text
apps/orchestrator-api/src/server.ts
apps/temporal-worker/src/workflows.ts
apps/temporal-worker/src/activities.ts
packages/db/src/migrate.ts
packages/db/src/jobs.ts
packages/db/src/pipeline.ts
packages/shared/src/types.ts
platform-assets/openclaw-agent-templates/agents/main-agent.md
platform-assets/openclaw-agent-templates/agents/research-agent.md
platform-assets/openclaw-agent-templates/agents/writer-agent.md
platform-assets/openclaw-agent-templates/agents/image-agent.md
platform-assets/openclaw-agent-templates/agents/video-agent.md
platform-assets/openclaw-agent-templates/agents/test-agent.md
platform-assets/openclaw-agent-templates/config/openclaw.multi-agent.example.json
docs/openclaw-agent-creation.md
```

## OpenClaw Agent 状态

OpenClaw/ClawPanel 中当前保留 6 个真实 Agent：

```text
main-agent
research-agent
writer-agent
image-agent
video-agent
test-agent
```

当前已创建并配置：

```text
main-agent：OpenClaw 默认 main agent
writer-agent：model = deepseek-writer/deepseek-v4-pro
research-agent：model = deepseek-research/deepseek-v4-pro
video-agent：model = deepseek-writer/deepseek-v4-pro
image-agent：model = deepseek-writer/deepseek-v4-pro
test-agent：model = zai/glm-5.1
```

writer-agent 已从主 DeepSeek provider 独立出来，使用 `models.providers.deepseek-writer.apiKey`，不要和 main-agent 共用 `models.providers.deepseek.apiKey`。

video-agent 不能直接把 Seedance 当聊天模型使用；OpenClaw 当前配置为：

```text
video-agent 的思考/调度模型：deepseek-writer/deepseek-v4-pro
视频生成 provider：models.providers.byteplus
视频生成 endpoint/baseUrl：https://ark.cn-beijing.volces.com/api/v3
视频默认模型：agents.defaults.videoGenerationModel.primary = byteplus/doubao-seedance-2-0-260128
视频 fallback：byteplus/seedance-1-5-pro-251215, byteplus/seedance-1-0-pro-250528, byteplus/seedance-1-0-lite-t2v-250428
```

image-agent 使用图片生成 provider：

```text
image-agent 的思考/调度模型：deepseek-writer/deepseek-v4-pro
图片生成 provider：models.providers.openai
图片生成 endpoint/baseUrl：https://ark.cn-beijing.volces.com/api/v3
图片默认模型：agents.defaults.imageGenerationModel.primary = openai/doubao-seedream-5-0-260128
图片 API key 已写入本机 WSL 的 OpenClaw 配置，不要打印或写入文档。
```

注意：本机 WSL 的 OpenClaw openai 图片 provider 已加一个小兼容补丁：当 baseUrl 是火山方舟时自动发送 `response_format: b64_json`，否则 Ark 默认返回 URL，而当前 OpenClaw 解析器会误判为没有图片。

Seedance 2.0 视频生成是火山方舟的异步任务流程，标准版经常超过 OpenClaw BytePlus provider 原本硬编码的 120 秒默认超时。本机已把 BytePlus 视频 provider 默认超时补到 600000ms，并保留 `byteplus/doubao-seedance-2-0-fast-260128` 作为 fallback。以后升级 OpenClaw 后如补丁丢失，运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\platform-assets\vendor-workarounds\openclaw\patch-ark-media.ps1
```

test-agent 已接入智谱 GLM-5.1：

```text
provider：models.providers.zai
baseUrl：https://api.z.ai/api/paas/v4
model：zai/glm-5.1
API key：已写入本机 WSL 的 OpenClaw 配置，不要打印或写入文档。
```

research-agent 已接入独立 DeepSeek provider：

```text
provider：models.providers.deepseek-research
baseUrl：https://api.deepseek.com
model：deepseek-research/deepseek-v4-pro
API key：已写入本机 WSL 的 OpenClaw 配置，不要打印或写入文档。
```

WSL 常驻修复：

```text
已执行：loginctl enable-linger administrator
已创建 Windows 计划任务：OpenClaw WSL Keepalive
作用：登录 Windows 后启动 Ubuntu-24.04，并保持 WSL 常驻，让 openclaw-gateway.service 不随 WSL session 退出而停止。
```

注意：真实 OpenClaw 安装在 WSL：

```text
/home/administrator/.openclaw
```

Windows ClawPanel 配置在：

```text
C:\Users\Administrator\ClawPanel
```

ClawPanel 指向 WSL OpenClaw 路径：

```text
\\wsl.localhost\Ubuntu-24.04\home\administrator\.openclaw
```

创建完成后继续：

```text
1. OpenClaw adapter 已确认使用 `openclaw agent --agent <id> --session-id <id> --message <prompt> --json`。
2. worker 默认 `OPENCLAW_AGENT_MODE=mock`；设置为 `real` 后调用 WSL OpenClaw CLI。
3. Feishu adapter 已接入 `im/v1/messages`，未配置凭证时 dry-run 并完整落库。
4. Postgres `agent_events` 是 append-only session ledger，Temporal + Postgres 作为状态权威。
5. 任务 session 结束后归档并设置保留期；经验库是长期记忆，不随任务清理。
```

## 2026-05-23 Prompt Draft Decisions

用户提供并正在整理的顶层 prompt 草稿目录：

```text
C:\Users\Administrator\Desktop\agent集群提示词 (1)
```

当前顶层草稿文件：

```text
main-agent-prompt.md
research-agent-prompt.md
writer-agent-prompt.md
image-agent-prompt.md
video-agent-prompt.md
test-agent-prompt.md
多智能体工作流程.md
multi-agent-machine-contract.json
```

已确认并写入顶层草稿：

```text
1. agent 命名统一为 writer-agent 和 test-agent，不再用 writing-agent / content-tester。
2. 同一阶段连续 3 次 FAIL 后停止并等待人工决策，不强制通过、不低质量通过。
3. test-agent-prompt.md 现在是测试 agent prompt；旧的中文文件名测试 prompt 已不再作为当前顶层草稿。
4. 子 agent 需要写 agent-work-log.md，提炼 3-5 条阶段工作摘要；main-agent 只传路径，不读正文。
5. 子 agent / test-agent 需要写 state/*.json，机器可读契约见 multi-agent-machine-contract.json。
6. test-agent 读取子 agent 工作摘要用于质检；最后一个阶段 PASS 后，test-agent 读取所有工作摘要并生成 final-summary.md / final-summary.json，main-agent 只转发最终汇总。
7. research-agent 必须对关键事实、数据、结论、时间线做至少两个可靠来源交叉验证；单一来源必须标注风险。
```

框架讨论后已决定并落地：

```text
1. Claude 风格 Agent(...)/resume/~/.claude/projects 已从顶层 prompt 草稿改写为 OpenClaw + Temporal + Postgres 调度语义。
2. 采用“飞书群只是显示屏，真实对话流程全部在编排服务里跑”的架构；群消息可用 `@下一个agent` 开头给用户看，但不依赖飞书 @ 触发 agent 接力。
3. 新增 Feishu webhook：POST /webhooks/feishu/events，支持 challenge、消息创建 job、message_id 去重，并可通过 `FEISHU_BOT_OPEN_ID` 忽略机器人自身消息。
4. 新增 Feishu adapter：配置单个 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_DEFAULT_CHAT_ID` 后发送真实群消息；未配置或 `FEISHU_DRY_RUN=true` 时 dry-run。
5. 新增 OpenClaw adapter：默认 mock，OPENCLAW_AGENT_MODE=real 时调 WSL OpenClaw CLI。
6. 已本地验证：正常任务 succeeded；首次失败后修复 succeeded；连续 3 次失败进入 waiting_for_human；Feishu webhook 创建 job 与重复消息去重通过；agent_events seq 连续。
7. 最新生命周期改进：jobs 新增 completed_at / archived_at / retention_until / cleanup_status / retention_policy；finalizeJob 后调用 archiveJobSession；新增 `npm run maintenance:cleanup-sessions` dry-run 清理预览脚本。
8. 生命周期验证 job：`JOB-20260523-207A9AE8`，结果 `succeeded`，`cleanupStatus=retained`，`archivedAt` 已写入，`retentionUntil=2026-06-22T13:14:48.415Z`，`job.archived` 事件数量 1。
9. 严格显示屏改进修正：不需要 6 个飞书应用；`senderAgentId` 只作为本地逻辑发送者落库，不决定飞书应用身份。群里 `@test-agent` / `@image-agent` 是展示文本。
10. 单飞书机器人显示屏验证 job：`JOB-20260523-0692993C`，结果 `succeeded`，阶段顺序为 `writer-agent -> image-agent`，群消息首行为 `@main-agent` / `@test-agent` / `@image-agent` 展示文本。
```

注意：顶层 prompt 草稿已更新桌面文件；真实 WSL OpenClaw agent 的 AGENTS.md 是否同步写入，需要在用户确认 prompt 定稿后执行。

## 2026-05-23 Context Capsule

已按用户“保存上下文”要求生成详细本地交接文件：

```text
D:\聊天记录\Codex\context-vault\agent-openclaw\20260523-084430-agent-openclaw-managed-runtime.md
```

该 capsule 记录了：

```text
1. Feishu + OpenClaw + Temporal + Postgres 的 Managed Agents 架构决策。
2. Postgres agent_events append-only session ledger 的实现位置。
3. Feishu webhook / Feishu adapter / OpenClaw adapter 的实现位置。
4. 本地端到端验证结果和 job id。
5. 下一步真实飞书群配置项。
6. 安全注意事项：不要保存或打印 API key。
```

## 2026-05-25 Latest Checkpoint

用户再次要求“保存上下文”。本次最新状态：

```text
1. 架构继续保持：飞书群只是显示屏；真正 agent-to-agent 流程全部在本地编排服务 Temporal + Postgres 中推进。
2. 已明确取消“多个飞书 app 分别代表多个 agent”的方案。当前只需要一个飞书自建应用/机器人。
3. `senderAgentId` / `mentionAgentId` 仍保留在本地数据库和 group_messages 中，用于记录逻辑发送者和逻辑目标；它们不决定飞书应用身份。
4. 群消息仍可用 `@main-agent` / `@test-agent` / `@image-agent` 这种开头，但这是给用户看的展示文本，不是飞书事件触发机制。
5. 用户提供的飞书 app 凭证、verification token 已写入 `.env`；不要在任何上下文、文档或最终答复中回显明文 secret/token。
6. 已通过飞书 API 找到机器人所在群 `chat_id`，并写入 `.env`；已找到 bot open_id 并写入 `.env`，用于过滤机器人自身回调。
7. 已真实验证单飞书机器人能向群里发消息：job `JOB-20260523-38B84C60` succeeded，4 条 group message 全部 delivered。
8. 域名 `tomorrow123.art` 已解析到 VPS `49.232.90.172`，22/80/443 当时都可连通。
9. `http://tomorrow123.art/health` 当时返回腾讯云备案/网站无法访问页面；`https://tomorrow123.art/health` 当时不能正常访问。直接把该域名填给飞书 webhook 还不可用。
10. 推荐下一步：用固定域名做公网 HTTPS 回调入口。可选路径 A：Cloudflare Tunnel 绑定固定子域名并转发到本地 `localhost:3000`；路径 B：把整套服务部署到 VPS 并处理 Nginx/HTTPS/备案问题。
11. 本次保存时，本地 `http://localhost:3000/health` 无法连接，Docker Desktop API 也无法连接。恢复工作时先启动 Docker Desktop，再运行 `npm run dev:start`。
```

当前敏感配置原则：

```text
.env 里已有 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_VERIFICATION_TOKEN / FEISHU_DEFAULT_CHAT_ID / FEISHU_BOT_OPEN_ID / FEISHU_DRY_RUN=false。
保存上下文只记录“已配置”，不得保存明文密钥。
```
