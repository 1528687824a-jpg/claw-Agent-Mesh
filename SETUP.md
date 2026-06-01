# Agent OpenClaw Setup Notes

## Repository Structure

The project is organized as a monorepo for future GitHub/open-source work:

```text
apps/              Runtime services: API and DBOS worker.
packages/          Shared DB and type packages.
scripts/           Local dev and smoke-test scripts.
platform-assets/   OpenClaw agent templates and manual vendor workarounds.
docs/              Structure, boundaries, agent setup notes, historical docs.
```

OpenClaw/ClawPanel is an external runtime. Platform code should call it through
the adapter boundary, not by editing OpenClaw product source. See:

```text
docs/PROJECT_STRUCTURE.md
docs/BOUNDARIES.md
```

## Current Runtime

The local orchestration kernel is now:

```text
orchestrator-api
  -> DBOS workflow library
  -> Postgres
  -> OpenClaw adapter
  -> HTTP core ingress/egress
  -> optional Feishu ingress/egress adapter
```

Temporal Server and Temporal UI are no longer part of the local dev stack.
DBOS stores durable workflow state in Postgres under the `dbos` schema.
Business state still lives in the `agent` schema.

## Node Runtime

Package engines are pinned to:

```text
node ^20.19.0 || >=22.12.0
npm >=10
```

This follows the installed Vite 7 engine floor while allowing the current local
Node 24 toolchain. CI currently uses Node 22.

## Local Services

For the open-source quickstart path, start the full HTTP-only stack:

```powershell
docker compose up --build
```

This starts:

```text
postgres
orchestrator-api  http://localhost:3000
dbos-worker       optional recovery worker
```

Default Docker Compose mode:

```text
FEISHU_ADAPTER_ENABLED=false
FEISHU_DRY_RUN=true
OPENCLAW_AGENT_MODE=mock
```

Create a demo job:

```powershell
$body = @{ prompt = 'demo multi-agent job'; requesterId = 'quickstart' } | ConvertTo-Json
$job = Invoke-RestMethod -Uri 'http://localhost:3000/jobs' -Method Post -ContentType 'application/json' -Body $body
Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($job.jobId)"
Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($job.jobId)/messages"
Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($job.jobId)/timeline"
Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($job.jobId)/timeline?since=2026-05-31T00%3A00%3A00.000Z"
```

Stop the quickstart stack:

```powershell
docker compose down
```

The Postgres 17 and job-data volumes are persistent. Use `docker compose down -v`
only when you intentionally want to delete local state.

Repeatable Docker quickstart smoke:

```powershell
npm run smoke:docker-compose
```

The smoke starts the full Compose stack, creates a job through `POST /jobs`,
polls it to `succeeded`, reads `GET /jobs/:jobId/messages`, restarts the stack,
and verifies the job is still present.

## Smoke Script Rules

Run smoke scripts sequentially unless a script explicitly documents an isolated
runtime. Several smokes start or stop the local dev stack through
`npm run dev:start` / `npm run dev:stop`, share Postgres, and bind the same API
port. Parallel runs can race migrations, kill each other's API process, or mix
job polling across runs.

Recommended order for a broad local pass:

```powershell
npm run check
npm run check:no-secrets
npm run smoke:http-only
npm run smoke:m3-config
npm run smoke:m3-real-planner
npm run smoke:m3-real-provider
npm run smoke:cancel-job
npm run smoke:timeline-since
npm run smoke:list-jobs
npm run smoke:repair-cancelled-archives
npm run smoke:desktop-ui
npm run smoke:desktop-ui-prod
npm run smoke:tauri-shell
npm run smoke:m2-recovery
```

GitHub Actions runs the CI-safe subset:

```text
Windows:
  npm run check
  npm run check:no-secrets
  npm run smoke:m3-real-planner
  npm run smoke:tauri-shell

Ubuntu:
  docker compose up -d --build
  POST /jobs -> poll succeeded -> GET /jobs/:id/messages
```

`npm run smoke:docker-compose` uses an isolated Compose project and can be run
as a separate quickstart proof. `npm run smoke:feishu-public` is an optional
self-hosting reference check for a user-owned Feishu public webhook path, not a
product gate.

Shared dev-stack smoke locks live under `.runtime/locks`. The PowerShell wrapper
and desktop UI smoke write lock owner metadata and remove stale lock files when
the recorded process is no longer alive.

