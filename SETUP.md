# Agent OpenClaw Setup Notes

## Current Runtime

The local orchestration kernel is now:

```text
orchestrator-api
  -> DBOS workflow library
  -> Postgres
  -> OpenClaw adapter
  -> Feishu display adapter
```

Temporal Server and Temporal UI are no longer part of the local dev stack.
DBOS stores durable workflow state in Postgres under the `dbos` schema.
Business state still lives in the `agent` schema.

## Local Services

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
  requesterId = 'local-test-user'
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri 'http://localhost:3000/jobs' -Method Post -ContentType 'application/json' -Body $body
$response
Invoke-RestMethod -Uri "http://localhost:3000/jobs/$($response.jobId)"
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
  stage output becomes the next stage input.

classic_master_slave:
  main-agent dispatches each child stage independently and collects outputs.
  There is no peer-to-peer handoff and no test-agent gate in M2.

master_slave_discussion:
  Child agents run in a fixed two-round discussion loop, with visible
  discussion_handoff messages and discussion.round_completed events.
  After the rounds finish, main-agent runs a dedicated
  mainAgentSynthesizeDiscussion step over the agent_events ledger and stage
  output artifacts. finalizeJob then includes that synthesis artifact in the
  final output.
```

Current quality-gate decision for the next milestone:

```text
supervisor_pipeline:
  Keep the existing per-stage test-agent gate and 3-FAIL safety behavior.

pipeline:
  Add a final-only test-agent gate later. Do not test every stage, otherwise it
  collapses back into supervisor_pipeline.

classic_master_slave:
  Keep main-agent as the primary synthesizer. Add an optional final test-agent
  gate later, controlled by persisted job config.

master_slave_discussion:
  Keep main-agent synthesis mandatory. Add one test-agent final gate after the
  synthesis later.

all modes:
  Add a persisted budget ceiling later, such as max total attempts or max model
  calls, before enabling expensive real providers broadly.
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
```

Repeat both recovery checks with:

```powershell
npm run smoke:m2-recovery
```

The script restarts the local dev API with the crash hook enabled, creates one
`pipeline` job and one `master_slave_discussion` job, verifies that the API
actually crashed, restarts without the hook, then asserts the recovered counts.

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

## Feishu Webhook

Feishu is still only the human entrypoint and visible display screen. Real
agent-to-agent handoff is controlled locally by DBOS/Postgres, not by Feishu
mentions.

```text
POST http://localhost:3000/webhooks/feishu/events
```

Public HTTPS webhook setup is intentionally after local DBOS validation.

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