## M3 Config Generation Smoke

M3 begins as a backend/CLI vertical slice. It does not require the Tauri UI.

Preview a generated cluster from structured interview answers:

```powershell
npm run m3:generate -- --answers examples/m3/interview.answers.example.json --out .runtime/m3-preview
```

Approve and write the cluster config plus agent prompts:

```powershell
npm run m3:generate -- --answers examples/m3/interview.answers.example.json --out .runtime/m3-content-studio --approve
```

Generated output:

```text
cluster.config.json
preview.md
agents/main-agent/AGENTS.md
agents/research-agent/AGENTS.md
agents/writer-agent/AGENTS.md
agents/image-agent/AGENTS.md
agents/test-agent/AGENTS.md
```

Inject a generated cluster into the orchestrator:

```powershell
$env:AGENT_CLUSTER_CONFIG_PATH = '.runtime/m3-content-studio/cluster.config.json'
npm run dev:start
```

Repeatable M3 smoke:

```powershell
npm run smoke:m3-config
```

The smoke generates a content-studio cluster, starts the API with
`AGENT_CLUSTER_CONFIG_PATH`, posts a demo job, and verifies the DBOS planning
step uses the generated `research-agent -> writer-agent -> image-agent` stages.

Optional real planner path:

```powershell
$env:M3_PLANNER_MODE = 'openai-compatible'
$env:M3_PLANNER_BASE_URL = 'https://api.example.com/v1'
$env:M3_PLANNER_MODEL = '<planner-model>'
$env:M3_PLANNER_API_KEY = '<secret>'
npm run m3:generate -- --answers examples/m3/interview.answers.example.json --out .runtime/m3-real-preview --approve
```

The provider must expose an OpenAI-compatible `/chat/completions` endpoint.
Never commit planner API keys. To validate the real-planner plumbing without a
network provider or secret:

```powershell
npm run smoke:m3-real-planner
```

The smoke starts a local fake chat-completions provider and verifies that
`m3:generate` calls it, parses the returned JSON plan, records planner metadata,
and writes a generated stage order selected by the planner.

To run a real provider end-to-end, set the M3 planner variables in the shell or
local `.env`, then run:

```powershell
npm run smoke:m3-real-provider
```

This smoke calls the configured real planner, writes a generated
`cluster.config.json`, starts the orchestrator with that config in mock
OpenClaw mode, posts a demo job, and verifies DBOS executed the generated stage
sequence. It fails fast when required provider variables are missing and does
not print secret values. Known real-planner failure modes are tracked in:

```text
docs/m3-real-planner-known-issues.md
```

## OpenClaw Real Mode Smoke

Run a minimal real OpenClaw job through the orchestrator:

```powershell
npm run smoke:openclaw-real
```

The smoke uses WSL `Ubuntu-24.04`, the configured OpenClaw CLI, HTTP-only
egress, and `classic_master_slave` without final test gate so the proof has one
real writer-agent call.

## Tauri Desktop Shell

The first desktop shell lives in:

```text
apps/desktop-app
```

It is a thin React/TypeScript client for the local HTTP API. Validate the shell
structure and local Rust toolchain status with:

```powershell
npm run smoke:tauri-shell
```

Full Tauri builds require Rust/Cargo on the host:

```powershell
docker compose up --build
npm install --prefix apps/desktop-app
npm --prefix apps/desktop-app run tauri:dev
```

The current thin-client UI consumes:

```text
GET /jobs
GET /jobs?prompt=<text>&status=<status>&ingressOrigin=<origin>&sort=createdAt&order=desc&cursor=<cursor>
POST /jobs
GET /jobs/:jobId/timeline
GET /jobs/:jobId/timeline?since=<ISO timestamp>&limit=<n>
GET /jobs/:jobId/timeline?cursor=<cursor>&limit=<n>
POST /jobs/:jobId/cancel
```

The Jobs pane exposes the common list controls directly: All, Running, Waiting,
Cancelled, prompt search, and created-at time windows (All Time, 24h, 7d, or
custom since/until). Sort/order remain API-level controls for now.

Job listing supports cursor pagination and lightweight filters:

```text
limit         1..200
status        created|queued|planning|running|testing|fixing|waiting_for_human|succeeded|failed|cancelled
ingressOrigin http|feishu|slack|cli
prompt        substring search over rawPrompt
since/until   createdAt inclusive ISO timestamp window
sort          createdAt|updatedAt
order         asc|desc
cursor        opaque page.nextCursor from the previous response
```

The response keeps the old `jobs` array and adds:

```text
page.limit
page.returned
page.hasMore
page.nextCursor
page.sort
page.order
page.filters
```

The cursor is a composite `(sort timestamp, job id)` key so jobs with the same
timestamp do not fall between pages.

Timeline pagination is incremental when `since` or `cursor` is present.
`since` is retained for compatibility and returns events strictly after that ISO
timestamp. New clients should prefer the per-item opaque `cursor`, because it
uses the exact timeline item identity and does not skip events that share the
same timestamp. The desktop UI now uses `summary.nextCursor` for same-job
timeline refreshes and appends new items instead of reloading the full timeline.
The response summary includes `matchedTimelineItems`, `hasMore`, `nextSince`,
and `nextCursor` so clients can keep polling without reloading the full
timeline.

Browser UI integration smoke:

```powershell
npm run smoke:desktop-ui
npm run smoke:desktop-ui-prod
```

This starts the local mock-mode API, starts or reuses the Vite desktop UI,
opens it in a headless Edge/Chrome browser through DevTools, creates a job from
the UI, cancels it from the UI, verifies search/status/time-window filters,
verifies a timeline cursor request was used, verifies the timeline render, and
writes a screenshot under `.runtime/desktop-ui-smoke/`.

`smoke:desktop-ui-prod` first runs the production Vite build, serves
`apps/desktop-app/dist` on `http://127.0.0.1:5174`, and repeats the same browser
flow so dev-server and production-bundle behavior cannot drift silently.

For CI or docker-compose environments where the API is already running:

```powershell
$env:DESKTOP_UI_SMOKE_PORT = '5173'
npm run smoke:desktop-ui-prod -- --skip-api-start
```

## Local Development Services

Start Postgres, run migrations, and launch the API:

```powershell
npm run dev:start
```

Stop the API and Docker Compose services:

```powershell
npm run dev:stop
```

Service URLs:

```text
API: http://localhost:3000
Postgres: localhost:5432
```

Development database defaults:

```text
DATABASE_URL=postgresql://temporal:temporal@localhost:5432/temporal
DBOS_SYSTEM_DATABASE_SCHEMA=dbos
```

The username/database name are historical local defaults from the previous
Temporal setup. They are not used to run Temporal anymore.

## Manual Commands

Install dependencies:

```powershell
npm install
```

Run business-table migrations:

```powershell
npm run db:migrate
```

Start only the API:

```powershell
npm run dev:api
```

Start the optional DBOS recovery worker:

```powershell
npm run dev:worker
```

The normal local path does not need a separate worker. The API process calls
`DBOS.launch()` and starts/recover workflows itself.

## Local POST /jobs Check

Use dry-run Feishu mode for local verification unless you intentionally want
real group messages:

```powershell
$env:FEISHU_DRY_RUN='true'
npm run dev:api
```

Create a local job:

```powershell
$body = @{
  rawPrompt = 'research current AI trends, write a short article, and create an image poster brief'
  routingMode = 'supervisor_pipeline'
  maxModelCalls = 20
  classicFinalGateEnabled = $false
  discussionRounds = 2
  requesterId = 'local-test-user'
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri 'http://localhost:3000/jobs' -Method Post -ContentType 'application/json' -Body $body
$response
Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($response.jobId)"
Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($response.jobId)/messages"
Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($response.jobId)/details"
```

Expected behavior:

```text
POST /jobs
  -> creates agent.jobs row
  -> starts DBOS JobPipelineWorkflow
  -> main-agent creates stages
  -> child agent writes an artifact and creates a visible group update
  -> test-agent PASS advances to the next stage
  -> test-agent FAIL routes back to the previous child agent
  -> after 3 consecutive FAILs, the job enters waiting_for_human
```

## Routing Modes

`POST /jobs` accepts an optional `routingMode`. If omitted, the default is
`supervisor_pipeline`.

```text
pipeline
supervisor_pipeline
classic_master_slave
master_slave_discussion
```

Current M2 semantics:

```text
supervisor_pipeline:
  Existing behavior. Each stage runs, test-agent reviews it, PASS hands off to
  the next stage, retryable FAIL goes back to the same child agent, and 3 FAILs
  enters waiting_for_human.

pipeline:
  Sequential child-agent stages without the test-agent gate. Each completed
  stage output becomes the next stage input. M2.5 adds one final-only
  test-agent quality gate before finalizeJob.

classic_master_slave:
  main-agent dispatches each child stage independently and collects outputs.
  There is no peer-to-peer handoff. M2.5 supports an optional final test-agent
  gate through the persisted classicFinalGateEnabled job flag. It defaults to
  false.

master_slave_discussion:
  Child agents run in a persisted discussion loop controlled by
  agent.jobs.discussion_rounds / POST /jobs discussionRounds. The default is
  2 rounds. Each round writes visible discussion_handoff messages and
  discussion.round_completed events.
  After the rounds finish, main-agent runs a dedicated
  mainAgentSynthesizeDiscussion step over the agent_events ledger and stage
  output artifacts. M2.5 then runs one final test-agent gate over the synthesis
  artifact before finalizeJob includes it in the final output.
```

Additional job controls:

```text
maxModelCalls:
  Persisted model-call budget. Default: 20. The workflow checks this before
  each OpenClaw-backed call. If exhausted, the job enters waiting_for_human.

classicFinalGateEnabled:
  Optional final test-agent gate for classic_master_slave. Default: false.

discussionRounds:
  Persisted round count for master_slave_discussion. Default: 2. POST /jobs
  accepts integer values from 1 through 10. The workflow reads it through a
  checkpointed DBOS step before entering the discussion loop.
```

## M2 Recovery Smoke Checks

These were run locally with:

```powershell
$env:FEISHU_DRY_RUN='true'
$env:OPENCLAW_AGENT_MODE='mock'
$env:DBOS_TEST_CRASH_ONCE_AFTER='after-runStageAgent-stage-002-attempt-01'
```

Pipeline recovery check:

```text
jobId=JOB-20260526-08CE74AE
crash point=after stage 2 runStageAgent checkpoint
result=succeeded
stages=3
attempts=3
reviews=0
stageAgentRequested=3
stageAgentCompleted=3
stageAgentReused=0
stage2OutputMessages=1
finalTestEvents=1
```

Discussion recovery check:

```text
jobId=JOB-20260526-B720C1B2
crash point=after round 1 stage 2 runStageAgent checkpoint
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
finalTestEvents=1
```

Latest repeatable script run after discussionRounds persistence:

```text
jobId=JOB-20260527-3233B7D7
discussionRounds request/config=3
result=succeeded
stages=2
attempts=6
stageAgentRequested=6
stageAgentCompleted=6
stageAgentReused=0
discussionRounds=3
discussionMessages=6
synthesisArtifacts=1
finalTestEvents=1
```

Repeat both recovery checks with:

```powershell
npm run smoke:m2-recovery
```

The script restarts the local dev API with the crash hook enabled, creates one
`pipeline` job and one `master_slave_discussion` job. The discussion job sends
`discussionRounds=3`, verifies that the API actually crashed, restarts without
the hook, then asserts the recovered counts and persisted round config.

## HTTP-Only Product Smoke

The core product ingress is HTTP and must work without Feishu credentials:

```powershell
npm run smoke:http-only
```

The script starts the local dev stack with:

```text
FEISHU_ADAPTER_ENABLED=false
FEISHU_DRY_RUN=true
OPENCLAW_AGENT_MODE=mock
```

It verifies:

```text
1. POST /jobs creates an HTTP-origin job.
2. The job reaches succeeded in mock mode.
3. GET /jobs/:jobId/messages returns the visible message chain.
4. GET /jobs/:jobId/timeline returns a UI-friendly inspection timeline.
5. No Feishu message id is attached to the HTTP-only job.
```

## List Jobs Smoke

Validate job list filters, ordering, and cursor pagination:

```powershell
npm run smoke:list-jobs
```

The smoke creates four marked HTTP-origin jobs, cancels one, then verifies:

```text
1. prompt search isolates the marked jobs;
2. createdAt asc/desc ordering is stable;
3. cursor page 1 and page 2 preserve order without duplicates;
4. status=cancelled returns only the cancelled probe;
5. ingressOrigin=http returns all marked jobs;
6. since/until filters apply to the createdAt window;
7. malformed cursors return 400;
8. prompt search is case-insensitive for English input;
9. prompt search matches Chinese input.
```

## Cancel Job Smoke

Cancellation semantics are documented in:

```text
docs/job-cancellation-semantics.md
```

Cancel a non-terminal job through the HTTP API:

```powershell
npm run smoke:cancel-job
```

The smoke creates a budget-limited job that reaches `waiting_for_human`, calls:

```text
POST /jobs/:jobId/cancel
```

and verifies:

```text
1. the job status becomes cancelled;
2. repeating cancel is idempotent;
3. the cancelled session is archived/retained;
4. GET /jobs/:jobId/timeline includes job.cancelled and job.archived.
```

## Timeline Since Smoke

Validate incremental timeline pagination:

```powershell
npm run smoke:timeline-since
```

The smoke creates a mock job, reads its full timeline, chooses a midpoint
timestamp, then calls:

```text
GET /jobs/:jobId/timeline?since=<ISO timestamp>&limit=<n>
```

and verifies:

```text
1. all returned items are strictly after the cursor timestamp;
2. returned order matches the full timeline order;
3. limit=2 returns the first two matching events, not the latest two;
4. per-item cursor pagination preserves same-timestamp events;
5. malformed timeline cursors return 400;
6. summary.hasMore, summary.truncated, summary.nextSince, and summary.nextCursor are correct.
```

M2.5 local quality/budget checks:

```text
pipeline_final_gate        JOB-20260526-C3ACA6A8 succeeded modelCallRows=4 finalTestEvents=1
discussion_final_gate      JOB-20260526-C42B17BD succeeded modelCallRows=6 finalTestEvents=1 synthesisArtifacts=1
classic_default_no_gate    JOB-20260526-22329D8E succeeded modelCallRows=3 finalTestEvents=0
classic_enabled_gate       JOB-20260526-FA995683 succeeded modelCallRows=4 finalTestEvents=1
budget_waiting             JOB-20260526-0EB0A046 waiting_for_human maxModelCalls=1 budgetEvents=1
```

## DBOS Checkpoints

DBOS system state is stored in Postgres:

```text
dbos.workflow_status
dbos.operation_outputs
```

`workflow_status` stores workflow identity/status/input/output. `operation_outputs`
stores completed step outputs, so recovery can skip finished steps after a crash.

## OpenClaw Idempotency

OpenClaw calls are guarded by business-table idempotency records:

```text
agent.model_calls
idempotency_key = jobId + stageId + attemptNo + actionType
```

If recovery reruns a step after an OpenClaw call already succeeded, the step
reuses the stored model-call result and records `tool.openclaw_agent_reused`
instead of calling OpenClaw again.

If a prior call is only `started` and has no completed result, the workflow
throws instead of silently making a second ambiguous external call.

If an operator confirms that a `started` call has an unknown external outcome,
mark it explicitly as `failed_unknown_outcome`. That state is allowed to be
restarted by `markModelCallStarted`, while plain `started` remains blocked.

Admin API unstick path:

```text
POST /admin/model-calls/failed-unknown-outcome
Header: x-admin-token: <ADMIN_API_TOKEN>
Body:
{
  "jobId": "JOB-...",
  "idempotencyKey": "JOB-...:JOB-...-STAGE-001:1:stage-agent",
  "reason": "operator confirmed the original call outcome is unknown",
  "restartWorkflow": true
}
```

The endpoint is disabled unless `ADMIN_API_TOKEN` is set. When enabled, it
marks the started model call as `failed_unknown_outcome` and, by default,
starts a replacement DBOS workflow id for the same job.

SQL-only fallback:

```sql
update agent.model_calls
set status = 'failed_unknown_outcome',
    error = 'failed_unknown_outcome: operator confirmed the original call outcome is unknown',
    updated_at = now()
where idempotency_key = '<idempotency-key>'
  and status = 'started';
```

## Crash Recovery Test Hook

The workflow includes test-only crash hooks. They are disabled unless this
environment variable is set.

Crash after a whole `runStageAgent` step has checkpointed:

```text
DBOS_TEST_CRASH_ONCE_AFTER=after-runStageAgent-stage-001-attempt-01
```

Crash inside the `runStageAgent` step after OpenClaw result is recorded but
before DBOS can checkpoint the step:

```text
DBOS_TEST_CRASH_ONCE_AFTER=after-openclaw-stage-agent-stage-001-attempt-01
```

Restart the API without the variable set. The first hook should skip the
completed step; the second hook should rerun the step but reuse the
`agent.model_calls` record instead of calling OpenClaw again.

## Optional Feishu Webhook

Feishu is an optional ingress/egress adapter and visible display screen. Real
agent-to-agent handoff is controlled locally by DBOS/Postgres, not by Feishu
mentions. The core HTTP product path does not require Feishu credentials.

```text
POST http://localhost:3000/webhooks/feishu/events
```

Local webhook smoke:

```powershell
npm run smoke:feishu-webhook
```

The script starts the local dev stack with safe overrides:

```text
FEISHU_DRY_RUN=true
OPENCLAW_AGENT_MODE=mock
FEISHU_VERIFICATION_TOKEN=local-feishu-webhook-smoke-token
FEISHU_BOT_OPEN_ID=ou_local_webhook_smoke_bot
```

It verifies:

```text
1. Feishu challenge returns the challenge value.
2. Invalid verification token returns 401 invalid_feishu_token.
3. Non-message events are ignored.
4. Bot self messages are ignored.
5. A normal message creates one job and starts the DBOS workflow.
6. Repeating the same message_id returns duplicate=true and reuses the job.
7. The created job reaches succeeded in mock mode.
```

Latest local smoke result:

```text
npm run smoke:feishu-webhook
jobId=JOB-20260527-DD7634DD
duplicateJobId=JOB-20260527-DD7634DD
terminalStatus=succeeded
routingMode=supervisor_pipeline
maxModelCalls=20
classicFinalGateEnabled=false
discussionRounds=2
```

Public HTTPS webhook setup is an optional self-hosting adapter path, not the
main quickstart. First production pass should keep Feishu event encryption
disabled and rely on the verification token. If Encrypt Key is enabled in
Feishu later, add decrypt/signature handling before turning it on.

Recommended public ingress shape for a user-owned domain:

```text
Feishu
  -> https://<your-domain>/webhooks/feishu/events
  -> VPS Nginx HTTPS
  -> frp
  -> local Windows API localhost:3000/webhooks/feishu/events
```

Expose only the webhook path through Nginx. Do not publish `/jobs`,
`/jobs/:jobId/details`, or `/admin/*` to the public internet.

Detailed deployment guide and templates:

```text
docs/reference-feishu-public-ingress.md
config/public-ingress/nginx/feishu-webhook.conf.example
config/public-ingress/frp/frps.toml.example
config/public-ingress/frp/frpc.toml.example
config/public-ingress/systemd/frps-agent-openclaw.service.example
config/public-ingress/systemd/frpc-agent-openclaw.service.example
```

## OpenClaw Runtime Mode

Default local verification uses mock agent outputs:

```text
OPENCLAW_AGENT_MODE=mock
```

To call real WSL OpenClaw agents:

```text
OPENCLAW_AGENT_MODE=real
OPENCLAW_WSL_DISTRO=Ubuntu-24.04
OPENCLAW_CLI=/home/administrator/.npm-global/bin/openclaw
OPENCLAW_AGENT_TIMEOUT_SECONDS=600
```

## Session Archive And Cleanup

Completed jobs are archived and retained before heavy intermediate cleanup:

```text
archived_at
retention_until
cleanup_status=retained
retention_policy
```

Preview cleanup:

```powershell
npm run maintenance:cleanup-sessions
```

Apply cleanup:

```powershell
npm run maintenance:cleanup-sessions -- --apply
```

Repair historical cancelled jobs that predate the cancel archive path:

```powershell
npm run maintenance:repair-cancelled-archives
npm run maintenance:repair-cancelled-archives -- --apply
```

The repair is dry-run by default. It finds `status=cancelled` jobs where
`archived_at is null` and, with `--apply`, archives them with
`retentionPolicy.archiveReason=job_cancelled`. For a targeted repair:

```powershell
npm run maintenance:repair-cancelled-archives -- --job-id JOB-...
```
